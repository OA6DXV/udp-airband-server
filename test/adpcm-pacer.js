'use strict';

const assert = require('assert');
const { createAdpcmPacer } = require('../lib/compressed/adpcm-pacer');

let currentTime = 1000;
let scheduled = [];
const delivered = [];
const dropped = [];
const stream = {};
const pacer = createAdpcmPacer({
  frameMs: 20,
  maxQueueMs: 80,
  now: () => currentTime,
  clearTimer(timerId) {
    scheduled = scheduled.filter((timer) => timer.id !== timerId);
  },
  setTimer(callback, delay) {
    const id = Math.random();
    scheduled.push({ callback, delay, id });
    return id;
  },
  deliver(target, frame) {
    assert.strictEqual(target, stream);
    delivered.push({ at: currentTime, frame });
  },
  onDrop(target, frames) {
    assert.strictEqual(target, stream);
    dropped.push(...frames);
  },
});

pacer.enqueue(stream, [0, 1, 2, 3, 4]);
assert.deepStrictEqual(delivered, [{ at: 1000, frame: 0 }], 'the first frame must be immediate');
while (scheduled.length) runNextTimer();
assert.deepStrictEqual(delivered.map((item) => item.at), [1000, 1020, 1040, 1060, 1080]);
assert.deepStrictEqual(delivered.map((item) => item.frame), [0, 1, 2, 3, 4]);

currentTime = 1150;
pacer.enqueue(stream, [20, 21, 22]);
assert.strictEqual(delivered.at(-1).frame, 20);
currentTime += 35;
runNextTimer(false);
assert.strictEqual(scheduled[0].delay, 10, 'late timers may recover gradually but must not cause an immediate burst');
while (scheduled.length) runNextTimer();

currentTime = 1300;
pacer.enqueue(stream, [5, 6, 7, 8, 9, 10, 11]);
assert.deepStrictEqual(dropped, [6, 7], 'overflow must discard the oldest queued frames');
while (scheduled.length) runNextTimer();
assert.deepStrictEqual(delivered.slice(-5).map((item) => item.frame), [5, 8, 9, 10, 11]);

currentTime = 1500;
pacer.enqueue(stream, [30, 31, 32]);
assert.strictEqual(delivered.at(-1).frame, 30);
pacer.reset(stream);
assert.strictEqual(scheduled.length, 0, 'reset must cancel pending paced delivery');

console.log('ADPCM pacer tests passed');

function runNextTimer(advance = true) {
  const timer = scheduled.shift();
  if (advance) currentTime += timer.delay;
  timer.callback();
}
