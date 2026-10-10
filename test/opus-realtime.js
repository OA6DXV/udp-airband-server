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
  decoder.close();

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

  console.log('Realtime Opus transport tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
