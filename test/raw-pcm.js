'use strict';

const assert = require('assert');
const { createRawPcmFramer } = require('../lib/raw-pcm');

let currentTime = 1000;
const framer = createRawPcmFramer({ frameMs: 20, now: () => currentTime });
const stream = {
  sampleRate: 8000,
  channels: 1,
  rawPendingBuffer: Buffer.alloc(0),
  rawLastInputAt: 0,
};
const input = Buffer.alloc(800 * 4);
for (let sample = 0; sample < 800; sample += 1) input.writeFloatLE(sample, sample * 4);

let frames = framer.push(stream, input.subarray(0, 333 * 4));
assert.strictEqual(frames.length, 2);
assert.strictEqual(frames[0].length, 160 * 4);
assert.strictEqual(stream.rawPendingBuffer.length, 13 * 4);

frames = frames.concat(framer.push(stream, input.subarray(333 * 4)));
assert.strictEqual(frames.length, 5);
assert.strictEqual(stream.rawPendingBuffer.length, 0);
assert.deepStrictEqual(Buffer.concat(frames), input, 'framing must preserve every PCM sample in order');

stream.rawPendingBuffer = Buffer.alloc(80 * 4, 1);
stream.rawLastInputAt = currentTime;
currentTime += 501;
frames = framer.push(stream, input);
assert.strictEqual(frames.length, 5, 'stale partial PCM must be discarded after an input gap');
assert.deepStrictEqual(Buffer.concat(frames), input);

framer.reset(stream);
assert.strictEqual(stream.rawPendingBuffer.length, 0);
assert.strictEqual(stream.rawLastInputAt, 0);

console.log('Raw PCM framing tests passed');
