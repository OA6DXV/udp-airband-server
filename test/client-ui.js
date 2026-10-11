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
assert(html.includes('id="multiPlayButton" class="audio-start-prompt"'));
assert(html.includes('id="multiStartOverlay" class="multi-start-overlay" hidden'));
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
