'use strict';

function createHlsAac(options) {
  const {
    aacBitrate,
    addListenerBytes,
    addListenerMode,
    cleanupClient,
    ffmpegPath,
    fs,
    hlsRoot,
    path,
    spawn,
  } = options;

  function serve(stream, rawClientId, fileName, res, normalizeClientId) {
    const clientId = normalizeClientId(rawClientId);
    const hlsClient = ensureClient(stream, clientId);
    hlsClient.lastRequestAt = Date.now();
    addListenerMode(stream, clientId, 'hls');

    if (fileName === 'playlist.m3u8') {
      servePlaylist(hlsClient, Date.now() + 4000, res);
      return;
    }

    if (!/^segment-\d+\.ts$/.test(fileName)) {
      sendNotFound(res);
      return;
    }

    const segmentPath = path.join(hlsClient.dir, fileName);
    readSegment(segmentPath, Date.now() + 2500, (err, data) => {
      if (err) {
        sendNotFound(res);
        return;
      }
      res.writeHead(200, {
        'content-type': 'video/mp2t',
        'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'pragma': 'no-cache',
        'expires': '0',
        'x-content-type-options': 'nosniff',
      });
      res.end(data);
      addListenerBytes(stream, clientId, 'hls', data.length);
    });
  }

  function ensureClient(stream, clientId) {
    const existing = stream.hlsClients.get(clientId);
    if (existing) return existing;

    const dir = fs.mkdtempSync(path.join(hlsRoot, `${stream.name}-${clientId}-`));
    const playlistPath = path.join(dir, 'playlist.m3u8');
    const ffmpeg = spawn(ffmpegPath, hlsArgs(stream), { cwd: dir, stdio: ['pipe', 'ignore', 'ignore'] });
    const hlsClient = {
      clientId,
      mode: 'hls',
      ffmpeg,
      dir,
      playlistPath,
      backpressured: false,
      droppedBytes: 0,
      lastRequestAt: Date.now(),
    };

    stream.hlsClients.set(clientId, hlsClient);
    stream.opusClients.add(hlsClient);
    ffmpeg.stdin.on('drain', () => {
      hlsClient.backpressured = false;
    });
    ffmpeg.on('close', () => cleanupClient(stream, hlsClient));
    return hlsClient;
  }

  function hlsArgs(stream) {
    return [
      '-hide_banner',
      '-loglevel', 'error',
      '-fflags', 'nobuffer',
      '-f', 'f32le',
      '-ar', String(stream.sampleRate),
      '-ac', String(stream.channels),
      '-i', 'pipe:0',
      '-vn',
      '-c:a', 'aac',
      '-b:a', aacBitrate,
      '-ar', '16000',
      '-flush_packets', '1',
      '-f', 'hls',
      '-hls_time', '1',
      '-hls_list_size', '6',
      '-hls_delete_threshold', '6',
      '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', 'segment-%05d.ts',
      'playlist.m3u8',
    ];
  }

  function pruneInactiveClients(stream, now) {
    for (const hlsClient of stream.hlsClients.values()) {
      if (now - hlsClient.lastRequestAt > 15000) {
        cleanupClient(stream, hlsClient);
      }
    }
  }

  function servePlaylist(hlsClient, deadline, res) {
    fs.readFile(hlsClient.playlistPath, 'utf8', (err, data) => {
      if ((err || !data.includes('.ts')) && Date.now() < deadline) {
        setTimeout(() => servePlaylist(hlsClient, deadline, res), 100);
        return;
      }

      const playlist = err ? [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:1',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '',
      ].join('\n') : data;

      res.writeHead(200, {
        'content-type': 'application/vnd.apple.mpegurl',
        'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'pragma': 'no-cache',
        'expires': '0',
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff',
      });
      res.end(playlist);
    });
  }

  function readSegment(segmentPath, deadline, callback) {
    fs.readFile(segmentPath, (err, data) => {
      if (!err) {
        callback(null, data);
        return;
      }
      if (Date.now() >= deadline) {
        callback(err);
        return;
      }
      setTimeout(() => readSegment(segmentPath, deadline, callback), 100);
    });
  }

  function sendNotFound(res) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found\n');
  }

  return {
    pruneInactiveClients,
    serve,
  };
}

module.exports = {
  createHlsAac,
};
