'use strict';

const { performance } = require('node:perf_hooks');
const { createRawPcmFramer } = require('../raw-pcm');
const { encodeOpusConfigFrame, encodeOpusPacketFrame } = require('./opus-transport');
const opusNative = require('../opus-native');

const DEFAULT_GRACE_MS = 10000;
const FRAME_MS = 20;
const MAX_SILENCE_BURST_FRAMES = 2;

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
    bitrate8k = '20k',
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
    now = Date.now,
  } = options;
  const bitrateByRate = { 8000: parseBitrate(bitrate8k), 16000: parseBitrate(bitrate16k) };
  const sessions = new Map();
  // Keep only the incomplete (<20 ms) frame. The AudioWorklet owns the
  // playback clock; a second server-side clock can delay and discard input.
  const framer = createRawPcmFramer({ frameMs: FRAME_MS, gapResetMs: Infinity, now, pendingBufferField: 'sharedOpusPending', lastInputAtField: 'sharedOpusLastInputAt' });

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
      nextSilenceAt: now(),
      silenceAfter: 0,
      lastInputAt: null,
      lastDiagnosticsAt: now(),
      inputSamples: 0,
      encodedInputSamples: 0,
      encodedFrames: 0,
      silenceFrames: 0,
      skippedSilenceFrames: 0,
      encodeErrors: 0,
      droppedClientPackets: 0,
      maxInputGapMs: 0,
      maxBatchFrames: 0,
      maxEncodeTimeMs: 0,
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
    const diagnostics = getDiagnostics(stream);
    sessions.delete(stream);
    framer.reset(stream);
    session.encoder.close();
    for (const client of session.clients) client.sharedOpusSession = null;
    session.clients.clear();
    if (logger) logger.info('opus_encoder_stop', { stream: stream.name, reason, ...diagnostics });
  }

  function getDiagnostics(stream) {
    const session = sessions.get(stream);
    if (!session) return null;
    const pendingInputSamples = (stream.sharedOpusPending?.length || 0) / (stream.channels * Float32Array.BYTES_PER_ELEMENT);
    return {
      sampleRate: stream.sampleRate,
      inputSamples: session.inputSamples,
      encodedInputSamples: session.encodedInputSamples,
      pendingInputSamples,
      unaccountedInputSamples: session.inputSamples - session.encodedInputSamples - pendingInputSamples,
      encodedFrames: session.encodedFrames,
      silenceFrames: session.silenceFrames,
      skippedSilenceFrames: session.skippedSilenceFrames,
      encodeErrors: session.encodeErrors,
      droppedClientPackets: session.droppedClientPackets,
      maxInputGapMs: session.maxInputGapMs,
      maxBatchFrames: session.maxBatchFrames,
      maxEncodeTimeMs: Number(session.maxEncodeTimeMs.toFixed(3)),
    };
  }

  function writeInput(stream, input) {
    const session = sessions.get(stream);
    if (!session) return;
    const timestamp = now();
    const samples = input.length / (stream.channels * Float32Array.BYTES_PER_ELEMENT);
    const durationMs = samples / stream.sampleRate * 1000;
    session.inputSamples += samples;
    if (session.lastInputAt !== null) session.maxInputGapMs = Math.max(session.maxInputGapMs, timestamp - session.lastInputAt);
    session.lastInputAt = timestamp;
    // A UDP datagram can carry several 20 ms frames. Do not fill its normal
    // inter-packet gap with silence, even after the final frame is dispatched.
    session.silenceAfter = timestamp + Math.max(60, durationMs + FRAME_MS);
    session.nextSilenceAt = session.silenceAfter;
    const frames = framer.push(stream, input);
    session.maxBatchFrames = Math.max(session.maxBatchFrames, frames.length);
    for (const frame of frames) {
      if (!encodeFrame(stream, frame)) break;
    }
  }

  function writeSilence(streams, timestamp = now()) {
    for (const stream of streams) {
      const session = sessions.get(stream);
      if (!session) continue;
      if (timestamp - session.lastDiagnosticsAt >= 10000) {
        session.lastDiagnosticsAt = timestamp;
        if (logger?.debug) logger.debug('opus_audio_diagnostics', { stream: stream.name, ...getDiagnostics(stream) });
      }
      if (timestamp < session.silenceAfter) continue;
      const dueFrames = Math.floor((timestamp - session.nextSilenceAt) / FRAME_MS) + 1;
      if (dueFrames <= 0) continue;
      // Anchor silence to absolute deadlines: a 19 ms timer tick must not
      // turn a 50 fps keepalive into ~33 fps. Never catch up a long pause with
      // stale synthetic audio before pending real UDP packets can be handled.
      const frames = Math.min(MAX_SILENCE_BURST_FRAMES, dueFrames);
      session.nextSilenceAt += dueFrames * FRAME_MS;
      session.skippedSilenceFrames += dueFrames - frames;
      const samples = stream.sampleRate / 50 * stream.channels;
      const silence = Buffer.alloc(samples * Float32Array.BYTES_PER_ELEMENT);
      for (let frame = 0; frame < frames; frame += 1) {
        if (!encodeFrame(stream, silence, true)) break;
      }
    }
  }

  function encodeFrame(stream, frame, silence = false) {
    const session = sessions.get(stream);
    if (!session) return false;
    let packet;
    const startedAt = performance.now();
    try {
      packet = session.encoder.encode(monoPcm(frame, stream.channels));
    } catch (error) {
      session.encodeErrors += 1;
      if (logger) logger.error('opus_encode_error', { stream: stream.name, error: error.message });
      for (const client of Array.from(session.clients)) onClientFailure(stream, client);
      closeStream(stream, 'encode_error');
      return false;
    }
    session.maxEncodeTimeMs = Math.max(session.maxEncodeTimeMs, performance.now() - startedAt);
    session.encodedFrames += 1;
    if (silence) session.silenceFrames += 1;
    else session.encodedInputSamples += stream.sampleRate / 50;
    const transportFrame = encodeOpusPacketFrame({ sequence: session.sequence++, data: packet });
    for (const client of Array.from(session.clients)) {
      const socket = client.socket;
      if (!socket || socket.destroyed || socket.writableLength > maxSocketBufferBytes) {
        onClientFailure(stream, client);
        continue;
      }
      if (socket.writableLength > 65536) {
        client.droppedBytes += transportFrame.length;
        session.droppedClientPackets += 1;
        client.droppedPackets = (client.droppedPackets || 0) + 1;
        if (logger && (!client.lastDropLogAt || now() - client.lastDropLogAt >= 10000)) {
          client.lastDropLogAt = now();
          logger.warn('opus_client_packet_dropped', { stream: stream.name, packets: client.droppedPackets, writableLength: socket.writableLength });
        }
        continue;
      }
      sendWsBinary(socket, transportFrame);
      onPacket(stream, client, transportFrame.length);
    }
    return true;
  }

  return { attach, closeStream, detach, getDiagnostics, hasSession: (stream) => sessions.has(stream), sessions, writeInput, writeSilence };
}

module.exports = { createSharedOpus, parseBitrate, supportsStream };
