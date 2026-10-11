'use strict';

const assert = require('assert');
const { createOggOpusPacketParser, encodeOpusConfigFrame, encodeOpusPacketFrame } = require('../lib/compressed/ogg-opus');
const { createSharedOpus } = require('../lib/compressed/shared-opus');
const opusNative = require('../lib/opus-native');
const { createFramePacer } = require('../lib/frame-pacer');
const { createRawPcmFramer } = require('../lib/raw-pcm');
const { renderMultiStreamPage, renderStreamList } = require('../lib/streams');

function makeOggPage(sequence, granulePosition, packets, flags = 0) {
  const lacing = [];
  const bodyParts = [];
  for (const packet of packets) {
    let offset = 0;
    while (packet.length - offset >= 255) {
      lacing.push(255);
      bodyParts.push(packet.subarray(offset, offset + 255));
      offset += 255;
    }
    lacing.push(packet.length - offset);
    bodyParts.push(packet.subarray(offset));
  }
  assert(lacing.length <= 255);
  const body = Buffer.concat(bodyParts);
  const header = Buffer.alloc(27 + lacing.length);
  header.write('OggS', 0, 4, 'ascii');
  header.writeUInt8(0, 4);
  header.writeUInt8(flags, 5);
  header.writeBigUInt64LE(BigInt(granulePosition), 6);
  header.writeUInt32LE(0x12345678, 14);
  header.writeUInt32LE(sequence, 18);
  header.writeUInt8(lacing.length, 26);
  Buffer.from(lacing).copy(header, 27);
  return Buffer.concat([header, body]);
}

function makeOpusHead(sampleRate = 8000) {
  const head = Buffer.alloc(19);
  head.write('OpusHead', 0, 8, 'ascii');
  head.writeUInt8(1, 8);
  head.writeUInt8(1, 9);
  head.writeUInt16LE(312, 10);
  head.writeUInt32LE(sampleRate, 12);
  head.writeInt16LE(0, 16);
  head.writeUInt8(0, 18);
  return head;
}

async function main() {
  const testStreams = [{ name: 'cuz-twr', label: 'Tower', sampleRate: 8000, channels: 1 }];
  const prefixedList = renderStreamList(testStreams, { basePath: '/opus/' });
  assert(prefixedList.includes('<base href="/opus/">'));
  assert(prefixedList.includes('href="/opus/cuz-twr"'));
  assert(prefixedList.includes("location.host + '/opus/' + encodeURIComponent(streamName)"));
  const prefixedMulti = renderMultiStreamPage(testStreams, { basePath: '/opus/' });
  assert(prefixedMulti.includes('<script src="assets/multi.js"></script>'));
  assert(prefixedMulti.includes('href="assets/style.css"'));

  const parser = createOggOpusPacketParser({ frameDurationMs: 20 });
  const head = makeOpusHead();
  const tags = Buffer.from('OpusTags\x00\x00\x00\x00\x00\x00\x00\x00', 'binary');
  const packet = Buffer.from([0xf8, 0xff, 0xfe]);
  const headerPage = makeOggPage(0, 0, [head, tags]);
  const mediaPage = makeOggPage(1, 1272, [packet]);
  const firstChunk = Buffer.concat([headerPage, mediaPage.subarray(0, 9)]);
  const first = parser.push(firstChunk);
  assert.strictEqual(first.length, 1);
  assert.strictEqual(first[0].type, 'config');
  assert(first[0].description.subarray(0, 8).equals(Buffer.from('OpusHead')));
  const second = parser.push(mediaPage.subarray(9));
  assert.strictEqual(second.length, 1);
  assert.strictEqual(second[0].type, 'packet');
  assert.deepStrictEqual(second[0].data, packet);
  assert.strictEqual(second[0].timestampUs, 0);

  const configFrame = encodeOpusConfigFrame({
    inputSampleRate: 8000,
    channels: 1,
    frameDurationMs: 20,
    description: head,
  });
  const packetFrame = encodeOpusPacketFrame({
    sequence: 7,
    data: packet,
  });
  const decoderModule = await import('../assets/opus-webcodecs.mjs');
  const parsedConfig = decoderModule.parseOpusTransportFrame(configFrame);
  assert.strictEqual(parsedConfig.type, 'config');
  assert.strictEqual(parsedConfig.inputSampleRate, 8000);
  assert.strictEqual(parsedConfig.frameDurationMs, 20);
  const parsedPacket = decoderModule.parseOpusTransportFrame(packetFrame);
  assert.strictEqual(parsedPacket.sequence, 7);
  assert.strictEqual(parsedPacket.timestampUs, 140000);
  assert.strictEqual(parsedPacket.durationUs, 20000);
  assert.deepStrictEqual(Buffer.from(parsedPacket.data), packet);

  class FakeEncodedAudioChunk {
    constructor(fields) { Object.assign(this, fields); }
  }
  class FakeAudioData {
    constructor(timestamp) {
      this.timestamp = timestamp;
      this.numberOfFrames = 960;
      this.numberOfChannels = 1;
      this.sampleRate = 48000;
      this.closed = false;
    }
    copyTo(destination) { destination.fill(0.25); }
    close() { this.closed = true; }
  }
  class FakeAudioDecoder {
    static async isConfigSupported(config) {
      return { supported: config.codec === 'opus' && config.sampleRate === 48000 && config.numberOfChannels === 1 };
    }
    constructor({ output, error }) {
      this.output = output;
      this.error = error;
      this.state = 'unconfigured';
      this.decodeQueueSize = 0;
    }
    configure(config) {
      this.config = config;
      this.state = 'configured';
    }
    decode(chunk) { this.output(new FakeAudioData(chunk.timestamp)); }
    close() { this.state = 'closed'; }
  }
  const pcm = [];
  const decoder = new decoderModule.OpusWebCodecsDecoder({
    AudioDecoderCtor: FakeAudioDecoder,
    EncodedAudioChunkCtor: FakeEncodedAudioChunk,
    onPcm: (...args) => pcm.push(args),
  });
  await decoder.push(configFrame);
  await decoder.push(packetFrame);
  assert.strictEqual(pcm.length, 1);
  assert.strictEqual(pcm[0][1], 960);
  assert.strictEqual(pcm[0][2], 48000);
  assert.strictEqual(pcm[0][3], 1);
  assert.strictEqual(pcm[0][0][0], 0.25);
  assert.strictEqual(decoder.diagnostics().decodedSamples, 960);
  assert.strictEqual(decoder.diagnostics().droppedPackets, 0);
  decoder.close();

  // Configuration can be asynchronous. Any bounded-queue loss must be visible,
  // even when the incoming wire sequence has no missing packets.
  let resolveSupport;
  class DelayedAudioDecoder extends FakeAudioDecoder {
    static isConfigSupported() {
      return new Promise((resolve) => { resolveSupport = resolve; });
    }
  }
  const delayedDecoder = new decoderModule.OpusWebCodecsDecoder({
    AudioDecoderCtor: DelayedAudioDecoder,
    EncodedAudioChunkCtor: FakeEncodedAudioChunk,
  });
  const configuring = delayedDecoder.push(configFrame);
  for (let sequence = 0; sequence < 20; sequence += 1) {
    delayedDecoder.push(encodeOpusPacketFrame({ sequence, data: packet }));
  }
  assert.strictEqual(delayedDecoder.diagnostics().receivedPackets, 20);
  assert.strictEqual(delayedDecoder.diagnostics().droppedPackets, 4);
  assert.strictEqual(delayedDecoder.diagnostics().missingPackets, 0);
  resolveSupport({ supported: true });
  await configuring;
  assert.strictEqual(delayedDecoder.diagnostics().submittedPackets, 16);
  assert.strictEqual(delayedDecoder.diagnostics().decodedSamples, 16 * 960);
  await delayedDecoder.push(encodeOpusPacketFrame({ sequence: 19, data: packet }));
  assert.strictEqual(delayedDecoder.diagnostics().duplicatePackets, 1);
  await delayedDecoder.push(encodeOpusPacketFrame({ sequence: 21, data: packet }));
  assert.strictEqual(delayedDecoder.diagnostics().missingPackets, 1);
  assert.strictEqual(delayedDecoder.diagnostics().concealedSamples, 960);
  delayedDecoder.close();

  assert(opusNative.isAvailable(), 'native libopus addon must be built before running the tests');
  for (const sampleRate of [8000, 16000]) {
    const encoder = opusNative.createEncoder(sampleRate, 1, sampleRate === 8000 ? 12000 : 32000);
    const encoded = encoder.encode(Buffer.alloc(sampleRate / 50 * 4));
    assert(encoded.length > 0 && encoded.length < 4000);
    assert.throws(() => encoder.encode(Buffer.alloc(4)), /20 ms/);
    encoder.close();
    assert.throws(() => encoder.encode(Buffer.alloc(sampleRate / 50 * 4)), /closed/);
  }

  const timers = [];
  let creations = 0;
  let closes = 0;
  let encodes = 0;
  const stream = { name: 'tower', sampleRate: 8000, channels: 1, lastUdpAt: Date.now() };
  const shared = createSharedOpus({
    createEncoder: () => {
      creations += 1;
      return { encode: () => { encodes += 1; return Buffer.from([0xf8, 0xff, 0xfe]); }, close: () => { closes += 1; } };
    },
    sendWsBinary: (socket, data) => { socket.frames.push(Buffer.from(data)); return true; },
    setTimer: (callback, ms) => {
      const timer = { callback, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { timer.cancelled = true; },
  });
  const client = (id) => ({ clientId: id, socket: { destroyed: false, writableLength: 0, frames: [] }, droppedBytes: 0 });
  const firstClient = client('first');
  const secondClient = client('second');
  shared.attach(stream, firstClient);
  shared.attach(stream, secondClient);
  assert.strictEqual(creations, 1, 'listeners must share one encoder');
  shared.writeInput(stream, Buffer.alloc(640));
  assert.strictEqual(encodes, 1, 'one input frame must be encoded once');
  assert.deepStrictEqual(firstClient.socket.frames[1], secondClient.socket.frames[1]);
  shared.detach(stream, firstClient);
  assert.strictEqual(timers.length, 0, 'encoder must stay active with one listener');
  shared.detach(stream, secondClient);
  assert.strictEqual(timers.length, 1);
  assert.strictEqual(timers[0].ms, 10000);
  const returningClient = client('returning');
  shared.attach(stream, returningClient);
  assert.strictEqual(creations, 1, 'returning listener must reuse the encoder');
  assert(timers[0].cancelled);
  timers[0].callback();
  assert(shared.hasSession(stream), 'stale grace timer must not close a reused encoder');
  shared.detach(stream, returningClient);
  timers[1].callback();
  assert.strictEqual(closes, 1, 'encoder must close after the grace period');
  assert(!shared.hasSession(stream));
  shared.attach(stream, client('new'));
  assert.strictEqual(creations, 2, 'a new listener after grace needs a new encoder');
  shared.closeStream(stream);

  const framer = createRawPcmFramer({ frameMs: 20, now: () => 1000 });
  const frames8k = framer.push({ sampleRate: 8000, channels: 1 }, Buffer.alloc(640));
  assert.strictEqual(frames8k.length, 1);
  assert.strictEqual(frames8k[0].length, 640);
  const frames16k = framer.push({ sampleRate: 16000, channels: 1 }, Buffer.alloc(1280));
  assert.strictEqual(frames16k.length, 1);
  assert.strictEqual(frames16k[0].length, 1280);

  let clock = 1000;
  const scheduled = [];
  const delivered = [];
  const pacer = createFramePacer({
    frameMs: 20,
    now: () => clock,
    deliver: (item, frame) => delivered.push({ at: clock, frame }),
    setTimer: (callback, delay) => {
      const timer = { callback, delay };
      scheduled.push(timer);
      return timer;
    },
    clearTimer: () => {},
  });
  const pacedStream = {};
  pacer.enqueue(pacedStream, ['first']);
  clock = 1005;
  pacer.enqueue(pacedStream, ['second']);
  assert.deepStrictEqual(delivered.map((entry) => entry.frame), ['first']);
  assert.strictEqual(scheduled[0].delay, 15);
  clock = 1020;
  scheduled[0].callback();
  assert.deepStrictEqual(delivered.map((entry) => entry.at), [1000, 1020]);
  pacer.reset(pacedStream);

  // Feed 100 ms UDP batches while the server checks for silence every 20 ms.
  // Input delivery must not schedule any additional media timers.
  for (const [sampleRate, channels] of [[8000, 1], [16000, 2]]) {
    let time = 1000;
    const pending = [];
    const encoded = [];
    let dropped = 0;
    const testStream = { name: 'batched', sampleRate, channels };
    const transport = createSharedOpus({
      now: () => time,
      setTimer: (callback, delay) => {
        const timer = { callback, at: time + delay + 1, cancelled: false };
        pending.push(timer);
        return timer;
      },
      clearTimer: (timer) => { timer.cancelled = true; },
      logger: { info: () => {}, warn: (event, data) => { dropped += data.frames; } },
      createEncoder: () => ({
        encode: (frame) => { encoded.push(frame.readFloatLE(0)); return Buffer.from([0xf8]); },
        close: () => {},
      }),
      sendWsBinary: () => true,
    });
    transport.attach(testStream, client('batched'));
    const input = Buffer.alloc(sampleRate / 10 * channels * 4);
    for (let offset = 0; offset < input.length; offset += 4) input.writeFloatLE(0.25, offset);
    for (; time < 11000; time += 1) {
      for (const timer of pending.filter((item) => !item.cancelled && item.at <= time)) {
        timer.cancelled = true;
        timer.callback();
      }
      // Check silence first, including at the instant the next batch arrives.
      if (time > 1000 && time % 20 === 0) transport.writeSilence([testStream]);
      if (time % 100 === 0) transport.writeInput(testStream, input);
    }
    assert.strictEqual(pending.length, 0, 'only the browser should pace media playback');
    assert.strictEqual(dropped, 0, 'regular UDP batches must not lose source frames');
    assert.strictEqual(encoded.filter((value) => value === 0.25).length, 500);
    assert(encoded.every((value) => value === 0.25), 'silence must not interrupt real audio');
    assert.strictEqual(transport.getDiagnostics(testStream).unaccountedInputSamples, 0);
    time = 11140;
    transport.writeSilence([testStream]);
    assert.strictEqual(encoded.at(-1), 0, 'silence must resume when UDP really stops');
    transport.closeStream(testStream);
  }

  // Reproduce an event-loop stall / burst larger than the former 200 ms queue.
  // All frames must be encoded before writeInput returns, in original order.
  for (const [sampleRate, channels] of [[8000, 1], [16000, 2]]) {
    let time = 1000;
    const encoded = [];
    const testStream = { name: 'burst', sampleRate, channels };
    const transport = createSharedOpus({
      now: () => time,
      setTimer: () => { throw new Error('input must not be paced with timers'); },
      createEncoder: () => ({
        encode: (frame) => { encoded.push(frame.readFloatLE(0)); return packet; },
        close: () => {},
      }),
      sendWsBinary: () => true,
    });
    transport.attach(testStream, client('burst'));
    const frameBytes = sampleRate / 50 * channels * 4;
    const batch = Buffer.alloc(25 * frameBytes);
    for (let frame = 0; frame < 25; frame += 1) {
      for (let offset = 0; offset < frameBytes; offset += 4) batch.writeFloatLE(frame / 32, frame * frameBytes + offset);
    }
    transport.writeInput(testStream, batch);
    assert.deepStrictEqual(encoded, Array.from({ length: 25 }, (_, i) => i / 32));
    time += 300;
    transport.writeInput(testStream, batch);
    assert.strictEqual(encoded.length, 50, 'an input burst after a stall must not lose any frames');
    let diagnostics = transport.getDiagnostics(testStream);
    assert.strictEqual(diagnostics.inputSamples, sampleRate);
    assert.strictEqual(diagnostics.encodedInputSamples, sampleRate);
    assert.strictEqual(diagnostics.unaccountedInputSamples, 0);
    assert.strictEqual(diagnostics.silenceFrames, 0);
    // Retain an incomplete frame across a long input gap instead of losing it.
    transport.writeInput(testStream, batch.subarray(0, frameBytes / 2));
    time += 1000;
    transport.writeSilence([testStream]);
    transport.writeInput(testStream, batch.subarray(frameBytes / 2, frameBytes));
    diagnostics = transport.getDiagnostics(testStream);
    assert.strictEqual(diagnostics.pendingInputSamples, 0);
    assert.strictEqual(diagnostics.encodedInputSamples, sampleRate + sampleRate / 50);
    assert.strictEqual(diagnostics.unaccountedInputSamples, 0);
    assert.strictEqual(diagnostics.silenceFrames, 2);
    assert(diagnostics.skippedSilenceFrames > 0, 'a long stall must not create a backlog of synthetic silence');
    transport.closeStream(testStream);
  }

  // Alternating 19/21 ms timer intervals must still generate 50 silence
  // frames per second, so the browser remains primed between transmissions.
  {
    let time = 1000;
    let encodes = 0;
    const testStream = { name: 'silent', sampleRate: 8000, channels: 1 };
    const transport = createSharedOpus({
      now: () => time,
      createEncoder: () => ({ encode: () => { encodes += 1; return packet; }, close: () => {} }),
      sendWsBinary: () => true,
    });
    transport.attach(testStream, client('silent'));
    transport.writeSilence([testStream]);
    for (let tick = 1; tick <= 500; tick += 1) {
      time = 1000 + tick * 20 + tick % 2;
      transport.writeSilence([testStream]);
    }
    assert.strictEqual(encodes, 501, 'timer rounding must not slow down silence delivery');
    assert.strictEqual(transport.getDiagnostics(testStream).skippedSilenceFrames, 0);
    transport.closeStream(testStream);
  }

  const { MonoPcmRingBuffer } = await import('../assets/audio-ring-buffer.mjs');
  const ring = new MonoPcmRingBuffer({ inputSampleRate: 8000, channels: 2, targetLatencyMs: 20, highWaterMs: 100 });
  const stereo = new Float32Array(160 * 2);
  for (let index = 0; index < stereo.length; index += 2) {
    stereo[index] = 0.5;
    stereo[index + 1] = -0.5;
  }
  ring.appendInterleaved(stereo, 160, 2);
  assert.strictEqual(ring.availableFrames(), 160, 'ring buffer must count frames rather than individual channel samples');
  const output = new Float32Array(128);
  ring.render(output, 48000);
  const firstReadFrame = ring.readFrame;
  ring.render(output, 48000);
  assert(ring.readFrame > firstReadFrame, 'resampler phase must persist across process blocks');
  assert(Math.abs(ring.lastCorrection) <= 0.004, 'drift correction must remain bounded');
  assert(output.every((sample) => Math.abs(sample) < 0.00001), 'stereo downmix must preserve channel alignment');
  assert.strictEqual(ring.diagnostics().receivedFrames, 160);
  assert.strictEqual(ring.diagnostics().renderedFrames, 256);
  assert(ring.diagnostics().consumedFrames > 0);
  assert.strictEqual(ring.diagnostics().droppedFrames, 0);
  const overflowing = new MonoPcmRingBuffer({ inputSampleRate: 8000, targetLatencyMs: 20, highWaterMs: 100 });
  overflowing.appendInterleaved(new Float32Array(1000), 1000);
  assert.strictEqual(overflowing.diagnostics().receivedFrames, 1000);
  assert.strictEqual(overflowing.diagnostics().droppedFrames, 840, 'worklet backlog trimming must be measurable');

  console.log('Realtime Opus transport tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
