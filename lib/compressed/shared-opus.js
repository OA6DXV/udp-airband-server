'use strict';

const { createFramePacer } = require('../frame-pacer');
const { createRawPcmFramer } = require('../raw-pcm');
const { encodeOpusConfigFrame, encodeOpusPacketFrame } = require('./ogg-opus');
const opusNative = require('../opus-native');

const DEFAULT_GRACE_MS = 10000;
const FRAME_MS = 20;

function parseBitrate(value) {
  const match = String(value).trim().match(/^(\d+)(k)?$/i);
  if (!match) throw new Error(`Invalid Opus bitrate: ${value}`);
  const bitrate = Number(match[1]) * (match[2] ? 1000 : 1);
  if (!Number.isInteger(bitrate) || bitrate < 6000 || bitrate > 128000) {
    throw new Error(`Opus bitrate must be between 6k and 128k: ${value}`);
  }
  return bitrate;
}

function supportsStream(stream) {
  return (stream.sampleRate === 8000 || stream.sampleRate === 16000) && (stream.channels === 1 || stream.channels === 2);
}

function opusHead(sampleRate) {
  const head = Buffer.alloc(19);
  head.write('OpusHead', 0, 'ascii');
  head.writeUInt8(1, 8);
  head.writeUInt8(1, 9);
  head.writeUInt16LE(0, 10);
  head.writeUInt32LE(sampleRate, 12);
  return head;
}

function monoPcm(frame, channels) {
  if (channels === 1) return frame;
  const output = Buffer.allocUnsafe(frame.length / 2);
  for (let offset = 0; offset < output.length; offset += 4) {
    const left = frame.readFloatLE(offset * 2);
    const right = frame.readFloatLE(offset * 2 + 4);
    output.writeFloatLE((left + right) * 0.5, offset);
  }
  return output;
}

function createSharedOpus(options) {
  const {
    bitrate8k = '12k',
    bitrate16k = '32k',
    createEncoder = opusNative.createEncoder,
    graceMs = DEFAULT_GRACE_MS,
    logger,
    maxSocketBufferBytes = 1024 * 1024,
    onClientFailure = () => {},
    onPacket = () => {},
    sendWsBinary,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = options;
  const bitrateByRate = { 8000: parseBitrate(bitrate8k), 16000: parseBitrate(bitrate16k) };
  const sessions = new Map();
  const framer = createRawPcmFramer({ frameMs: FRAME_MS, pendingBufferField: 'sharedOpusPending', lastInputAtField: 'sharedOpusLastInputAt' });
  const pacer = createFramePacer({ frameMs: FRAME_MS, deliver: encodeFrame, onDrop: (stream, frames) => {
    if (logger) logger.warn('opus_input_frames_dropped', { stream: stream.name, frames: frames.length });
  } });

  function createSession(stream) {
    if (!supportsStream(stream)) throw new Error(`Realtime Opus requires an 8k or 16k stream: ${stream.name}`);
    const bitrate = bitrateByRate[stream.sampleRate];
    const encoder = createEncoder(stream.sampleRate, 1, bitrate);
    const session = {
      stream,
      encoder,
      bitrate,
      clients: new Set(),
      sequence: 0,
      expiryTimer: null,
      lastSilenceAt: 0,
      configFrame: encodeOpusConfigFrame({
        inputSampleRate: stream.sampleRate,
        channels: 1,
        frameDurationMs: FRAME_MS,
        description: opusHead(stream.sampleRate),
      }),
    };
    sessions.set(stream, session);
    if (logger) logger.info('opus_encoder_start', { stream: stream.name, sampleRate: stream.sampleRate, bitrate });
    return session;
  }

  function attach(stream, client) {
    const session = sessions.get(stream) || createSession(stream);
    if (session.expiryTimer !== null) {
      clearTimer(session.expiryTimer);
      session.expiryTimer = null;
      if (logger) logger.debug('opus_encoder_reused', { stream: stream.name });
    }
    session.clients.add(client);
    client.sharedOpusSession = session;
    if (!sendWsBinary(client.socket, session.configFrame)) {
      onClientFailure(stream, client);
      return false;
    }
    onPacket(stream, client, session.configFrame.length);
    return true;
  }

  function detach(stream, client) {
    const session = client.sharedOpusSession;
    if (!session || sessions.get(stream) !== session) return;
    client.sharedOpusSession = null;
    session.clients.delete(client);
    if (session.clients.size || session.expiryTimer !== null) return;
    session.expiryTimer = setTimer(() => {
      if (sessions.get(stream) === session && session.clients.size === 0) closeStream(stream, 'idle_timeout');
    }, graceMs);
    if (typeof session.expiryTimer?.unref === 'function') session.expiryTimer.unref();
    if (logger) logger.info('opus_encoder_grace', { stream: stream.name, graceMs });
  }

  function closeStream(stream, reason = 'stream_closed') {
    const session = sessions.get(stream);
    if (!session) return;
    if (session.expiryTimer !== null) clearTimer(session.expiryTimer);
    sessions.delete(stream);
    pacer.reset(stream);
    framer.reset(stream);
    session.encoder.close();
    for (const client of session.clients) client.sharedOpusSession = null;
    session.clients.clear();
    if (logger) logger.info('opus_encoder_stop', { stream: stream.name, reason });
  }

  function writeInput(stream, input) {
    if (!sessions.has(stream)) return;
    pacer.enqueue(stream, framer.push(stream, input));
  }

  function writeSilence(streams, now = Date.now()) {
    for (const stream of streams) {
      const session = sessions.get(stream);
      if (!session || (stream.lastUdpAt && now - stream.lastUdpAt < 60)) continue;
      if (now - session.lastSilenceAt < FRAME_MS) continue;
      session.lastSilenceAt = now;
      const samples = stream.sampleRate / 50 * stream.channels;
      pacer.enqueue(stream, [Buffer.alloc(samples * Float32Array.BYTES_PER_ELEMENT)]);
    }
  }

  function encodeFrame(stream, frame) {
    const session = sessions.get(stream);
    if (!session) return;
    let packet;
    try {
      packet = session.encoder.encode(monoPcm(frame, stream.channels));
    } catch (error) {
      if (logger) logger.error('opus_encode_error', { stream: stream.name, error: error.message });
      for (const client of Array.from(session.clients)) onClientFailure(stream, client);
      closeStream(stream, 'encode_error');
      return;
    }
    const transportFrame = encodeOpusPacketFrame({ sequence: session.sequence++, data: packet });
    for (const client of Array.from(session.clients)) {
      const socket = client.socket;
      if (!socket || socket.destroyed || socket.writableLength > maxSocketBufferBytes) {
        onClientFailure(stream, client);
        continue;
      }
      if (socket.writableLength > 65536) {
        client.droppedBytes += transportFrame.length;
        continue;
      }
      sendWsBinary(socket, transportFrame);
      onPacket(stream, client, transportFrame.length);
    }
  }

  return { attach, closeStream, detach, hasSession: (stream) => sessions.has(stream), sessions, writeInput, writeSilence };
}

module.exports = { createSharedOpus, parseBitrate, supportsStream };
