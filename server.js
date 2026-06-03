#!/usr/bin/env node
'use strict';

const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const args = parseArgs(process.argv.slice(2));
const defaultUdpHost = args.udpHost || '0.0.0.0';
const defaultUdpPort = Number(args.udpPort || args.udp || 8686);
const httpHost = args.httpHost || '0.0.0.0';
const httpPort = Number(args.httpPort || args.http || 8585);
const defaultSampleRate = Number(args.sampleRate || 8000);
const defaultChannels = Number(args.channels || 1);
const configPath = args.config || 'streams.json';
const opusBitrate = args.opusBitrate || '24k';
const ffmpegPath = args.ffmpeg || 'ffmpeg';
const opusAvailable = hasFfmpeg();

if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) {
  fatal('--http-port must be a valid port');
}

const publicDir = __dirname;
const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'));
const streams = loadStreams();
validateStreams(streams);
const streamsByName = new Map(streams.map((stream) => [stream.name, stream]));

const httpServer = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
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
});

httpServer.on('upgrade', (req, socket) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const match = normalizePath(requestUrl.pathname).match(/^\/([^/]+)\/(audio|control)$/);
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
    ensureListenerStats(stream, clientId);
    sendWsJson(socket, streamConfig(stream));
  } else {
    stream.rawClients.set(socket, clientId);
    ensureListenerStats(stream, clientId);
  }

  socket.on('error', () => removeWsClient(stream, socket));
  socket.on('close', () => removeWsClient(stream, socket));
  socket.on('data', () => {
    // Browser messages are not needed. Drain them so TCP backpressure stays sane.
  });
});

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
      if (client.destroyed || client.writableLength > 1024 * 1024) {
        client.destroy();
        stream.rawClients.delete(client);
        continue;
      }
      sendWsBinary(client, msg);
      addListenerBytes(stream, clientId, msg.length);
    }

    for (const opusClient of stream.opusClients) {
      if (opusClient.res.destroyed || opusClient.ffmpeg.killed || !opusClient.ffmpeg.stdin.writable) {
        cleanupOpusClient(stream, opusClient);
        continue;
      }
      opusClient.ffmpeg.stdin.write(msg);
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
      startHttpServer();
    }
  });
}

function startHttpServer() {
  httpServer.listen(httpPort, httpHost, () => {
    console.log(`Web player: http://${httpHost}:${httpPort}/`);
    for (const stream of streams) {
      console.log(`Stream:     /${stream.name} (${stream.label}) ${stream.channels === 1 ? 'mono' : 'stereo'} @ ${stream.sampleRate} Hz`);
    }
    console.log(`OPUS:       ${opusAvailable ? `enabled via ${ffmpegPath}` : 'unavailable (ffmpeg not found)'}`);
  });
  setInterval(broadcastStreamStats, 1000);
}

function loadStreams() {
  const configFile = path.resolve(configPath);
  if (fs.existsSync(configFile)) {
    const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (!Array.isArray(parsed.streams) || parsed.streams.length === 0) {
      fatal(`${configPath} must contain a non-empty "streams" array`);
    }
    return parsed.streams.map(normalizeStream);
  }

  return [normalizeStream({
    name: args.name || 'main',
    label: args.label || args.name || 'main',
    udpHost: defaultUdpHost,
    udpPort: defaultUdpPort,
    sampleRate: defaultSampleRate,
    channels: defaultChannels,
  })];
}

function normalizeStream(raw) {
  const name = String(raw.name || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    fatal(`Invalid stream name "${name}". Use letters, numbers, underscores, or hyphens.`);
  }

  const udpHost = raw.udpHost || defaultUdpHost;
  const udpPort = Number(raw.udpPort);
  const sampleRate = Number(raw.sampleRate || defaultSampleRate);
  const channels = Number(raw.channels || defaultChannels);

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
    controlClients: new Map(),
    rawClients: new Map(),
    opusClients: new Set(),
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
  return {
    name: stream.name,
    label: stream.label,
    udpHost: stream.udpHost,
    udpPort: stream.udpPort,
    sampleRate: stream.sampleRate,
    channels: stream.channels,
    clients: stream.rawClients.size + stream.opusClients.size,
    packetCount: stream.packetCount,
    byteCount: stream.byteCount,
    lastUdpAt: stream.lastUdpAt,
    url: `/${stream.name}`,
    opusAvailable,
  };
}

function renderStreamList() {
  const items = streams.map((stream) => `
    <a class="stream" href="/${escapeHtml(stream.name)}">
      <strong>${escapeHtml(stream.label)}</strong>
      <span>/${escapeHtml(stream.name)} · UDP ${escapeHtml(String(stream.udpPort))} · ${stream.channels === 1 ? 'mono' : 'stereo'} ${stream.sampleRate} Hz</span>
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
    opusAvailable,
    opusBitrate,
  };
}

function broadcastStreamStats() {
  const now = Date.now();
  for (const stream of streams) {
    const elapsedSeconds = Math.max(0.001, (now - stream.lastStatsAt) / 1000);
    const udpBitsPerSecond = Math.max(0, (stream.byteCount - stream.lastStatsByteCount) * 8 / elapsedSeconds);
    stream.lastStatsByteCount = stream.byteCount;
    stream.lastStatsAt = now;

    if (stream.controlClients.size === 0) {
      continue;
    }

    for (const [client, clientId] of stream.controlClients) {
      if (client.destroyed || client.writableLength > 1024 * 1024) {
        client.destroy();
        stream.controlClients.delete(client);
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
        clients: stream.rawClients.size + stream.opusClients.size,
      });
    }
  }
}

function sendWsBinary(socket, buffer) {
  sendFrame(socket, buffer, 0x2);
}

function serveOpus(stream, requestUrl, res) {
  if (!opusAvailable) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('OPUS unavailable: ffmpeg not found\n');
    return;
  }

  const clientId = normalizeClientId(requestUrl.searchParams.get('clientId'));
  ensureListenerStats(stream, clientId);

  res.writeHead(200, {
    'content-type': 'audio/ogg; codecs=opus',
    'cache-control': 'no-store',
    'connection': 'close',
  });

  const ffmpeg = spawn(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'f32le',
    '-ar', String(stream.sampleRate),
    '-ac', String(stream.channels),
    '-i', 'pipe:0',
    '-vn',
    '-c:a', 'libopus',
    '-application', 'voip',
    '-b:a', opusBitrate,
    '-vbr', 'on',
    '-f', 'ogg',
    'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'ignore'] });

  const opusClient = { clientId, ffmpeg, res };
  stream.opusClients.add(opusClient);

  ffmpeg.stdout.on('data', (chunk) => {
    if (res.destroyed) {
      cleanupOpusClient(stream, opusClient);
      return;
    }
    res.write(chunk);
    addListenerBytes(stream, clientId, chunk.length);
  });

  ffmpeg.on('close', () => cleanupOpusClient(stream, opusClient));
  res.on('close', () => cleanupOpusClient(stream, opusClient));
}

function cleanupOpusClient(stream, opusClient) {
  if (!stream.opusClients.has(opusClient)) return;
  stream.opusClients.delete(opusClient);
  if (!opusClient.ffmpeg.killed) {
    opusClient.ffmpeg.kill('SIGTERM');
  }
  if (!opusClient.res.destroyed) {
    opusClient.res.end();
  }
}

function ensureListenerStats(stream, clientId) {
  if (!stream.listenerStats.has(clientId)) {
    stream.listenerStats.set(clientId, { bytes: 0, lastBytes: 0 });
  }
  return stream.listenerStats.get(clientId);
}

function addListenerBytes(stream, clientId, bytes) {
  const stats = ensureListenerStats(stream, clientId);
  stats.bytes += bytes;
}

function removeWsClient(stream, socket) {
  stream.controlClients.delete(socket);
  stream.rawClients.delete(socket);
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

  socket.write(Buffer.concat([header, payload]));
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
      out[toCamel(raw.slice(2))] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function toCamel(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
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
