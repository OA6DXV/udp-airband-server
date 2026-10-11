'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { renderMultiStreamPage } = require('../lib/streams');
const single = fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const multi = fs.readFileSync(path.join(__dirname, '../assets/multi.js'), 'utf8');
for (const source of [single, multi]) {
  assert(!source.includes('showModeNotice('));
  assert(!source.includes('showStartupNoticeIfNeeded('));
  assert(!source.includes('rememberNoticeAccepted('));
}
assert(single.includes("!streamPaused && currentMode === 'compatible'"));
assert(single.includes("startButton.classList.toggle('audio-start-prompt', !audioStarted)"));
assert(multi.includes("this.startButton.classList.toggle('audio-start-prompt', !this.started)"));
const html = renderMultiStreamPage([]);
assert(!html.includes('multiPlayButton'));
assert(html.includes('id="multiStartOverlay" class="multi-start-overlay">'));
assert(html.includes('id="multiStartButton" class="multi-start-button" type="button">Start Audio'));
assert(html.includes('data-i18n="globalModeTitle"'));
assert(!multi.includes("button.classList.toggle('active'"));
assert(multi.includes("if (player.mode !== mode)"));
const globalModeSetup = multi.match(/function setGlobalMode\(mode, options = \{\}\) \{[\s\S]*?\n\}/)[0];
const mixedPlayers = ['raw', 'opus'].map(mode => ({ mode, started: true, stops: 0,
  stopRealtimeAudio() { this.stops++; }, updateLabels() {},
}));
let starts = 0;
const mixedContext = vm.createContext({
  players: mixedPlayers, globalMode: 'opus', multiPlaybackRequested: true,
  updateModeControls() {}, startSelectedGlobalMode: () => { starts++; return Promise.resolve(); }, console,
});
vm.runInContext(globalModeSetup + '\nsetGlobalMode("opus")', mixedContext);
assert.equal(mixedPlayers[0].mode, 'opus');
assert.equal(mixedPlayers[0].stops, 1, 'global Normal must update independently changed streams even when the last global choice was Normal');
assert.equal(mixedPlayers[1].stops, 0, 'unchanged streams must not restart');
assert.equal(starts, 1);
const setup = single.match(/function updateBrowserBandwidth\(\) \{[\s\S]*?\n\}/)[0];
let now = 1000;
const context = vm.createContext({
  Date: { now: () => now }, Math,
  streamPaused: false, currentMode: 'raw', compatibleBandwidthReady: false,
  browserBandwidthEl: { textContent: 'Idle' },
  receivedBytes: 0, lastBandwidthBytes: 0, lastBandwidthAt: now,
  formatBandwidth: bps => String(bps),
});
vm.runInContext(setup, context);
for (let i = 0; i < 4; i++) {
  now += 250;
  context.receivedBytes += 2000;
  vm.runInContext('updateBrowserBandwidth()', context);
  assert.equal(context.browserBandwidthEl.textContent, i === 3 ? '64000' : 'Idle');
}
now += 250;
vm.runInContext('updateBrowserBandwidth()', context);
assert.equal(context.browserBandwidthEl.textContent, '64000');
context.streamPaused = true;
vm.runInContext('updateBrowserBandwidth()', context);
assert.equal(context.browserBandwidthEl.textContent, 'Idle');
console.log('Client startup and bandwidth tests passed');
