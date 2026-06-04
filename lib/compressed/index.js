'use strict';

const { aacWebSocketArgs } = require('./aac-websocket');
const { encodeAdpcmFrames } = require('./adpcm');
const { createHlsAac } = require('./hls-aac');
const { opusHttpArgs, opusWebSocketArgs } = require('./opus-websocket');

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
    opusBitrate,
    logger,
    debugEnabled,
  } = options;

  const ffmpegAvailable = hasFfmpeg(ffmpegPath, spawnSync);
  const available = true;
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

  function serveHttpOpus(stream, requestUrl, res) {
    if (!ffmpegAvailable) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('OPUS unavailable: ffmpeg not found\n');
      return;
    }

    const clientId = normalizeClientId(requestUrl.searchParams.get('clientId'));
    addListenerMode(stream, clientId, 'opus');

    res.writeHead(200, {
      'content-type': 'audio/ogg; codecs=opus',
      'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'pragma': 'no-cache',
      'expires': '0',
      'connection': 'close',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
    });

    const args = prepareFfmpegArgs(opusHttpArgs(stream, opusBitrate), debugEnabled);
    const ffmpeg = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', debugEnabled ? 'pipe' : 'ignore'] });
    const opusClient = { clientId, ffmpeg, res, backpressured: false, droppedBytes: 0 };
    stream.opusClients.add(opusClient);
    attachFfmpegLogging(ffmpeg, stream, opusClient, 'opus-http', args, logger, debugEnabled);

    ffmpeg.stdout.on('data', (chunk) => {
      if (res.destroyed) {
        cleanupClient(stream, opusClient);
        return;
      }
      if (!res.write(chunk)) {
        if (debugEnabled) logger.debug('client_backpressure', { stream: stream.name, mode: 'opus-http', client: clientId, writableLength: res.writableLength });
        ffmpeg.stdout.pause();
        res.once('drain', () => ffmpeg.stdout.resume());
      }
      addListenerBytes(stream, clientId, 'opus', chunk.length);
    });

    ffmpeg.stdin.on('drain', () => {
      opusClient.backpressured = false;
    });
    ffmpeg.on('close', () => cleanupClient(stream, opusClient));
    res.on('close', () => cleanupClient(stream, opusClient));
  }

  function serveWebSocket(stream, clientId, socket, mode) {
    if (mode === 'adpcm') {
      serveAdpcmWebSocket(stream, clientId, socket);
      return;
    }

    if (!ffmpegAvailable) {
      socket.destroy();
      return;
    }

    addListenerMode(stream, clientId, mode);
    const args = prepareFfmpegArgs(webSocketArgs(stream, mode), debugEnabled);
    const ffmpeg = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', debugEnabled ? 'pipe' : 'ignore'] });
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

  function webSocketArgs(stream, mode) {
    if (mode === 'aac') return aacWebSocketArgs(stream, aacBitrate);
    return opusWebSocketArgs(stream, opusBitrate);
  }

  function cleanupClient(stream, opusClient) {
    if (!stream.opusClients.has(opusClient)) return;
    stream.opusClients.delete(opusClient);
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
    if (opusClient.mode === 'adpcm') {
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
        if (opusClient.mode === 'adpcm') {
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
    cleanupClient,
    ffmpegAvailable,
    isWritableClient,
    isCodecAvailable: (codec) => codec === 'adpcm' || ffmpegAvailable,
    pruneInactiveHlsClients: hlsAac.pruneInactiveClients,
    serveHls,
    serveHttpOpus,
    serveWebSocket,
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
  if (!debugEnabled || !logger) return;
  logger.debug('ffmpeg_start', {
    stream: stream.name,
    mode,
    client: client.clientId,
    pid: ffmpeg.pid,
    args: args.join(' '),
  });
  ffmpeg.stderr.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) {
        logger.debug('ffmpeg_stderr', {
          stream: stream.name,
          mode,
          client: client.clientId,
          pid: ffmpeg.pid,
          message: line.trim(),
        });
      }
    }
  });
  ffmpeg.on('error', (err) => {
    logger.error('ffmpeg_error', {
      stream: stream.name,
      mode,
      client: client.clientId,
      error: err.message,
    });
  });
  ffmpeg.on('close', (code, signal) => {
    logger.debug('ffmpeg_close', {
      stream: stream.name,
      mode,
      client: client.clientId,
      pid: ffmpeg.pid,
      code,
      signal,
    });
  });
}

function hasFfmpeg(ffmpegPath, spawnSync) {
  const result = spawnSync(ffmpegPath, ['-version'], { stdio: 'ignore' });
  return result.status === 0;
}

module.exports = {
  createCompressedManager,
};
