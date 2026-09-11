import assert from 'node:assert/strict';
import { MonoPcmRingBuffer } from '../assets/audio-ring-buffer.mjs';

testMonoOrderAndUnderrun();
testStereoDownmix();
testStartupThreshold();
testWrapAroundOrder();
testOverflowDropsOldAudio();
testFractionalResamplerContinuity();
testResetAndDriftBounds();
await testWorkletMessageValidation();
console.log('audio worklet ring buffer tests passed');

function createRing(overrides = {}) {
  return new MonoPcmRingBuffer({
    inputSampleRate: 1000,
    channels: 1,
    targetLatencyMs: 2,
    highWaterMs: 50,
    capacitySeconds: 1,
    ...overrides,
  });
}

function testMonoOrderAndUnderrun() {
  const ring = createRing();
  ring.appendInterleaved(new Float32Array([0, 0.25, 0.5, 0.75, 1]), 5);
  const output = new Float32Array(6);
  ring.render(output, 1000);
  assert.ok(Math.abs(output[0]) < 1e-6);
  assert.ok(output[1] > 0.24 && output[1] < 0.27);
  assert.ok(output[2] > output[1]);
  assert.strictEqual(output[4], 0);
  assert.strictEqual(output[5], 0);
  assert.strictEqual(ring.diagnostics().underruns, 1);
}

function testStereoDownmix() {
  const ring = createRing({ channels: 2 });
  ring.appendInterleaved(new Float32Array([
    1, -1,
    0.5, 0.5,
    -0.25, 0.75,
    0, 0,
  ]), 4, 2);
  const output = new Float32Array(2);
  ring.render(output, 1000);
  assert.ok(Math.abs(output[0]) < 1e-6);
  assert.ok(output[1] > 0.49 && output[1] < 0.51);
}

function testStartupThreshold() {
  const ring = createRing({ targetLatencyMs: 10 });
  ring.appendInterleaved(new Float32Array(9).fill(0.5), 9);
  const output = new Float32Array(8).fill(1);
  ring.render(output, 1000);
  assert.deepStrictEqual(Array.from(output), new Array(8).fill(0));
  assert.strictEqual(ring.diagnostics().underruns, 0);
}

function testWrapAroundOrder() {
  const ring = createRing({ targetLatencyMs: 2, highWaterMs: 15, capacitySeconds: 0.02, maxDrift: 0 });
  ring.appendInterleaved(Float32Array.from({ length: 10 }, (_, index) => index / 100), 10);
  ring.render(new Float32Array(8), 1000);
  ring.appendInterleaved(Float32Array.from({ length: 12 }, (_, index) => (index + 10) / 100), 12);
  const output = new Float32Array(13);
  ring.render(output, 1000);
  output.forEach((sample, index) => assert.ok(Math.abs(sample - (index + 8) / 100) < 1e-6));
  assert.strictEqual(ring.diagnostics().overflows, 0);
}

function testOverflowDropsOldAudio() {
  const ring = createRing({ targetLatencyMs: 2, highWaterMs: 5, capacitySeconds: 0.02 });
  ring.appendInterleaved(new Float32Array([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]), 10);
  const diagnostics = ring.diagnostics();
  assert.strictEqual(diagnostics.overflows, 1);
  assert.strictEqual(diagnostics.droppedFrames, 8);
  assert.strictEqual(diagnostics.bufferedFrames, 2);
  const output = new Float32Array(1);
  ring.render(output, 1000);
  assert.ok(output[0] > 0.79 && output[0] < 0.81);
}

function testFractionalResamplerContinuity() {
  const ring = new MonoPcmRingBuffer({
    inputSampleRate: 8000,
    channels: 1,
    targetLatencyMs: 1,
    highWaterMs: 100,
    capacitySeconds: 1,
  });
  const samples = Float32Array.from({ length: 100 }, (_, index) => index / 100);
  ring.appendInterleaved(samples, samples.length);
  const first = new Float32Array(10);
  const second = new Float32Array(10);
  ring.render(first, 48000);
  ring.render(second, 48000);
  assert.ok(first[9] > first[0]);
  assert.ok(second[0] > first[9]);
  assert.ok(second[0] - first[9] < 0.01);
}

function testResetAndDriftBounds() {
  const ring = createRing({ targetLatencyMs: 10, highWaterMs: 100, maxDrift: 0.004 });
  ring.appendInterleaved(new Float32Array(80).fill(0.2), 80);
  ring.render(new Float32Array(1), 1000);
  assert.ok(ring.diagnostics().correction <= 0.004);
  assert.ok(ring.diagnostics().correction >= -0.004);
  ring.render(new Float32Array(70), 1000);
  ring.render(new Float32Array(1), 1000);
  assert.ok(ring.diagnostics().correction < 0);
  assert.ok(ring.diagnostics().correction >= -0.004);
  ring.reset();
  const diagnostics = ring.diagnostics();
  assert.strictEqual(diagnostics.bufferedFrames, 0);
  assert.strictEqual(diagnostics.started, false);
  assert.strictEqual(diagnostics.resets, 2);
}

async function testWorkletMessageValidation() {
  let RegisteredProcessor;
  globalThis.sampleRate = 48000;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = {
        messages: [],
        postMessage(message) { this.messages.push(message); },
        onmessage: null,
      };
    }
  };
  globalThis.registerProcessor = (name, processor) => {
    assert.strictEqual(name, 'airband-pcm');
    RegisteredProcessor = processor;
  };
  await import('../assets/audio-worklet.mjs');
  const processor = new RegisteredProcessor();
  processor.handleMessage({
    type: 'configure',
    inputSampleRate: 8000,
    channels: 1,
    targetLatencyMs: 20,
    highWaterMs: 500,
    capacitySeconds: 4,
    maxDrift: 0.004,
  });
  const samples = new Float32Array(200).fill(0.25);
  processor.handleMessage({ type: 'samples', frames: samples.length, buffer: samples.buffer });
  const output = new Float32Array(128);
  assert.strictEqual(processor.process([], [[output]]), true);
  assert.ok(output.some((sample) => sample > 0));
  processor.handleMessage({ type: 'samples', frames: 2, buffer: new ArrayBuffer(4) });
  assert.strictEqual(processor.invalidMessages, 1);
  assert.ok(processor.port.messages.some((message) => message.type === 'worklet-error'));
}
