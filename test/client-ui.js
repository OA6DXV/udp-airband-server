'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { loadStreamsFromConfig, renderMultiStreamPage, renderStreamList } = require('../lib/streams');
const streamConfig = { name: 'test', udpPort: 9000, sampleRate: 8000, channels: 1 };
assert.equal(loadStreamsFromConfig({ streams: [streamConfig] }, { defaultUdpHost: '0.0.0.0' })[0].sectionId, '');
assert.equal(loadStreamsFromConfig({ sections: [{ id: 'receiver', name: 'Receiver' }], streams: [{ ...streamConfig, sectionId: 'receiver' }] }, {})[0].sectionId, 'receiver');
assert.throws(() => loadStreamsFromConfig({ sections: [], streams: [{ ...streamConfig, sectionId: 'missing' }] }, {}), /Unknown section/);
assert.throws(() => loadStreamsFromConfig({ sections: [{ id: 'a', name: 'Receiver' }, { id: 'a', name: 'Other' }], streams: [streamConfig] }, {}), /Duplicate section ID/);
const single = fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const multi = fs.readFileSync(path.join(__dirname, '../assets/multi.js'), 'utf8');
for (const source of [single, multi]) {
  assert(!source.includes('showModeNotice('));
  assert(!source.includes('showStartupNoticeIfNeeded('));
  assert(!source.includes('rememberNoticeAccepted('));
}
assert(single.includes("startButton.classList.toggle('audio-start-prompt', !audioStarted)"));
assert(multi.includes("this.startButton.classList.toggle('audio-start-prompt', !this.started)"));
const html = renderMultiStreamPage([]);
assert(!html.includes('multiPlayButton'));
assert(html.includes('id="multiStartOverlay" class="multi-start-overlay">'));
assert(html.includes('id="multiStartButton" class="multi-start-button" type="button">Start Audio'));
assert(html.includes('data-i18n="globalModeTitle"'));
assert(html.includes('data-mode="raw">RAW</button>'));
assert(html.includes('data-mode="adpcm">Normal</button>'));
assert(html.includes('data-mode="opus">Low Data</button>'));
assert(multi.includes("let globalMode = 'adpcm';"), 'multistream should default to Normal/ADPCM');
assert(fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8').includes("let preferredMode = 'adpcm';"), 'single stream should default to Normal/ADPCM');
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
const sectionedList = renderStreamList([
  { name: 'cuz-twr', label: 'Cusco TWR', sampleRate: 8000, channels: 1, sectionId: 'cusco' },
  { name: 'cuz-gnd', label: 'Cusco GND', sampleRate: 8000, channels: 1, sectionId: 'cusco' },
], { basePath: '/development/', sections: [{ id: 'cusco', name: 'Cusco' }] });
assert(sectionedList.includes('<legend><button class="section-multistream"'), 'section title should be a multistream button');
assert(sectionedList.includes('data-section-streams="[&quot;cuz-twr&quot;,&quot;cuz-gnd&quot;]"'), 'section button should include all its streams in display order');
assert(sectionedList.includes('<svg class="section-play-icon" aria-hidden="true"'), 'section play icon should be decorative for accessibility');
assert(sectionedList.includes("location.href = new URL('multi?streams=' + query, document.baseURI).href"), 'section button should use the base path when opening multistream');
assert(sectionedList.includes("startSectionMulti: 'Iniciar multistream con todos los streams de esta sección'"), 'section button accessible label should be localized');
const sectionClickSetup = sectionedList.match(/sectionMultiButtons\.forEach\(\(button\) => \{[\s\S]*?\n    \}\);/)?.[0];
assert.ok(sectionClickSetup, 'section multistream click handler should exist');
let sectionClickHandler;
const sectionButton = {
  dataset: { sectionStreams: '["cuz-twr","cuz-gnd"]' },
  addEventListener: (event, handler) => { if (event === 'click') sectionClickHandler = handler; },
};
const sectionContext = vm.createContext({
  button: sectionButton,
  sectionMultiButtons: [sectionButton],
  location: { href: '' },
  document: { baseURI: 'https://liveatc.example/development/' },
  URL,
  encodeURIComponent,
});
vm.runInContext(sectionClickSetup, sectionContext);
sectionClickHandler();
assert.equal(sectionContext.location.href, 'https://liveatc.example/development/multi?streams=cuz-twr,cuz-gnd');
const setup = single.match(/function updateBrowserBandwidth\(\) \{[\s\S]*?\n\}/)[0];
let now = 1000;
const context = vm.createContext({
  Date: { now: () => now }, Math,
  streamPaused: false, currentMode: 'raw',
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
