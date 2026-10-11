'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { encodeAdpcmFrames } = require('../lib/compressed/adpcm');
const source = fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');

function functions(names) {
  return names.map(name => {
    const match = source.match(new RegExp('(?:async )?function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}'));
    assert(match, name + ' must exist');
    return match[0];
  }).join('\n');
}

class Socket extends EventTarget {
  static opened = [];
  constructor(url) { super(); this.url = url; this.readyState = 1; Socket.opened.push(this); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  receive(data) { const event = new Event('message'); event.data = data; this.dispatchEvent(event); }
}

class Worklet extends EventTarget {
  constructor() {
    super();
    this.messages = [];
    this.port = { postMessage: message => this.messages.push(message), close() {} };
  }
  connect(node) { this.connected = node; }
  disconnect() { this.connected = null; }
}

class Decoder {
  constructor(options) { this.options = options; }
  async push() { this.options.onPcm(new Float32Array(960).fill(.1), 960, 48000, 1); }
  close() { this.closed = true; }
}

function fixture(secure = true) {
  const context = { state: 'running', destination: {}, currentTime: 0,
    audioWorklet: { async addModule() {} }, async resume() { this.state = 'running'; },
    createGain: () => ({ gain: { value: .42 }, connect() {} }),
  };
  const sandbox = vm.createContext({
    AudioContext: function () { return context; }, AudioWorkletNode: Worklet, WebSocket: Socket,
    Float32Array, ArrayBuffer, DataView, Date, Math, Number, String, Promise, encodeURIComponent,
    window: { isSecureContext: secure, AudioWorkletNode: Worklet },
    setTimeout: () => 1, clearTimeout() {}, console: { warn() {}, debug() {} },
    streamName: 'testing', clientId: 'test-client', audioContext: null, gainNode: null,
    config: { sampleRate: 8000, channels: 1, opusWorkletTargetLatencyMs: 100 },
    gain: .42, muted: false, audioStarted: false, streamPaused: false, streamConfirmed: false,
    preferredMode: 'adpcm', currentMode: 'raw', receivedBytes: 0, lastBandwidthAt: 0, lastBandwidthBytes: 0,
    lastPeak: 0, lastAudioAt: 0, latestWave: new Float32Array(0), rawWs: null, adpcmWs: null,
    opusRealtimeWorkletNode: null, opusRealtimeWorkletPromise: null, opusRealtimeWorkletConnected: false,
    opusRealtimeWorkletDiagnostics: null, opusRealtimeWorkletConfiguration: '',
    opusRealtimeDecoder: null, opusRealtimeWebSocket: null, opusRealtimeGeneration: 0,
    opusRealtimeReconnectTimer: null, opusRealtimeErrorReported: false,
    opusRealtimeDeliveredFrames: 0, opusRealtimeDeliveryDroppedFrames: 0,
    browserBandwidthEl: {},
    applyOutputGain() { context.gain = .42; }, requestBackgroundPlaybackSession() {},
    updateAudioButton() {}, updateGainControl() {}, connectControlWebSocket() {}, updateModeButton() {},
    updateConnectionState() {}, updateMediaSessionMetadata() {}, setStatus(state, key) { sandbox.status = key; },
    isOpusRealtimeAvailable: () => sandbox.opusSupported !== false,
    appPath: value => '/' + value, appWebSocketUrl: value => 'wss://example/' + value,
    loadOpusRealtimeModule: async () => ({ OpusWebCodecsDecoder: Decoder }),
  });
  const tables = source.match(/const adpcmIndexTable = [\s\S]*?(?=const clientId =)/)[0];
  vm.runInContext(tables + '\n' + functions([
    'startAudioPlayback', 'startSelectedMode', 'startRaw', 'startNormal', 'startAdpcm', 'stopRaw', 'stopNormal',
    'startOpusRealtime', 'ensureOpusRealtimeWorklet', 'ensurePcmWorkletConnected', 'configureOpusRealtimeWorklet',
    'resetOpusRealtimeWorklet', 'stopOpusRealtime', 'deliverOpusRealtimePcm',
    'handleOpusRealtimeError', 'handlePlaybackError', 'scheduleAudio', 'decodeAdpcmFrame', 'decodeAdpcmNibble',
    'clamp', 'peakOf',
  ]), sandbox);
  return sandbox;
}

async function main() {
  const insecure = fixture(false);
  Socket.opened = [];
  await assert.rejects(vm.runInContext('startAudioPlayback()', insecure), /AudioWorklet requires HTTPS/);
  assert.equal(Socket.opened.length, 0, 'no legacy playback or codec socket without AudioWorklet');
  assert.equal(insecure.audioStarted, false);

  const player = fixture();
  await vm.runInContext('startAudioPlayback()', player);
  assert.equal(player.adpcmWs.url, 'wss://example/testing/adpcm?clientId=test-client');
  const pcm = Buffer.alloc(160 * 4);
  for (let i = 0; i < 160; i++) pcm.writeFloatLE(Math.sin(i * .3) * .2, i * 4);
  const packet = Uint8Array.from(encodeAdpcmFrames({ sampleRate: 8000, channels: 1, adpcmSequence: 0 }, pcm, 20)[0]).buffer;
  player.adpcmWs.receive(packet);
  const worklet = player.opusRealtimeWorkletNode;
  assert.equal(worklet.messages.find(message => message.type === 'configure').inputSampleRate, 8000);
  assert.equal(worklet.messages.at(-1).frames, 160);
  assert.equal(worklet.messages.at(-1).type, 'samples');

  const oldNormal = player.adpcmWs;
  vm.runInContext('startSelectedMode("raw")', player);
  assert.equal(oldNormal.readyState, 3);
  assert.equal(player.rawWs.url, 'wss://example/testing/audio?clientId=test-client');
  player.rawWs.receive(new Float32Array(160).fill(.2).buffer);
  assert.equal(worklet.messages.at(-1).frames, 160);
  assert.equal(new Float32Array(worklet.messages.at(-1).buffer)[0], Math.fround(.2));
  const beforeStale = worklet.messages.length;
  oldNormal.receive(packet);
  assert.equal(worklet.messages.length, beforeStale, 'old codec callbacks must not enter the new worklet queue');

  vm.runInContext('startSelectedMode("opus-live")', player);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(player.opusRealtimeWebSocket.url, 'wss://example/testing/opus-live?clientId=test-client');
  player.opusRealtimeWebSocket.receive(new ArrayBuffer(8));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worklet.messages.at(-2).inputSampleRate, 48000);
  assert.equal(worklet.messages.at(-1).frames, 960);
  assert.equal(worklet.connected, player.gainNode);
  assert.equal(player.gainNode.gain.value, .42, 'gain stays unchanged across the three profiles');

  const socketCount = Socket.opened.length;
  vm.runInContext('handleOpusRealtimeError(new Error("decoder failed"), opusRealtimeGeneration)', player);
  assert.equal(Socket.opened.length, socketCount, 'decoder errors must not open a fallback codec');
  assert.equal(player.audioStarted, false);
  assert.equal(player.status, 'audioUnavailable');
  player.opusSupported = false;
  vm.runInContext('startSelectedMode("opus-live")', player);
  assert.equal(Socket.opened.length, socketCount, 'unsupported Opus must not silently select RAW');
  console.log('Single-stream AudioWorklet tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
