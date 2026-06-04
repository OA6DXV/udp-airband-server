#!/usr/bin/env node
'use strict';

const dgram = require('dgram');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const MAX_SOCKET_BUFFER_BYTES = 1024 * 1024;
const MAX_OPUS_STDIN_BUFFER_BYTES = 512 * 1024;
const SOFTWARE_VERSION = '1.1';

const args = parseArgs(process.argv.slice(2));
const serverConfigPath = args.serverConfig || args.serverConf || 'server.conf';
const serverConfig = loadServerConfig(serverConfigPath);
const defaultUdpHost = args.udpHost || getSetting('udp.host', '0.0.0.0');
const httpHost = args.httpHost || getSetting('web.host', '0.0.0.0');
const httpPort = Number(args.httpPort || args.http || getSetting('web.port', 8585));
const configPath = args.config || getSetting('streams.file', 'streams.json');
const compressedEnabled = parseBoolean(args.compressedEnabled !== undefined ? args.compressedEnabled : getSetting('compressed.enabled', true));
const opusBitrate = args.opusBitrate || getSetting('compressed.opusBitrate', '24k');
const aacBitrate = args.aacBitrate || getSetting('compressed.aacBitrate', '32k');
const opusKeepaliveMs = Number(args.opusKeepaliveMs || getSetting('compressed.keepaliveMs', 1000));
const ffmpegPath = args.ffmpeg || getSetting('compressed.ffmpeg', 'ffmpeg');
const tlsKeyPath = args.tlsKey || args.httpsKey || getSetting('ssl.key', '');
const tlsCertPath = args.tlsCert || args.httpsCert || getSetting('ssl.cert', '');
const tlsConfigured = Boolean(tlsKeyPath || tlsCertPath);
const sslEnabledSetting = args.sslEnabled !== undefined ? args.sslEnabled : (args.tlsEnabled !== undefined ? args.tlsEnabled : getSetting('ssl.enabled', tlsConfigured));
const tlsEnabled = parseBoolean(sslEnabledSetting) && tlsConfigured;
const httpsHost = args.httpsHost || getSetting('ssl.host', httpHost);
const httpsPort = Number(args.httpsPort || getSetting('ssl.port', httpPort));
const redirectHttpToHttps = parseBoolean(args.redirectHttpToHttps !== undefined ? args.redirectHttpToHttps : getSetting('ssl.redirectHttpToHttps', false));
const opusAvailable = compressedEnabled && hasFfmpeg();

if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) {
  fatal('--http-port must be a valid port');
}
if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65535) {
  fatal('--https-port must be a valid port');
}
if (!Number.isInteger(opusKeepaliveMs) || opusKeepaliveMs < 20 || opusKeepaliveMs > 1000) {
  fatal('--opus-keepalive-ms must be between 20 and 1000');
}
if (parseBoolean(sslEnabledSetting) && (!tlsKeyPath || !tlsCertPath)) {
  fatal('TLS requires both --tls-key and --tls-cert');
}

const publicDir = __dirname;
const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'));
const appJs = fs.readFileSync(path.join(publicDir, 'app.js'));
const styleCss = fs.readFileSync(path.join(publicDir, 'style.css'));
const tlsOptions = tlsEnabled ? loadTlsOptions() : null;
const streams = loadStreams();
validateStreams(streams);
const streamsByName = new Map(streams.map((stream) => [stream.name, stream]));
const hlsRoot = compressedEnabled ? fs.mkdtempSync(path.join(os.tmpdir(), 'udp-airband-hls-')) : '';

const httpServer = http.createServer((req, res) => {
  if (tlsEnabled && redirectHttpToHttps) {
    redirectToHttps(req, res);
    return;
  }
  handleHttpRequest(req, res);
});
const httpsServer = tlsEnabled ? https.createServer(tlsOptions, handleHttpRequest) : null;

attachUpgradeHandler(httpServer);
if (httpsServer) attachUpgradeHandler(httpsServer);

for (const stream of streams) {
  const udpServer = dgram.createSocket('udp4');
  stream.udpServer = udpServer;

  udpServer.on('message', (msg) => {
    if (msg.length === 0 || msg.length % 4 !== 0) {
      return;
    }

    stream.packetCount += 1;
    stream.byteCount += msg.length;
    stream.lastUdpAt = Date.now();

    for (const [client, clientId] of stream.rawClients) {
      if (client.destroyed || client.writableLength > MAX_SOCKET_BUFFER_BYTES) {
        client.destroy();
        removeWsClient(stream, client);
        continue;
      }
      sendWsBinary(client, msg);
      addListenerBytes(stream, clientId, 'raw', msg.length);
    }

    for (const opusClient of stream.opusClients) {
      if (!isWritableOpusClient(opusClient)) {
        cleanupOpusClient(stream, opusClient);
        continue;
      }
      if (opusClient.backpressured) {
        opusClient.droppedBytes += msg.length;
        continue;
      }
      writeOpusInput(stream, opusClient, msg);
    }
  });

  udpServer.on('error', (err) => fatal(`UDP error on ${stream.name}: ${err.message}`));
}

let pendingUdpBinds = streams.length;
for (const stream of streams) {
  stream.udpServer.bind(stream.udpPort, stream.udpHost, () => {
    console.log(`UDP input:  ${stream.name} -> ${stream.udpHost}:${stream.udpPort}`);
    pendingUdpBinds -= 1;
    if (pendingUdpBinds === 0) {
      startWebServers();
    }
  });
}

function handleHttpRequest(req, res) {
  const requestUrl = new URL(req.url, `${isTlsRequest(req) ? 'https' : 'http'}://${req.headers.host || 'localhost'}`);
  const pathname = normalizePath(requestUrl.pathname);

  if (pathname === '/') {
    sendHtml(res, renderStreamList());
    return;
  }

  if (pathname === '/favicon.ico') {
    res.writeHead(204, { 'cache-control': 'public, max-age=86400' });
    res.end();
    return;
  }

  if (pathname === '/assets/style.css') {
    sendAsset(res, styleCss, 'text/css; charset=utf-8');
    return;
  }

  if (pathname === '/assets/app.js') {
    sendAsset(res, appJs, 'application/javascript; charset=utf-8');
    return;
  }

  if (pathname === '/status') {
    sendJsonResponse(res, streams.map(publicStreamStatus));
    return;
  }

  if (pathname.startsWith('/status/')) {
    const streamName = pathname.slice('/status/'.length);
    const stream = streamsByName.get(streamName);
    if (!stream) {
      sendNotFound(res);
      return;
    }
    sendJsonResponse(res, publicStreamStatus(stream));
    return;
  }

  const hlsMatch = pathname.match(/^\/([^/]+)\/hls\/([^/]+)\/([^/]+)$/);
  if (hlsMatch) {
    const stream = streamsByName.get(hlsMatch[1]);
    if (!stream) {
      sendNotFound(res);
      return;
    }
    serveHls(stream, hlsMatch[2], hlsMatch[3], res);
    return;
  }

  const opusMatch = pathname.match(/^\/([^/]+)\/opus$/);
  if (opusMatch) {
    const stream = streamsByName.get(opusMatch[1]);
    if (!stream) {
      sendNotFound(res);
      return;
    }
    serveOpus(stream, requestUrl, res);
    return;
  }

  const streamName = pathname.slice(1);
  if (streamsByName.has(streamName)) {
    sendHtml(res, indexHtml);
    return;
  }

  sendNotFound(res);
}

function attachUpgradeHandler(server) {
  server.on('upgrade', (req, socket) => {
    const requestUrl = new URL(req.url, `${socket.encrypted ? 'https' : 'http'}://${req.headers.host || 'localhost'}`);
    const match = normalizePath(requestUrl.pathname).match(/^\/([^/]+)\/(audio|control|opus|aac)$/);
    if (!match) {
      socket.destroy();
      return;
    }

    const stream = streamsByName.get(match[1]);
    const socketType = match[2];
    if (!stream) {
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');

    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'));

    socket.setNoDelay(true);
    const clientId = normalizeClientId(requestUrl.searchParams.get('clientId'));

    if (socketType === 'control') {
      stream.controlClients.set(socket, clientId);
      addListenerMode(stream, clientId, 'control');
      sendWsJson(socket, streamConfig(stream));
    } else if (socketType === 'opus' || socketType === 'aac') {
      serveCompressedWebSocket(stream, clientId, socket, socketType);
    } else {
      stream.rawClients.set(socket, clientId);
      addListenerMode(stream, clientId, 'raw');
    }

    socket.on('error', () => removeWsClient(stream, socket));
    socket.on('close', () => removeWsClient(stream, socket));
    socket.on('data', () => {
      // Browser messages are not needed. Drain them so TCP backpressure stays sane.
    });
  });
}

function startWebServers() {
  httpServer.listen(httpPort, httpHost, () => {
    const mode = tlsEnabled && redirectHttpToHttps ? 'HTTP redirect' : 'Web player';
    console.log(`${mode}: ${formatUrl('http', httpHost, httpPort)}/`);
  });

  if (httpsServer) {
    httpsServer.listen(httpsPort, httpsHost, () => {
      console.log(`TLS player: ${formatUrl('https', httpsHost, httpsPort)}/`);
    });
  }

  for (const stream of streams) {
    console.log(`Stream:     /${stream.name} (${stream.label}) ${stream.channels === 1 ? 'mono' : 'stereo'} @ ${stream.sampleRate} Hz`);
  }
  console.log(`Compressed: ${compressedEnabled ? (opusAvailable ? `enabled via ${ffmpegPath}` : 'unavailable (ffmpeg not found)') : 'disabled by config'}`);
  setInterval(broadcastStreamStats, 1000);
  if (compressedEnabled) {
    setInterval(writeOpusSilenceKeepalive, opusKeepaliveMs);
  }
}

function loadStreams() {
  const configFile = path.resolve(configPath);
  if (!fs.existsSync(configFile)) {
    fatal(`Streams config not found: ${configPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (!Array.isArray(parsed.streams) || parsed.streams.length === 0) {
    fatal(`${configPath} must contain a non-empty "streams" array`);
  }
  return parsed.streams.map(normalizeStream);
}

function normalizeStream(raw) {
  const name = String(raw.name || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    fatal(`Invalid stream name "${name}". Use letters, numbers, underscores, or hyphens.`);
  }

  const udpHost = raw.udpHost || defaultUdpHost;
  const udpPort = Number(raw.udpPort);
  const sampleRate = Number(raw.sampleRate);
  const channels = Number(raw.channels);

  if (!Number.isInteger(udpPort) || udpPort < 1 || udpPort > 65535) {
    fatal(`Stream "${name}" has invalid udpPort`);
  }
  if (![1, 2].includes(channels)) {
    fatal(`Stream "${name}" channels must be 1 or 2`);
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 1000) {
    fatal(`Stream "${name}" sampleRate must be a positive integer`);
  }

  return {
    name,
    label: String(raw.label || name),
    udpHost,
    udpPort,
    sampleRate,
    channels,
    silenceBuffer: Buffer.alloc(Math.round(sampleRate * channels * 4 * opusKeepaliveMs / 1000)),
    controlClients: new Map(),
    rawClients: new Map(),
    opusClients: new Set(),
    hlsClients: new Map(),
    listenerStats: new Map(),
    packetCount: 0,
    byteCount: 0,
    lastStatsByteCount: 0,
    lastStatsAt: Date.now(),
    lastUdpAt: 0,
    udpServer: null,
  };
}

function validateStreams(items) {
  const names = new Set();
  const udpInputs = new Set();

  for (const stream of items) {
    if (names.has(stream.name)) {
      fatal(`Duplicate stream name "${stream.name}"`);
    }
    names.add(stream.name);

    const udpInput = `${stream.udpHost}:${stream.udpPort}`;
    if (udpInputs.has(udpInput)) {
      fatal(`Duplicate UDP input ${udpInput}`);
    }
    udpInputs.add(udpInput);
  }
}

function publicStreamStatus(stream) {
  const activeListeners = getActiveListeners(stream);
  const lastHeard = getLastHeard(stream, Date.now());
  return {
    name: stream.name,
    label: stream.label,
    udpHost: stream.udpHost,
    udpPort: stream.udpPort,
    sampleRate: stream.sampleRate,
    channels: stream.channels,
    clients: stream.rawClients.size + stream.opusClients.size,
    controlClients: stream.controlClients.size,
    rawClients: stream.rawClients.size,
    opusClients: stream.opusClients.size,
    hlsClients: stream.hlsClients.size,
    activeListeners: activeListeners.length,
    listeners: activeListeners,
    packetCount: stream.packetCount,
    byteCount: stream.byteCount,
    lastUdpAt: stream.lastUdpAt,
    lastHeardAt: lastHeard.at,
    lastHeardLabel: lastHeard.label,
    secondsSinceLastHeard: lastHeard.secondsSince,
    hasUdp: stream.packetCount > 0,
    url: `/${stream.name}`,
    compressedEnabled,
    opusAvailable,
    aacAvailable: opusAvailable,
    hlsAvailable: opusAvailable,
    tlsEnabled,
    softwareVersion: SOFTWARE_VERSION,
  };
}

function renderStreamList() {
  const items = streams.map((stream) => `
    <a class="stream" href="/${escapeHtml(stream.name)}">
      <strong>${escapeHtml(stream.label)}</strong>
      <span>/${escapeHtml(stream.name)} &middot; UDP ${escapeHtml(String(stream.udpPort))} &middot; ${stream.channels === 1 ? 'mono' : 'stereo'} ${stream.sampleRate} Hz</span>
    </a>
  `).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>UDP Airband Streams</title>
  <style>
    body { margin: 0; min-height: 100vh; background: #111318; color: #eef2f6; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(760px, calc(100vw - 32px)); margin: 0 auto; padding: 36px 0; }
    h1 { margin: 0 0 20px; font-size: 32px; letter-spacing: 0; }
    .stream { display: grid; gap: 6px; padding: 16px; margin-bottom: 12px; color: inherit; text-decoration: none; border: 1px solid #394451; border-radius: 8px; background: #1b2028; }
    .stream:hover { border-color: #4fb477; }
    .stream span { color: #9aa7b3; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>UDP Airband Streams</h1>
    ${items}
  </main>
</body>
</html>`;
}

function sendHtml(res, body) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendAsset(res, body, contentType) {
  res.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function sendJsonResponse(res, value) {
  res.writeHead(200, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

function sendNotFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found\n');
}

function sendWsJson(socket, value) {
  sendFrame(socket, Buffer.from(JSON.stringify(value), 'utf8'), 0x1);
}

function streamConfig(stream) {
  return {
    type: 'config',
    name: stream.name,
    label: stream.label,
    udpPort: stream.udpPort,
    sampleRate: stream.sampleRate,
    channels: stream.channels,
    format: 'f32le',
    compressedEnabled,
    opusAvailable,
    opusBitrate,
    aacAvailable: opusAvailable,
    aacBitrate,
    hlsAvailable: opusAvailable,
    tlsEnabled,
    softwareVersion: SOFTWARE_VERSION,
  };
}

function broadcastStreamStats() {
  const now = Date.now();
  for (const stream of streams) {
    pruneInactiveListeners(stream, now);
    pruneInactiveHlsClients(stream, now);
    const lastHeard = getLastHeard(stream, now);
    const elapsedSeconds = Math.max(0.001, (now - stream.lastStatsAt) / 1000);
    const udpBitsPerSecond = Math.max(0, (stream.byteCount - stream.lastStatsByteCount) * 8 / elapsedSeconds);
    stream.lastStatsByteCount = stream.byteCount;
    stream.lastStatsAt = now;

    if (stream.controlClients.size === 0) {
      continue;
    }

    for (const [client, clientId] of stream.controlClients) {
      if (client.destroyed || client.writableLength > MAX_SOCKET_BUFFER_BYTES) {
        client.destroy();
        removeWsClient(stream, client);
        continue;
      }
      const listenerStats = ensureListenerStats(stream, clientId);
      const listenerBitsPerSecond = Math.max(0, (listenerStats.bytes - listenerStats.lastBytes) * 8 / elapsedSeconds);
      listenerStats.lastBytes = listenerStats.bytes;
      sendWsJson(client, {
        type: 'stats',
        udpBitsPerSecond,
        listenerBitsPerSecond,
        packetCount: stream.packetCount,
        byteCount: stream.byteCount,
        lastUdpAt: stream.lastUdpAt,
        lastHeardAt: lastHeard.at,
        lastHeardLabel: lastHeard.label,
        secondsSinceLastHeard: lastHeard.secondsSince,
        hasUdp: stream.packetCount > 0,
        clients: stream.rawClients.size + stream.opusClients.size,
        activeListeners: getActiveListeners(stream).length,
        softwareVersion: SOFTWARE_VERSION,
      });
    }
  }
}

function sendWsBinary(socket, buffer) {
  return sendFrame(socket, buffer, 0x2);
}

function serveHls(stream, rawClientId, fileName, res) {
  if (!opusAvailable) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Compressed audio unavailable: ffmpeg not found\n');
    return;
  }

  const clientId = normalizeClientId(rawClientId);
  const hlsClient = ensureHlsClient(stream, clientId);
  hlsClient.lastRequestAt = Date.now();
  addListenerMode(stream, clientId, 'hls');

  if (fileName === 'playlist.m3u8') {
    serveHlsPlaylist(hlsClient, res);
    return;
  }

  if (!/^segment-\d+\.ts$/.test(fileName)) {
    sendNotFound(res);
    return;
  }

  const segmentPath = path.join(hlsClient.dir, fileName);
  fs.readFile(segmentPath, (err, data) => {
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

function serveHlsPlaylist(hlsClient, res) {
  fs.readFile(hlsClient.playlistPath, 'utf8', (err, data) => {
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

function ensureHlsClient(stream, clientId) {
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
  ffmpeg.on('close', () => cleanupOpusClient(stream, hlsClient));
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
    '-hls_list_size', '4',
    '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', 'segment-%05d.ts',
    'playlist.m3u8',
  ];
}

function serveOpus(stream, requestUrl, res) {
  if (!opusAvailable) {
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

  const ffmpeg = spawn(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-fflags', 'nobuffer',
    '-f', 'f32le',
    '-ar', String(stream.sampleRate),
    '-ac', String(stream.channels),
    '-i', 'pipe:0',
    '-vn',
    '-c:a', 'libopus',
    '-application', 'lowdelay',
    '-b:a', opusBitrate,
    '-vbr', 'on',
    '-dtx', '1',
    '-frame_duration', '20',
    '-compression_level', '0',
    '-flush_packets', '1',
    '-max_delay', '0',
    '-page_duration', '20000',
    '-f', 'ogg',
    'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'ignore'] });

  const opusClient = { clientId, ffmpeg, res, backpressured: false, droppedBytes: 0 };
  stream.opusClients.add(opusClient);

  ffmpeg.stdout.on('data', (chunk) => {
    if (res.destroyed) {
      cleanupOpusClient(stream, opusClient);
      return;
    }
    if (!res.write(chunk)) {
      ffmpeg.stdout.pause();
      res.once('drain', () => ffmpeg.stdout.resume());
    }
    addListenerBytes(stream, clientId, 'opus', chunk.length);
  });

  ffmpeg.stdin.on('drain', () => {
    opusClient.backpressured = false;
  });
  ffmpeg.on('close', () => cleanupOpusClient(stream, opusClient));
  res.on('close', () => cleanupOpusClient(stream, opusClient));
}

function serveCompressedWebSocket(stream, clientId, socket, mode) {
  if (!opusAvailable) {
    socket.destroy();
    return;
  }

  addListenerMode(stream, clientId, mode);
  const ffmpeg = spawn(ffmpegPath, compressedWebSocketArgs(stream, mode), { stdio: ['pipe', 'pipe', 'ignore'] });

  const opusClient = { clientId, mode, ffmpeg, socket, backpressured: false, droppedBytes: 0 };
  stream.opusClients.add(opusClient);

  ffmpeg.stdout.on('data', (chunk) => {
    if (socket.destroyed) {
      cleanupOpusClient(stream, opusClient);
      return;
    }
    if (!sendWsBinary(socket, chunk)) {
      ffmpeg.stdout.pause();
      socket.once('drain', () => ffmpeg.stdout.resume());
    }
    addListenerBytes(stream, clientId, mode, chunk.length);
  });

  ffmpeg.stdin.on('drain', () => {
    opusClient.backpressured = false;
  });
  ffmpeg.on('close', () => cleanupOpusClient(stream, opusClient));
  socket.on('close', () => cleanupOpusClient(stream, opusClient));
  socket.on('error', () => cleanupOpusClient(stream, opusClient));
}

function compressedWebSocketArgs(stream, mode) {
  const inputArgs = [
    '-hide_banner',
    '-loglevel', 'error',
    '-fflags', 'nobuffer',
    '-f', 'f32le',
    '-ar', String(stream.sampleRate),
    '-ac', String(stream.channels),
    '-i', 'pipe:0',
    '-vn',
  ];

  if (mode === 'aac') {
    return inputArgs.concat([
      '-c:a', 'aac',
      '-b:a', aacBitrate,
      '-ar', '16000',
      '-flush_packets', '1',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-frag_duration', '20000',
      '-f', 'mp4',
      'pipe:1',
    ]);
  }

  return inputArgs.concat([
    '-c:a', 'libopus',
    '-application', 'lowdelay',
    '-b:a', opusBitrate,
    '-vbr', 'on',
    '-dtx', '1',
    '-frame_duration', '20',
    '-compression_level', '0',
    '-flush_packets', '1',
    '-max_delay', '0',
    '-cluster_time_limit', '40',
    '-cluster_size_limit', '4096',
    '-f', 'webm',
    'pipe:1',
  ]);
}

function cleanupOpusClient(stream, opusClient) {
  if (!stream.opusClients.has(opusClient)) return;
  stream.opusClients.delete(opusClient);
  if (opusClient.mode === 'hls') {
    stream.hlsClients.delete(opusClient.clientId);
  }
  removeListenerMode(stream, opusClient.clientId, opusClient.mode || 'opus');
  if (!opusClient.ffmpeg.killed) {
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

function isWritableOpusClient(opusClient) {
  let outputWritable = true;
  if (opusClient.res) {
    outputWritable = !opusClient.res.destroyed;
  } else if (opusClient.socket) {
    outputWritable = !opusClient.socket.destroyed;
  }

  return outputWritable
    && !opusClient.ffmpeg.killed
    && opusClient.ffmpeg.stdin.writable
    && opusClient.ffmpeg.stdin.writableLength <= MAX_OPUS_STDIN_BUFFER_BYTES;
}

function writeOpusInput(stream, opusClient, buffer) {
  const ok = opusClient.ffmpeg.stdin.write(buffer);
  if (!ok) {
    opusClient.backpressured = true;
  }
  const stats = ensureListenerStats(stream, opusClient.clientId);
  stats.opusInputBytes += buffer.length;
  stats.lastSeenAt = Date.now();
}

function writeOpusSilenceKeepalive() {
  if (!opusAvailable) return;

  const now = Date.now();
  for (const stream of streams) {
    if (stream.opusClients.size === 0 || !stream.lastUdpAt || now - stream.lastUdpAt < opusKeepaliveMs * 2) {
      continue;
    }

    for (const opusClient of stream.opusClients) {
      if (!isWritableOpusClient(opusClient)) {
        cleanupOpusClient(stream, opusClient);
        continue;
      }
      if (!opusClient.backpressured) {
        writeOpusInput(stream, opusClient, stream.silenceBuffer);
      }
    }
  }
}

function getLastHeard(stream, now) {
  if (!stream.lastUdpAt) {
    return { at: 0, label: 'never', secondsSince: null };
  }

  const secondsSince = Math.max(0, Math.floor((now - stream.lastUdpAt) / 1000));
  if (secondsSince < 3) {
    return { at: stream.lastUdpAt, label: 'Now', secondsSince };
  }
  if (secondsSince < 10) {
    return { at: stream.lastUdpAt, label: `${secondsSince}s ago`, secondsSince };
  }

  return {
    at: stream.lastUdpAt,
    label: formatServerTime(stream.lastUdpAt),
    secondsSince,
  };
}

function formatServerTime(timestamp) {
  const date = new Date(timestamp);
  return [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join(':');
}

function ensureListenerStats(stream, clientId) {
  if (!stream.listenerStats.has(clientId)) {
    stream.listenerStats.set(clientId, {
      bytes: 0,
      lastBytes: 0,
      rawBytes: 0,
      opusBytes: 0,
      aacBytes: 0,
      opusInputBytes: 0,
      modes: new Set(),
      connectedAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  }
  return stream.listenerStats.get(clientId);
}

function addListenerMode(stream, clientId, mode) {
  const stats = ensureListenerStats(stream, clientId);
  stats.modes.add(mode);
  stats.lastSeenAt = Date.now();
}

function removeListenerMode(stream, clientId, mode) {
  const stats = stream.listenerStats.get(clientId);
  if (!stats) return;
  stats.modes.delete(mode);
  stats.lastSeenAt = Date.now();
  if (stats.modes.size === 0) {
    stream.listenerStats.delete(clientId);
  }
}

function addListenerBytes(stream, clientId, mode, bytes) {
  const stats = ensureListenerStats(stream, clientId);
  stats.bytes += bytes;
  stats.lastSeenAt = Date.now();
  if (mode === 'raw') stats.rawBytes += bytes;
  if (mode === 'opus') stats.opusBytes += bytes;
  if (mode === 'aac' || mode === 'hls') stats.aacBytes += bytes;
}

function getActiveListeners(stream) {
  const listeners = [];
  for (const [clientId, stats] of stream.listenerStats) {
    if (!stats.modes.size) continue;
    listeners.push({
      clientId,
      modes: Array.from(stats.modes).sort(),
      connectedAt: stats.connectedAt,
      lastSeenAt: stats.lastSeenAt,
      bytes: stats.bytes,
      rawBytes: stats.rawBytes,
      opusBytes: stats.opusBytes,
      aacBytes: stats.aacBytes,
      opusInputBytes: stats.opusInputBytes,
    });
  }
  return listeners.sort((a, b) => a.connectedAt - b.connectedAt);
}

function pruneInactiveListeners(stream, now) {
  for (const [clientId, stats] of stream.listenerStats) {
    if (stats.modes.size === 0 || now - stats.lastSeenAt > 5 * 60 * 1000) {
      stream.listenerStats.delete(clientId);
    }
  }
}

function pruneInactiveHlsClients(stream, now) {
  for (const hlsClient of stream.hlsClients.values()) {
    if (now - hlsClient.lastRequestAt > 15000) {
      cleanupOpusClient(stream, hlsClient);
    }
  }
}

function removeWsClient(stream, socket) {
  const controlClientId = stream.controlClients.get(socket);
  const rawClientId = stream.rawClients.get(socket);
  stream.controlClients.delete(socket);
  stream.rawClients.delete(socket);
  if (controlClientId) removeListenerMode(stream, controlClientId, 'control');
  if (rawClientId) removeListenerMode(stream, rawClientId, 'raw');
}

function normalizeClientId(value) {
  const id = String(value || '').trim();
  if (/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return id;
  return crypto.randomBytes(12).toString('hex');
}

function hasFfmpeg() {
  const result = spawnSync(ffmpegPath, ['-version'], { stdio: 'ignore' });
  return result.status === 0;
}

function sendFrame(socket, payload, opcode) {
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len <= 0xffff) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return socket.write(Buffer.concat([header, payload]));
}

function loadTlsOptions() {
  return {
    key: fs.readFileSync(path.resolve(tlsKeyPath)),
    cert: fs.readFileSync(path.resolve(tlsCertPath)),
  };
}

function redirectToHttps(req, res) {
  const hostHeader = req.headers.host || `localhost:${httpsPort}`;
  const hostname = hostHeader.replace(/:\d+$/, '');
  const host = httpsPort === 443 ? hostname : `${hostname}:${httpsPort}`;
  res.writeHead(308, { location: `https://${host}${req.url}` });
  res.end();
}

function isTlsRequest(req) {
  return Boolean(req.socket && req.socket.encrypted);
}

function formatUrl(protocol, host, port) {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  const defaultPort = protocol === 'https' ? 443 : 80;
  return `${protocol}://${displayHost}${port === defaultPort ? '' : `:${port}`}`;
}

function normalizePath(value) {
  const pathOnly = decodeURIComponent(value.split('?')[0]);
  if (pathOnly.length > 1 && pathOnly.endsWith('/')) {
    return pathOnly.slice(0, -1);
  }
  return pathOnly;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq !== -1) {
      out[toCamel(raw.slice(2, eq))] = raw.slice(eq + 1);
    } else {
      const key = toCamel(raw.slice(2));
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    }
  }
  return out;
}

function loadServerConfig(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return {};
  }

  const out = {};
  let section = '';
  const lines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.replace(/[;#].*$/, '').trim();
    if (!trimmed) continue;

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = normalizeConfigKey(sectionMatch[1]);
      continue;
    }

    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      fatal(`Invalid config line in ${filePath}: ${line}`);
    }

    const rawKey = normalizeConfigKey(trimmed.slice(0, eq).trim());
    const key = section ? `${section}.${rawKey}` : rawKey;
    out[key] = unquote(trimmed.slice(eq + 1).trim());
  }
  return out;
}

function getSetting(key, fallback) {
  const normalized = normalizeConfigKey(key);
  return Object.prototype.hasOwnProperty.call(serverConfig, normalized) ? serverConfig[normalized] : fallback;
}

function normalizeConfigKey(value) {
  return String(value)
    .trim()
    .replace(/[-_]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase())
    .replace(/\s+/g, '');
}

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function toCamel(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function fatal(message) {
  console.error(message);
  process.exit(1);
}
