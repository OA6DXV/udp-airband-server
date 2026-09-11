'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { createCompressedManager } = require('../lib/compressed');

const sentBytes = new Map();
let encodedFrames = 0;
const manager = createCompressedManager({
  aacBitrate: '32k',
  adpcmFrameMs: 20,
  adpcmPacing: false,
  addListenerBytes(stream, clientId, mode, bytes) {
    sentBytes.set(clientId, (sentBytes.get(clientId) || 0) + bytes);
  },
  addListenerMode() {},
  debugEnabled: false,
  encodeWsBinary(frame) {
    encodedFrames += 1;
    return { payload: frame };
  },
  ffmpegPath: 'ffmpeg',
  fs,
  hlsRoot: '/tmp',
  logger: { debug() {}, error() {}, shouldLog() { return false; } },
  maxSocketBufferBytes: 1024 * 1024,
  maxStdinBufferBytes: 1024 * 1024,
  normalizeClientId(value) { return value; },
  path,
  removeListenerMode() {},
  sendWsBinary(socket, frame) {
    socket.frames.push(Buffer.from(frame));
    return !socket.applyBackpressure;
  },
  sendWsEncoded(socket, frame) {
    socket.frames.push(Buffer.from(frame.payload));
    return !socket.applyBackpressure;
  },
  spawn() { throw new Error('ffmpeg must not be used for ADPCM'); },
  spawnSync() { return { status: 1 }; },
});

const stream = {
  name: 'test',
  sampleRate: 8000,
  channels: 1,
  opusClients: new Set(),
  hlsClients: new Map(),
  listenerStats: new Map(),
  adpcmSequence: 0,
  adpcmState: null,
  adpcmFilterState: null,
  adpcmPendingBuffer: Buffer.alloc(0),
  adpcmLastInputAt: 0,
};

const first = createSocket();
const second = createSocket();
manager.serveWebSocket(stream, 'first', first, 'adpcm');
manager.serveWebSocket(stream, 'second', second, 'adpcm');

const samples = Buffer.alloc(800 * 4);
for (let index = 0; index < 800; index += 1) {
  samples.writeFloatLE(Math.sin(index / 12) * 0.4, index * 4);
}
manager.writeStreamInput(stream, samples.subarray(0, 333 * 4));
assert.strictEqual(first.frames.length, 2, 'complete 20 ms frames should be emitted');
assert.strictEqual(stream.adpcmPendingBuffer.length, 13 * 4, 'partial PCM must remain buffered');
manager.writeStreamInput(stream, samples.subarray(333 * 4));

assert.strictEqual(first.frames.length, 5);
assert.strictEqual(second.frames.length, 5);
assert.strictEqual(encodedFrames, 5, 'each shared ADPCM frame must be WebSocket-encoded only once');
assert.strictEqual(stream.adpcmPendingBuffer.length, 0);
for (let index = 0; index < first.frames.length; index += 1) {
  assert.deepStrictEqual(first.frames[index], second.frames[index], 'all clients must receive identical ADPCM');
  assert.strictEqual(first.frames[index].readUInt32LE(12), index, 'sequence must advance once per stream frame');
  assert.strictEqual(first.frames[index].readUInt16LE(16), 160, 'every frame must contain exactly 20 ms at 8 kHz');
}
assert.strictEqual(sentBytes.get('first'), sentBytes.get('second'));

first.applyBackpressure = true;
manager.writeStreamInput(stream, samples);
assert.strictEqual(first.frames.length, 6, 'a slow client should stop after its first backpressured frame');
assert.strictEqual(second.frames.length, 10, 'a slow client must not interrupt another client');
assert.strictEqual(second.frames[9].readUInt32LE(12), 9);
first.applyBackpressure = false;
first.emit('drain');
manager.writeStreamInput(stream, samples);
assert.strictEqual(first.frames.at(-1).readUInt32LE(12), 14, 'recovered clients resume at the current stream sequence');
assert.strictEqual(second.frames.at(-1).readUInt32LE(12), 14);

stream.adpcmPendingBuffer = Buffer.alloc(80 * 4);
stream.adpcmLastInputAt = Date.now() - 501;
manager.writeStreamInput(stream, samples);
assert.strictEqual(stream.adpcmPendingBuffer.length, 0, 'stale partial PCM must be discarded after silence');
assert.strictEqual(first.frames.at(-1).readUInt32LE(12), 19);
assert.strictEqual(second.frames.at(-1).readUInt32LE(12), 19);

assert.strictEqual(manager.releaseWebSocket(stream, first), true);
assert.strictEqual(first.destroyed, false, 'a client close handshake must be allowed to flush its response');
assert.strictEqual(stream.opusClients.size, 1);
assert.strictEqual(manager.releaseWebSocket(stream, first), false, 'releasing the same socket twice must be harmless');

console.log('ADPCM shared delivery tests passed');

function createSocket() {
  const socket = new EventEmitter();
  socket.destroyed = false;
  socket.writableLength = 0;
  socket.frames = [];
  socket.applyBackpressure = false;
  socket.destroy = () => { socket.destroyed = true; };
  return socket;
}
