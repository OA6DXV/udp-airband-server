'use strict';

const { ADPCM_FRAME_MS, OPUS_BITRATE_8K, OPUS_BITRATE_16K } = require('../audio-profiles');
const { encodeAdpcmFrames } = require('./adpcm');
const { createSharedOpus, supportsStream } = require('./shared-opus');
const opusNative = require('../opus-native');

const OPUS_MODE = 'opus-live';

function createCompressedManager(options) {
  const {
    addListenerBytes,
    addListenerMode,
    removeListenerMode,
    sendWsBinary,
    maxSocketBufferBytes = 1024 * 1024,
    logger,
    debugEnabled,
  } = options;
  if (!opusNative.isAvailable()) {
    throw new Error('The low data profile requires native libopus: ' + opusNative.availabilityError());
  }
  const sharedOpus = createSharedOpus({
    bitrate8k: OPUS_BITRATE_8K,
    bitrate16k: OPUS_BITRATE_16K,
    logger,
    maxSocketBufferBytes,
    onClientFailure: cleanupClient,
    onPacket: (stream, client, bytes) => addListenerBytes(stream, client.clientId, OPUS_MODE, bytes),
    sendWsBinary,
  });

  function serveWebSocket(stream, clientId, socket, mode) {
    if (mode !== 'adpcm' && mode !== OPUS_MODE) {
      socket.destroy();
      return;
    }
    if (mode === OPUS_MODE && !supportsStream(stream)) {
      socket.destroy();
      return;
    }
    const client = { clientId, mode, socket, droppedBytes: 0, backpressured: false };
    stream.opusClients.add(client);
    addListenerMode(stream, clientId, mode);
    socket.on('close', () => cleanupClient(stream, client));
    socket.on('error', () => cleanupClient(stream, client));
    socket.on('drain', () => { client.backpressured = false; });
    if (mode === OPUS_MODE) {
      try {
        sharedOpus.attach(stream, client);
      } catch (error) {
        if (logger) logger.error('opus_encoder_start_failed', { stream: stream.name, error: error.message });
        cleanupClient(stream, client);
      }
    }
  }

  function cleanupClient(stream, client) {
    if (!stream.opusClients.delete(client)) return;
    if (client.mode === OPUS_MODE) sharedOpus.detach(stream, client);
    removeListenerMode(stream, client.clientId, client.mode);
    if (debugEnabled && logger) logger.debug('compressed_client_cleanup', {
      stream: stream.name, mode: client.mode, client: client.clientId, droppedBytes: client.droppedBytes,
    });
    if (!client.socket.destroyed) client.socket.destroy();
  }

  function writeStreamInput(stream, buffer) {
    // Encode once and share identical ADPCM frames between listeners.
    const clients = Array.from(stream.opusClients).filter(client => client.mode === 'adpcm');
    const frames = clients.length ? encodeAdpcmFrames(stream, buffer, ADPCM_FRAME_MS) : [];
    for (const client of clients) {
      if (client.socket.destroyed || client.socket.writableLength > maxSocketBufferBytes) {
        cleanupClient(stream, client);
        continue;
      }
      if (client.backpressured) {
        client.droppedBytes += buffer.length;
        continue;
      }
      for (const frame of frames) {
        if (!sendWsBinary(client.socket, frame)) client.backpressured = true;
        addListenerBytes(stream, client.clientId, 'adpcm', frame.length);
      }
    }
    sharedOpus.writeInput(stream, buffer);
  }

  return {
    closeStream: sharedOpus.closeStream,
    getOpusDiagnostics: sharedOpus.getDiagnostics,
    cleanupClient,
    isRealtimeStreamSupported: supportsStream,
    serveWebSocket,
    writeOpusRealtimeSilence: sharedOpus.writeSilence,
    writeStreamInput,
  };
}

module.exports = { createCompressedManager };
