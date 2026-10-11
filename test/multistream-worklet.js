'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { renderMultiStreamPage } = require('../lib/streams');
const source = fs.readFileSync(path.join(__dirname, '../assets/multi.js'), 'utf8');
const playerSource = source.slice(source.indexOf('class MultiStreamPlayer'), source.indexOf('\nfunction peakOf('));
assert(!source.includes('native.aac'));
assert(!source.includes('native-gain'));
assert(!source.includes('createBufferSource'));
assert(!source.includes('compressed-mode'));
assert(!renderMultiStreamPage([]).includes('nativeMultiAudio'));

class Socket extends EventTarget {
  constructor(url) { super(); this.url = url; this.readyState = 1; }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  receive(data) {
    const event = new Event('message');
    event.data = data;
    this.dispatchEvent(event);
  }
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
  constructor(options) { this.options = options; this.closed = false; }
  async push() { this.options.onPcm(new Float32Array(960).fill(.1), 960, 48000, 1); }
  close() { this.closed = true; }
}

async function main() {
  const adpcmModule = await import('../assets/adpcm-decoder.mjs');
  const { encodeAdpcmFrames } = require('../lib/compressed/adpcm');
  let testNow = 1000;
  const timers = new Map();
  let timerId = 0;
  const context = {
    state: 'running', destination: {}, async resume() { this.state = 'running'; },
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
  };
  const sandbox = {
    globalMode: 'opus', globalPaused: false, streamsUnavailable: false,
    multiPlaybackRequested: true, window: { AudioDecoder: {} },
    WebSocket: Socket, AudioWorkletNode: Worklet, Float32Array, ArrayBuffer,
    Date: { now: () => testNow }, Math, Number, String, encodeURIComponent, console: { warn() {} },
    updateHeader() {},
    getClientId: () => 'test-client', ensureAudioContext: () => context,
    loadWorkletModule: async () => {},
    loadOpusModule: async () => ({ supportsOpusAudioDecoder: async () => true, OpusWebCodecsDecoder: Decoder }),
    loadAdpcmModule: async () => adpcmModule,
    appWebSocketUrl: endpoint => `wss://example/${endpoint}`,
    peakOf: samples => Math.max(...samples.map(Math.abs)),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
  };
  const Player = vm.runInNewContext(playerSource + '\nMultiStreamPlayer', sandbox);
  Player.prototype.updateLabels = function() {};
  const stream = { name: 'testing', sampleRate: 8000, channels: 1, opusRealtimeAvailable: true };
  const first = new Player(stream), second = new Player({ ...stream, name: 'second' });
  first.configReady = second.configReady = true;
  await Promise.all([first.startIfReady(), second.startIfReady()]);
  assert(first.started && second.started);
  assert.notEqual(first.worklet, second.worklet, 'streams must have independent worklets');
  assert.notEqual(first.decoder, second.decoder, 'streams must have independent decoders');
  assert.equal(first.audioWs.url, 'wss://example/testing/opus-live?clientId=test-client');
  first.audioWs.receive(new ArrayBuffer(20));
  assert.equal(first.worklet.messages[0].inputSampleRate, 48000);
  assert.equal(first.worklet.messages[1].type, 'samples');

  first.gain = .42;
  first.muted = true;
  first.applyGain();
  assert.equal(first.gainNode.gain.value, 0);
  assert.equal(second.gainNode.gain.value, 1);
  const staleDecoder = first.decoder, staleSocket = first.audioWs, staleWorklet = first.worklet;
  first.mode = 'raw';
  await first.startAudio();
  assert(staleDecoder.closed);
  assert.equal(staleSocket.readyState, 3);
  assert.equal(staleWorklet.connected, null);
  assert.equal(first.gainNode.gain.value, 0, 'mute survives codec changes');
  assert.equal(first.gain, .42, 'gain survives codec changes');
  assert.equal(first.audioWs.url, 'wss://example/testing/audio?clientId=test-client');
  first.audioWs.receive(new Float32Array(160).fill(.2).buffer);
  assert.equal(first.worklet.messages[0].inputSampleRate, 8000);
  assert.equal(first.worklet.messages[1].frames, 160);
  const count = first.worklet.messages.length;
  staleDecoder.options.onPcm(new Float32Array(960), 960, 48000, 1);
  assert.equal(first.worklet.messages.length, count, 'stale decoder callbacks must be ignored');

  first.muted = false;
  first.applyGain();
  assert(Math.abs(first.gainNode.gain.value - .42) < 1e-6);
  first.audioWs.close();
  assert.equal(first.started, false);
  assert.equal(timers.size, 1, 'unexpected disconnect schedules one reconnect');
  first.pause();

  first.levelMask = { style: {} };
  first.levelDb = {};
  first.paused = false;
  first.receivedBytes = 0;
  first.lastBandwidthBytes = 0;
  first.lastBandwidthAt = testNow;
  first.bandwidth = 0;
  for (let i = 0; i < 4; i++) {
    testNow += 250;
    first.receivedBytes += 2000;
    first.updateMeter();
    assert.equal(first.bandwidth, i === 3 ? 64000 : 0);
  }
  first.connectControl();
  first.controlWs.receive(JSON.stringify({ type: 'stats', listenerBitsPerSecond: 999999 }));
  assert.equal(first.bandwidth, 64000, 'server stats must not overwrite the browser meter');
  testNow += 250;
  first.updateMeter();
  assert.equal(first.bandwidth, 64000, 'meter must hold the value between one-second updates');
  assert.equal(timers.size, 0, 'pause cancels pending reconnect');
  assert.equal(first.worklet, null);
  assert.equal(first.decoder, null);
  first.resume();
  await new Promise(resolve => setImmediate(resolve));
  assert(first.started, 'resume starts the current codec again');
  first.mode = 'adpcm';
  first.config.adpcmAvailable = true;
  await first.startAudio();
  assert.equal(first.audioWs.url, 'wss://example/testing/adpcm?clientId=test-client');
  assert.equal(first.decoder, null, 'ADPCM must not allocate an Opus decoder');
  const pcm = Buffer.alloc(160 * 4);
  for (let i = 0; i < 160; i++) pcm.writeFloatLE(Math.sin(i * .3) * .2, i * 4);
  const frame = encodeAdpcmFrames({ sampleRate: 8000, channels: 1, adpcmSequence: 0 }, pcm, 20)[0];
  const packet = Uint8Array.from(frame).buffer;
  first.audioWs.receive(packet);
  assert.equal(first.worklet.messages[0].inputSampleRate, 8000);
  assert.equal(first.worklet.messages[1].frames, 160);
  assert.equal(first.gain, .42);
  assert.equal(adpcmModule.decodeAdpcmFrame(packet).samples.length, 160);
  assert.equal(adpcmModule.decodeAdpcmFrame(packet.slice(0, -1)), null);
  const invalid = packet.slice(0);
  new DataView(invalid).setUint8(22, 255);
  assert.equal(adpcmModule.decodeAdpcmFrame(invalid), null);
  first.config.adpcmAvailable = false;
  await first.startAudio();
  assert.equal(first.audioWs.url, 'wss://example/testing/adpcm?clientId=test-client', 'Normal is a permanent profile');
  first.pause();

  let release;
  sandbox.loadWorkletModule = () => new Promise(resolve => { release = resolve; });
  const pending = second.startAudio();
  second.pause();
  release();
  await pending;
  assert.equal(second.worklet, null, 'cancelled initialization must not revive playback');
  assert.equal(second.audioWs, null);
  assert.equal(second.started, false);
  let rejectOldModule;
  sandbox.loadWorkletModule = () => new Promise((resolve, reject) => { rejectOldModule = reject; });
  second.paused = false;
  const cancelledFailure = second.startAudio();
  second.pause();
  rejectOldModule(new Error('Old initialization failed after cancellation'));
  await cancelledFailure;
  assert.equal(second.playbackError, '', 'cancelled initialization errors must be ignored');
  sandbox.loadWorkletModule = async () => {};
  second.paused = false;
  second.config.opusRealtimeAvailable = false;
  await assert.rejects(second.startAudio(), /low data unavailable/);
  assert.equal(second.audioWs, null, 'unsupported Opus must not fall back to AAC');
  console.log('Multistream AudioWorklet tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
