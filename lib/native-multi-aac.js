'use strict';

function createNativeMultiAac(options) {
  const {
    aacBitrate,
    addListenerBytes,
    addListenerMode,
    ffmpegPath,
    logger,
    onClientConnected,
    onClientDisconnected,
    removeListenerMode,
    spawn,
    streamsByName,
  } = options;

  const sessions = new Map();
  const frameMs = 20;
  const primingFrames = 4;
  const maxQueuedChunks = 8;

  function serve(requestUrl, res, normalizeClientId) {
    const clientId = normalizeClientId(requestUrl.searchParams.get('clientId'));
    const streamNames = String(requestUrl.searchParams.get('streams') || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const selectedStreams = streamNames.map((name) => streamsByName.get(name)).filter(Boolean);
    if (selectedStreams.length === 0) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('no streams selected\n');
      return;
    }

    cleanupSession(sessions.get(clientId));
    res.writeHead(200, {
      'content-type': 'audio/aac',
      'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'pragma': 'no-cache',
      'expires': '0',
      'connection': 'close',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const session = createSession(clientId, selectedStreams, res);
    sessions.set(clientId, session);
    if (onClientConnected) onClientConnected(clientId);
    for (const stream of selectedStreams) addListenerMode(stream, clientId, 'native-aac');

    res.on('close', () => cleanupSession(session));
  }

  function createSession(clientId, selectedStreams, res) {
    const sampleRate = selectedStreams[0].sampleRate;
    const frameCount = Math.max(1, Math.round(sampleRate * frameMs / 1000));
    const queues = new Map(selectedStreams.map((stream) => [stream.name, []]));
    const gains = new Map(selectedStreams.map((stream) => [stream.name, 1]));
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-fflags', 'nobuffer',
      '-f', 'f32le',
      '-ar', String(sampleRate),
      '-ac', '1',
      '-i', 'pipe:0',
      '-vn',
      '-c:a', 'aac',
      '-flags', 'low_delay',
      '-b:a', aacBitrate,
      '-ar', '16000',
      '-max_delay', '0',
      '-muxdelay', '0',
      '-muxpreload', '0',
      '-flush_packets', '1',
      '-f', 'adts',
      'pipe:1',
    ];
    const ffmpeg = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', logger && logger.shouldLog('error') ? 'pipe' : 'ignore'] });
    const session = {
      clientId,
      selectedStreams,
      streamNames: new Set(selectedStreams.map((stream) => stream.name)),
      sampleRate,
      frameCount,
      queues,
      gains,
      ffmpeg,
      res,
      timer: null,
      backpressured: false,
    };

    if (logger) logger.debug('native_multi_aac_start', { client: clientId, streams: selectedStreams.map((stream) => stream.name).join(','), pid: ffmpeg.pid });

    ffmpeg.stdout.on('data', (chunk) => {
      if (res.destroyed) {
        cleanupSession(session);
        return;
      }
      if (!res.write(chunk)) {
        ffmpeg.stdout.pause();
        res.once('drain', () => ffmpeg.stdout.resume());
      }
      for (const stream of selectedStreams) addListenerBytes(stream, clientId, 'native-aac', chunk.length);
    });
    if (ffmpeg.stderr) {
      ffmpeg.stderr.on('data', (chunk) => {
        if (!logger) return;
        for (const line of String(chunk).split(/\r?\n/)) {
          if (line.trim()) logger.error('native_multi_aac_ffmpeg', { client: clientId, message: line.trim() });
        }
      });
    }
    ffmpeg.stdin.on('drain', () => {
      session.backpressured = false;
    });
    ffmpeg.on('close', () => cleanupSession(session));
    ffmpeg.on('error', (err) => {
      if (logger) logger.error('native_multi_aac_error', { client: clientId, error: err.message });
      cleanupSession(session);
    });

    session.timer = setInterval(() => writeMixedFrame(session), frameMs);
    for (let frame = 0; frame < primingFrames && !session.backpressured; frame += 1) {
      writeMixedFrame(session);
    }
    return session;
  }

  function pushPcm(stream, buffer) {
    for (const session of sessions.values()) {
      if (!session.streamNames.has(stream.name) || stream.sampleRate !== session.sampleRate) continue;
      const queue = session.queues.get(stream.name);
      if (!queue) continue;
      queue.push({
        samples: downmixToMono(buffer, stream.channels),
        offset: 0,
      });
      while (queue.length > maxQueuedChunks) queue.shift();
    }
  }

  function writeMixedFrame(session) {
    if (!session.ffmpeg || session.ffmpeg.killed || !session.ffmpeg.stdin.writable || session.res.destroyed) {
      cleanupSession(session);
      return;
    }
    if (session.backpressured) return;

    const out = Buffer.allocUnsafe(session.frameCount * 4);
    for (let frame = 0; frame < session.frameCount; frame += 1) {
      let mixed = 0;
      for (const stream of session.selectedStreams) {
        const value = readQueuedSample(session.queues.get(stream.name));
        mixed += value * (session.gains.get(stream.name) || 0);
      }
      out.writeFloatLE(clamp(mixed, -1, 1), frame * 4);
    }
    const ok = session.ffmpeg.stdin.write(out);
    if (!ok) session.backpressured = true;
  }

  function readQueuedSample(queue) {
    if (!queue || queue.length === 0) return 0;
    const chunk = queue[0];
    const value = chunk.samples[chunk.offset] || 0;
    chunk.offset += 1;
    if (chunk.offset >= chunk.samples.length) queue.shift();
    return value;
  }

  function downmixToMono(buffer, channels) {
    const frames = Math.floor(buffer.length / 4 / channels);
    const samples = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame += 1) {
      let sum = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        sum += buffer.readFloatLE((frame * channels + channel) * 4);
      }
      samples[frame] = sum / channels;
    }
    return samples;
  }

  function setGain(clientId, streamName, gain) {
    const session = sessions.get(clientId);
    if (!session || !session.gains.has(streamName)) return false;
    session.gains.set(streamName, clamp(Number(gain) || 0, 0, 1.5));
    return true;
  }

  function cleanupSession(session) {
    if (!session || sessions.get(session.clientId) !== session) return;
    sessions.delete(session.clientId);
    if (session.timer) clearInterval(session.timer);
    for (const stream of session.selectedStreams) removeListenerMode(stream, session.clientId, 'native-aac');
    if (onClientDisconnected) onClientDisconnected(session.clientId);
    if (session.ffmpeg && !session.ffmpeg.killed) session.ffmpeg.kill('SIGTERM');
    if (session.res && !session.res.destroyed) session.res.end();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  return {
    cleanupSession,
    pushPcm,
    serve,
    setGain,
  };
}

module.exports = {
  createNativeMultiAac,
};
