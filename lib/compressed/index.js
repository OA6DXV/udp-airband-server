'use strict';

const { aacWebSocketArgs } = require('./aac-websocket');
const { encodeAdpcmFrames } = require('./adpcm');
const { createHlsAac } = require('./hls-aac');
const { createSharedOpus, supportsStream } = require('./shared-opus');
const opusNative = require('../opus-native');

const OPUS_REALTIME_MODE = 'opus-live';

function createCompressedManager(options) {
  const {
    aacBitrate,
    adpcmFrameMs,
    addListenerBytes,
    addListenerMode,
    ffmpegPath,
    fs,
    hlsRoot,
    maxSocketBufferBytes,
    maxStdinBufferBytes,
    normalizeClientId,
    path,
    removeListenerMode,
    sendWsBinary,
    spawn,
    spawnSync,
    opusRealtimeBitrate8k = '12k',
    opusRealtimeBitrate16k = '32k',
    logger,
    debugEnabled,
  } = options;

  const ffmpegAvailable = hasFfmpeg(ffmpegPath, spawnSync);
  const opusRealtimeAvailable = opusNative.isAvailable();
  if (!opusRealtimeAvailable && logger) logger.warn('opus_native_unavailable', { error: opusNative.availabilityError() });
  const available = true;
  const sharedOpus = createSharedOpus({
    bitrate8k: opusRealtimeBitrate8k,
    bitrate16k: opusRealtimeBitrate16k,
    logger,
    maxSocketBufferBytes,
    onClientFailure: cleanupClient,
    onPacket: (stream, client, bytes) => addListenerBytes(stream, client.clientId, OPUS_REALTIME_MODE, bytes),
    sendWsBinary,
  });
  const hlsAac = createHlsAac({
    aacBitrate,
    addListenerBytes,
    addListenerMode,
    cleanupClient,
    ffmpegPath,
    fs,
    hlsRoot,
    logger,
    path,
    spawn,
    debugEnabled,
  });

  function serveHls(stream, rawClientId, fileName, res) {
    if (!ffmpegAvailable) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Compressed audio unavailable: ffmpeg not found\n');
      return;
    }
    hlsAac.serve(stream, rawClientId, fileName, res, normalizeClientId);
  }


  function serveWebSocket(stream, clientId, socket, mode) {
    if (mode === 'adpcm') {
      serveAdpcmWebSocket(stream, clientId, socket);
      return;
    }
    if (mode === OPUS_REALTIME_MODE) {
      serveOpusRealtimeWebSocket(stream, clientId, socket);
      return;
    }

    if (mode !== 'aac' || !ffmpegAvailable) {
      socket.destroy();
      return;
    }

    addListenerMode(stream, clientId, mode);
    const args = prepareFfmpegArgs(aacWebSocketArgs(stream, aacBitrate), debugEnabled);
    const ffmpeg = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', shouldCaptureFfmpegStderr(logger) ? 'pipe' : 'ignore'] });
    const opusClient = { clientId, mode, ffmpeg, socket, backpressured: false, droppedBytes: 0 };
    stream.opusClients.add(opusClient);
    attachFfmpegLogging(ffmpeg, stream, opusClient, mode, args, logger, debugEnabled);

    ffmpeg.stdout.on('data', (chunk) => {
      if (socket.destroyed) {
        cleanupClient(stream, opusClient);
        return;
      }
      if (!sendWsBinary(socket, chunk)) {
        if (debugEnabled) logger.debug('client_backpressure', { stream: stream.name, mode, client: clientId, writableLength: socket.writableLength });
        ffmpeg.stdout.pause();
        socket.once('drain', () => ffmpeg.stdout.resume());
      }
      addListenerBytes(stream, clientId, mode, chunk.length);
    });

    ffmpeg.stdin.on('drain', () => {
      opusClient.backpressured = false;
    });
    ffmpeg.on('close', () => cleanupClient(stream, opusClient));
    socket.on('close', () => cleanupClient(stream, opusClient));
    socket.on('error', () => cleanupClient(stream, opusClient));
  }

  function serveOpusRealtimeWebSocket(stream, clientId, socket) {
    if (!opusRealtimeAvailable || !supportsStream(stream)) {
      socket.destroy();
      return;
    }
    const opusClient = { clientId, mode: OPUS_REALTIME_MODE, stream, socket, droppedBytes: 0 };
    stream.opusClients.add(opusClient);
    addListenerMode(stream, clientId, OPUS_REALTIME_MODE);
    try {
      sharedOpus.attach(stream, opusClient);
    } catch (error) {
      logger.error('opus_encoder_start_failed', { stream: stream.name, error: error.message });
      cleanupClient(stream, opusClient);
      return;
    }
    socket.on('close', () => cleanupClient(stream, opusClient));
    socket.on('error', () => cleanupClient(stream, opusClient));
  }

  function serveAdpcmWebSocket(stream, clientId, socket) {
    addListenerMode(stream, clientId, 'adpcm');
    const opusClient = { clientId, mode: 'adpcm', socket, backpressured: false, droppedBytes: 0 };
    stream.opusClients.add(opusClient);
    if (debugEnabled) logger.debug('compressed_client_connected', { stream: stream.name, mode: 'adpcm', client: clientId });

    socket.on('drain', () => {
      opusClient.backpressured = false;
    });
    socket.on('close', () => cleanupClient(stream, opusClient));
    socket.on('error', () => cleanupClient(stream, opusClient));
  }

  function cleanupClient(stream, opusClient) {
    if (!stream.opusClients.has(opusClient)) return;
    stream.opusClients.delete(opusClient);
    if (opusClient.mode === OPUS_REALTIME_MODE) sharedOpus.detach(stream, opusClient);
    if (opusClient.mode === 'hls') {
      stream.hlsClients.delete(opusClient.clientId);
    }
    if (debugEnabled) {
      logger.debug('compressed_client_cleanup', {
        stream: stream.name,
        mode: opusClient.mode || 'opus',
        client: opusClient.clientId,
        droppedBytes: opusClient.droppedBytes,
      });
    }
    removeListenerMode(stream, opusClient.clientId, opusClient.mode || 'opus');
    if (opusClient.ffmpeg && !opusClient.ffmpeg.killed) {
      opusClient.ffmpeg.kill('SIGTERM');
    }
    if (opusClient.res && !opusClient.res.destroyed) {
      opusClient.res.end();
    }
    if (opusClient.socket && !opusClient.socket.destroyed) {
      opusClient.socket.destroy();
    }
    if (opusClient.dir) {
      fs.rm(opusClient.dir, { recursive: true, force: true }, () => {});
    }
  }

  function isWritableClient(opusClient) {
    if (opusClient.mode === 'adpcm' || opusClient.mode === OPUS_REALTIME_MODE) {
      return opusClient.socket
        && !opusClient.socket.destroyed
        && opusClient.socket.writableLength <= maxSocketBufferBytes;
    }

    let outputWritable = true;
    if (opusClient.res) {
      outputWritable = !opusClient.res.destroyed;
    } else if (opusClient.socket) {
      outputWritable = !opusClient.socket.destroyed;
    }

    return outputWritable
      && !opusClient.ffmpeg.killed
      && opusClient.ffmpeg.stdin.writable
      && opusClient.ffmpeg.stdin.writableLength <= maxStdinBufferBytes;
  }

  function writeInput(stream, opusClient, buffer) {
    if (opusClient.mode === 'adpcm') {
      writeAdpcmInput(stream, opusClient, buffer);
      return;
    }

    const ok = opusClient.ffmpeg.stdin.write(buffer);
    if (!ok) {
      opusClient.backpressured = true;
      if (debugEnabled) logger.debug('ffmpeg_stdin_backpressure', { stream: stream.name, mode: opusClient.mode || 'opus', client: opusClient.clientId, writableLength: opusClient.ffmpeg.stdin.writableLength });
    }
    const stats = options.ensureListenerStats(stream, opusClient.clientId);
    stats.opusInputBytes += buffer.length;
    stats.lastSeenAt = Date.now();
  }

  function writeStreamInput(stream, buffer) {
    for (const opusClient of stream.opusClients) {
      if (opusClient.mode === OPUS_REALTIME_MODE) continue;
      if (!isWritableClient(opusClient)) {
        cleanupClient(stream, opusClient);
        continue;
      }
      if (opusClient.backpressured) {
        opusClient.droppedBytes += buffer.length;
        continue;
      }
      writeInput(stream, opusClient, buffer);
    }
    sharedOpus.writeInput(stream, buffer);
  }

  function writeOpusRealtimeSilence(streams, now = Date.now()) {
    sharedOpus.writeSilence(streams, now);
  }

  function writeAdpcmInput(stream, opusClient, buffer) {
    const frames = encodeAdpcmFrames(stream, buffer, adpcmFrameMs);
    for (const frame of frames) {
      if (!isWritableClient(opusClient) || opusClient.backpressured) {
        opusClient.droppedBytes += buffer.length;
        if (debugEnabled) logger.debug('adpcm_frame_dropped', { stream: stream.name, client: opusClient.clientId, bytes: buffer.length, droppedBytes: opusClient.droppedBytes });
        return;
      }
      const ok = sendWsBinary(opusClient.socket, frame);
      if (!ok) {
        opusClient.backpressured = true;
        if (debugEnabled) logger.debug('adpcm_socket_backpressure', { stream: stream.name, client: opusClient.clientId, writableLength: opusClient.socket.writableLength });
      }
      addListenerBytes(stream, opusClient.clientId, 'adpcm', frame.length);
    }
  }

  function writeSilenceKeepalive(streams, opusKeepaliveMs) {
    if (!ffmpegAvailable) return;

    const now = Date.now();
    for (const stream of streams) {
      if (stream.opusClients.size === 0 || !stream.lastUdpAt || now - stream.lastUdpAt < opusKeepaliveMs * 2) {
        continue;
      }

      for (const opusClient of stream.opusClients) {
        if (opusClient.mode === 'adpcm' || opusClient.mode === OPUS_REALTIME_MODE) {
          continue;
        }
        if (!isWritableClient(opusClient)) {
          cleanupClient(stream, opusClient);
          continue;
        }
        if (!opusClient.backpressured) {
          writeInput(stream, opusClient, stream.silenceBuffer);
        }
      }
    }
  }

  return {
    available,
    closeStream: sharedOpus.closeStream,
    cleanupClient,
    ffmpegAvailable,
    opusRealtimeAvailable,
    isWritableClient,
    isRealtimeStreamSupported: supportsStream,
    isCodecAvailable: (codec) => codec === 'adpcm' || (codec === 'opus' ? opusRealtimeAvailable : ffmpegAvailable),
    pruneInactiveHlsClients: hlsAac.pruneInactiveClients,
    serveHls,
    serveWebSocket,
    writeOpusRealtimeSilence,
    writeStreamInput,
    writeInput,
    writeSilenceKeepalive,
  };
}

function prepareFfmpegArgs(args, debugEnabled) {
  if (!debugEnabled) return args;
  const out = args.slice();
  const loglevelIndex = out.indexOf('-loglevel');
  if (loglevelIndex !== -1 && loglevelIndex + 1 < out.length) {
    out[loglevelIndex + 1] = 'debug';
  }
  return out;
}

function attachFfmpegLogging(ffmpeg, stream, client, mode, args, logger, debugEnabled) {
  if (!logger) return;
  logger.debug('ffmpeg_start', {
    stream: stream.name,
    mode,
    client: client.clientId,
    pid: ffmpeg.pid,
    args: args.join(' '),
  });
  if (ffmpeg.stderr) {
    ffmpeg.stderr.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) {
          const fields = {
            stream: stream.name,
            mode,
            client: client.clientId,
            pid: ffmpeg.pid,
            message: line.trim(),
          };
          if (debugEnabled) {
            logger.debug('ffmpeg_stderr', fields);
          } else {
            logger.error('ffmpeg_stderr', fields);
          }
        }
      }
    });
  }
  ffmpeg.on('error', (err) => {
    logger.error('ffmpeg_error', {
      stream: stream.name,
      mode,
      client: client.clientId,
      error: err.message,
    });
  });
  ffmpeg.on('close', (code, signal) => {
    const fields = {
      stream: stream.name,
      mode,
      client: client.clientId,
      pid: ffmpeg.pid,
      code,
      signal,
    };
    if (code === 0 || signal === 'SIGTERM') {
      logger.debug('ffmpeg_close', fields);
    } else {
      logger.error('ffmpeg_close', fields);
    }
  });
}

function shouldCaptureFfmpegStderr(logger) {
  return Boolean(logger && (logger.shouldLog('error') || logger.debugEnabled));
}

function hasFfmpeg(ffmpegPath, spawnSync) {
  const result = spawnSync(ffmpegPath, ['-version'], { stdio: 'ignore' });
  return result.status === 0;
}

module.exports = {
  createCompressedManager,
};
