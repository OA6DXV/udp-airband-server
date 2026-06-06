#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { normalizeClientId } = require('./lib/clients');
const { ensureServerConfigDefaults, getSetting, loadServerConfig, parseArgs, parseBoolean } = require('./lib/config');
const {
  addListenerBytes,
  addListenerMode,
  ensureListenerStats,
  getActiveListeners,
  getLastHeard,
  pruneInactiveListeners,
  removeWsClient,
  removeListenerMode,
} = require('./lib/listeners');
const { createLogger } = require('./lib/logger');
const { DEFAULT_STREAMS, loadStreams, renderMultiStreamPage, renderStreamList, validateStreams } = require('./lib/streams');
const { acceptWebSocket, sendWsBinary, sendWsJson } = require('./lib/websocket');
const { createCompressedManager } = require('./lib/compressed');
const { createNativeMultiAac } = require('./lib/native-multi-aac');

const MAX_SOCKET_BUFFER_BYTES = 1024 * 1024;
const MAX_OPUS_STDIN_BUFFER_BYTES = 512 * 1024;
const SOFTWARE_VERSION = '1.4-testing';
const COMPRESSED_CODECS = new Set(['adpcm', 'opus', 'aac', 'hls']);

const args = parseArgs(process.argv.slice(2));
const serverConfigPath = args.serverConfig || args.serverConf || 'server.conf';
const serverConfigExists = fs.existsSync(path.resolve(serverConfigPath));
const serverConfigUpdated = ensureServerConfigDefaults(serverConfigPath, [
  {
    name: 'api',
    comments: ['Public status API. Keep disabled unless you explicitly want /status endpoints.'],
    keys: [{ key: 'enabled', value: 'false' }],
  },
], fs, path);
const serverConfig = loadServerConfig(serverConfigPath, fs, path);
const defaultUdpHost = args.udpHost || getSetting(serverConfig, 'udp.host', '0.0.0.0');
const httpHost = args.httpHost || getSetting(serverConfig, 'web.host', '0.0.0.0');
const httpPort = Number(args.httpPort || args.http || getSetting(serverConfig, 'web.port', 8585));
const configPath = args.config || getSetting(serverConfig, 'streams.file', 'streams.json');
const apiEnabledSetting = args.api ? true : (args.apiEnabled !== undefined ? args.apiEnabled : getSetting(serverConfig, 'api.enabled', false));
const apiEnabled = parseBoolean(apiEnabledSetting);
const compressedEnabled = parseBoolean(args.compressedEnabled !== undefined ? args.compressedEnabled : getSetting(serverConfig, 'compressed.enabled', true));
const compressedCodec = String(args.compressedCodec || args.codec || getSetting(serverConfig, 'compressed.codec', 'adpcm')).trim().toLowerCase();
const adpcmFrameMs = Number(args.adpcmFrameMs || getSetting(serverConfig, 'compressed.adpcmFrameMs', 40));
const opusBitrate = args.opusBitrate || getSetting(serverConfig, 'compressed.opusBitrate', '24k');
const aacBitrate = args.aacBitrate || getSetting(serverConfig, 'compressed.aacBitrate', '32k');
const opusKeepaliveMs = Number(args.opusKeepaliveMs || getSetting(serverConfig, 'compressed.keepaliveMs', 1000));
const ffmpegPath = args.ffmpeg || getSetting(serverConfig, 'compressed.ffmpeg', 'ffmpeg');
const logLevel = args.logLevel || getSetting(serverConfig, 'logging.level', 'info');
const tlsKeyPath = args.tlsKey || args.httpsKey || getSetting(serverConfig, 'ssl.key', '');
const tlsCertPath = args.tlsCert || args.httpsCert || getSetting(serverConfig, 'ssl.cert', '');
const sslEnabledSetting = args.sslEnabled !== undefined ? args.sslEnabled : (args.tlsEnabled !== undefined ? args.tlsEnabled : getSetting(serverConfig, 'ssl.enabled', false));
const sslRequested = parseBoolean(sslEnabledSetting);
const debugEnabled = Boolean(args.debug);
const logTimestamps = parseBoolean(args.logTimestamps !== undefined ? args.logTimestamps : (debugEnabled ? true : getSetting(serverConfig, 'logging.timestamps', false)));
const logColors = parseBoolean(args.logColors !== undefined ? args.logColors : (debugEnabled ? true : getSetting(serverConfig, 'logging.colors', false)));
const logger = createLogger({ debug: debugEnabled, level: logLevel, timestamps: logTimestamps, colors: logColors });

if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) {
  fatal('--http-port must be a valid port');
}
if (!Number.isInteger(opusKeepaliveMs) || opusKeepaliveMs < 20 || opusKeepaliveMs > 1000) {
  fatal('--opus-keepalive-ms must be between 20 and 1000');
}
if (!COMPRESSED_CODECS.has(compressedCodec)) {
  fatal('--compressed-codec must be one of: adpcm, opus, aac, hls');
}
if (!Number.isInteger(adpcmFrameMs) || adpcmFrameMs < 10 || adpcmFrameMs > 100) {
  fatal('--adpcm-frame-ms must be between 10 and 100');
}
const publicDir = __dirname;
const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'));
const appJs = fs.readFileSync(path.join(publicDir, 'assets', 'app.js'));
const styleCss = fs.readFileSync(path.join(publicDir, 'assets', 'style.css'));
const multiJs = fs.readFileSync(path.join(publicDir, 'assets', 'multi.js'));
const faviconIco = fs.readFileSync(path.join(publicDir, 'assets', 'favicon.ico'));
const tlsOptions = sslRequested ? loadTlsOptions() : null;
const tlsEnabled = Boolean(tlsOptions);
const hlsRoot = compressedEnabled ? fs.mkdtempSync(path.join(os.tmpdir(), 'udp-airband-hls-')) : '';
const compressed = createCompressedManager({
  aacBitrate,
  adpcmFrameMs,
  addListenerBytes,
  addListenerMode,
  ensureListenerStats,
  ffmpegPath,
  fs,
  hlsRoot,
  maxSocketBufferBytes: MAX_SOCKET_BUFFER_BYTES,
  maxStdinBufferBytes: MAX_OPUS_STDIN_BUFFER_BYTES,
  normalizeClientId: (value) => normalizeClientId(value, crypto),
  path,
  removeListenerMode,
  sendWsBinary,
  spawn,
  spawnSync,
  opusBitrate,
  logger,
  debugEnabled,
});
const compressedAvailable = compressedEnabled && compressed.isCodecAvailable(compressedCodec);
const opusAvailable = compressedEnabled && compressed.ffmpegAvailable;
if (!serverConfigExists) {
  logger.warn('server_config_missing', { path: serverConfigPath, fallback: 'built-in defaults' });
}
if (serverConfigUpdated) {
  logger.info('server_config_updated', { path: serverConfigPath, added: 'api.enabled=false' });
}

const streamsConfigExists = fs.existsSync(path.resolve(configPath));
if (!streamsConfigExists) {
  logger.warn('streams_config_missing', {
    path: configPath,
    fallback: `/${DEFAULT_STREAMS[0].name} on UDP ${defaultUdpHost}:${DEFAULT_STREAMS[0].udpPort}`,
  });
}

let streams;
try {
  streams = loadStreams({ configPath, defaultUdpHost, fs, opusKeepaliveMs, path });
  validateStreams(streams);
} catch (err) {
  fatal(err.message);
}
const streamsByName = new Map(streams.map((stream) => [stream.name, stream]));
const nativeMultiAac = createNativeMultiAac({
  aacBitrate,
  addListenerBytes,
  addListenerMode,
  ffmpegPath,
  logger,
  removeListenerMode,
  spawn,
  streamsByName,
});

const webProtocol = tlsEnabled ? 'https' : 'http';
const webServer = tlsEnabled
  ? https.createServer(tlsOptions, handleHttpRequest)
  : http.createServer(handleHttpRequest);

attachUpgradeHandler(webServer);
startUdpServers();

function startUdpServers() {
  let pendingUdpBinds = streams.length;
  for (const stream of streams) {
    const udpServer = dgram.createSocket('udp4');
    stream.udpServer = udpServer;

    udpServer.on('message', (msg) => handleUdpMessage(stream, msg));
    udpServer.on('error', (err) => fatal(`UDP error on ${stream.name}: ${err.message}`));
    udpServer.bind(stream.udpPort, stream.udpHost, () => {
      logger.plain('info', formatStreamStartupLine(stream));
      pendingUdpBinds -= 1;
      if (pendingUdpBinds === 0) {
        startWebServers();
      }
    });
  }
}

function handleUdpMessage(stream, msg) {
  if (msg.length === 0 || msg.length % 4 !== 0) {
    return;
  }

  stream.packetCount += 1;
  stream.byteCount += msg.length;
  stream.lastUdpAt = Date.now();
  nativeMultiAac.pushPcm(stream, msg);

  for (const [client, clientId] of stream.rawClients) {
    if (client.destroyed || client.writableLength > MAX_SOCKET_BUFFER_BYTES) {
      logger.warn('raw_client_backpressure', { stream: stream.name, client: clientId, writableLength: client.writableLength });
      client.destroy();
      removeWsClient(stream, client);
      continue;
    }
    sendWsBinary(client, msg);
    addListenerBytes(stream, clientId, 'raw', msg.length);
  }

  for (const opusClient of stream.opusClients) {
    if (!compressed.isWritableClient(opusClient)) {
      compressed.cleanupClient(stream, opusClient);
      continue;
    }
    if (opusClient.backpressured) {
      opusClient.droppedBytes += msg.length;
      continue;
    }
    compressed.writeInput(stream, opusClient, msg);
  }
}

function handleHttpRequest(req, res) {
  const requestUrl = new URL(req.url, `${isTlsRequest(req) ? 'https' : 'http'}://${req.headers.host || 'localhost'}`);
  const pathname = normalizePath(requestUrl.pathname);
  if (pathname === null) {
    sendBadRequest(res);
    return;
  }

  if (pathname === '/') {
    sendHtml(res, renderStreamList(streams, { softwareVersion: SOFTWARE_VERSION }));
    return;
  }
  if (pathname === '/multi') {
    sendHtml(res, renderMultiStreamPage(streams, { softwareVersion: SOFTWARE_VERSION }));
    return;
  }
  if (pathname === '/multi/native.aac') {
    if (!compressed.ffmpegAvailable) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Native AAC unavailable: ffmpeg not found\n');
      return;
    }
    nativeMultiAac.serve(requestUrl, res, (value) => normalizeClientId(value, crypto));
    return;
  }
  if (pathname === '/multi/native-gain') {
    const clientId = normalizeClientId(requestUrl.searchParams.get('clientId'), crypto);
    const ok = nativeMultiAac.setGain(clientId, requestUrl.searchParams.get('stream'), requestUrl.searchParams.get('gain'));
    sendJsonResponse(res, { ok });
    return;
  }
  if (pathname === '/favicon.ico') {
    sendAsset(res, faviconIco, 'image/x-icon', 'public, max-age=86400');
    return;
  }
  if (pathname === '/assets/favicon.ico') {
    sendAsset(res, faviconIco, 'image/x-icon', 'public, max-age=86400');
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
  if (pathname === '/assets/multi.js') {
    sendAsset(res, multiJs, 'application/javascript; charset=utf-8');
    return;
  }
  if (pathname === '/status') {
    if (!apiEnabled) {
      sendNotFound(res);
      return;
    }
    sendJsonResponse(res, streams.map(publicStreamStatus));
    return;
  }
  if (pathname.startsWith('/status/')) {
    if (!apiEnabled) {
      sendNotFound(res);
      return;
    }
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
    compressed.serveHls(stream, hlsMatch[2], hlsMatch[3], res);
    return;
  }

  const opusMatch = pathname.match(/^\/([^/]+)\/opus$/);
  if (opusMatch) {
    const stream = streamsByName.get(opusMatch[1]);
    if (!stream) {
      sendNotFound(res);
      return;
    }
    compressed.serveHttpOpus(stream, requestUrl, res);
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
    const pathname = normalizePath(requestUrl.pathname);
    if (pathname === null) {
      socket.destroy();
      return;
    }
    const match = pathname.match(/^\/([^/]+)\/(audio|control|adpcm|opus|aac)$/);
    if (!match) {
      logger.warn('websocket_rejected', { path: requestUrl.pathname, reason: 'invalid_route' });
      socket.destroy();
      return;
    }

    const stream = streamsByName.get(match[1]);
    const socketType = match[2];
    if (!stream || !acceptWebSocket(req, socket, crypto)) {
      logger.warn('websocket_rejected', { path: requestUrl.pathname, reason: stream ? 'invalid_handshake' : 'unknown_stream' });
      socket.destroy();
      return;
    }

    const clientId = normalizeClientId(requestUrl.searchParams.get('clientId'), crypto);
    if (socketType === 'control') {
      const monitorOnly = requestUrl.searchParams.get('monitor') === '1';
      stream.controlClients.set(socket, clientId);
      if (!monitorOnly) addListenerMode(stream, clientId, 'control');
      sendWsJson(socket, streamConfig(stream));
      logger.info('client_connected', { stream: stream.name, mode: monitorOnly ? 'control-monitor' : 'control', client: clientId, remote: socket.remoteAddress });
    } else if (socketType === 'adpcm' || socketType === 'opus' || socketType === 'aac') {
      compressed.serveWebSocket(stream, clientId, socket, socketType);
      logger.info('client_connected', { stream: stream.name, mode: socketType, client: clientId, remote: socket.remoteAddress });
    } else {
      stream.rawClients.set(socket, clientId);
      addListenerMode(stream, clientId, 'raw');
      logger.info('client_connected', { stream: stream.name, mode: 'raw', client: clientId, remote: socket.remoteAddress });
    }

    socket.on('error', (err) => {
      const fields = { stream: stream.name, mode: socketType, client: clientId, error: err.message };
      if (isExpectedClientSocketError(err)) {
        logger.debug('client_socket_closed', fields);
      } else {
        logger.warn('client_socket_error', fields);
      }
      removeWsClient(stream, socket);
    });
    socket.on('close', () => {
      logger.info('client_disconnected', { stream: stream.name, mode: socketType, client: clientId });
      removeWsClient(stream, socket);
    });
    socket.on('data', () => {});
  });
}

function startWebServers() {
  if (debugEnabled) {
    logger.debug('debug_enabled', { flag: '-D' });
  }
  webServer.listen(httpPort, httpHost, () => {
    logger.plain('info', `Web player: ${formatUrl(webProtocol, httpHost, httpPort)}/`);
    logger.info('startup', {
      version: SOFTWARE_VERSION,
      serverConfig: serverConfigPath,
      serverConfigLoaded: serverConfigExists,
      streamsConfig: configPath,
      streamsConfigLoaded: streamsConfigExists,
      apiEnabled,
      logLevel: logger.level,
    });
  });

  logger.plain('info', `Compressed: ${compressedEnabled ? formatCompressedStatus() : 'disabled by config'}`);
  if (compressedEnabled && !compressedAvailable) {
    logger.warn('compressed_unavailable', { codec: compressedCodec, ffmpeg: ffmpegPath });
  }
  setInterval(broadcastStreamStats, 1000);
  if (compressedEnabled) {
    setInterval(() => compressed.writeSilenceKeepalive(streams, opusKeepaliveMs), opusKeepaliveMs);
  }
}

function publicStreamStatus(stream) {
  const activeListeners = getActiveListeners(stream);
  const lastHeard = getLastHeard(stream, Date.now());
  return {
    name: stream.name,
    label: stream.label,
    sampleRate: stream.sampleRate,
    channels: stream.channels,
    activeListeners: activeListeners.length,
    lastHeardAt: lastHeard.at,
    lastHeardLabel: lastHeard.label,
    secondsSinceLastHeard: lastHeard.secondsSince,
    hasUdp: stream.packetCount > 0,
    url: `/${stream.name}`,
    compressedEnabled,
    compressedAvailable,
    compressedCodec,
    adpcmAvailable: compressedEnabled,
    adpcmFrameMs,
    opusAvailable,
    aacAvailable: opusAvailable && compressedCodec === 'aac',
    hlsAvailable: opusAvailable && compressedCodec === 'hls',
    tlsEnabled,
    softwareVersion: SOFTWARE_VERSION,
  };
}

function streamConfig(stream) {
  return {
    type: 'config',
    name: stream.name,
    label: stream.label,
    sampleRate: stream.sampleRate,
    channels: stream.channels,
    format: 'f32le',
    compressedEnabled,
    compressedAvailable,
    compressedCodec,
    adpcmAvailable: compressedEnabled,
    adpcmFrameMs,
    opusAvailable,
    opusBitrate,
    aacAvailable: opusAvailable && compressedCodec === 'aac',
    aacBitrate,
    hlsAvailable: opusAvailable && compressedCodec === 'hls',
    tlsEnabled,
    softwareVersion: SOFTWARE_VERSION,
  };
}

function broadcastStreamStats() {
  const now = Date.now();
  for (const stream of streams) {
    pruneInactiveListeners(stream, now);
    compressed.pruneInactiveHlsClients(stream, now);
    const lastHeard = getLastHeard(stream, now);
    const elapsedSeconds = Math.max(0.001, (now - stream.lastStatsAt) / 1000);
    stream.lastStatsByteCount = stream.byteCount;
    stream.lastStatsAt = now;

    for (const [client, clientId] of stream.controlClients) {
      if (client.destroyed || client.writableLength > MAX_SOCKET_BUFFER_BYTES) {
        logger.warn('control_client_backpressure', { stream: stream.name, client: clientId, writableLength: client.writableLength });
        client.destroy();
        removeWsClient(stream, client);
        continue;
      }
      const listenerStats = ensureListenerStats(stream, clientId);
      const listenerBitsPerSecond = Math.max(0, (listenerStats.bytes - listenerStats.lastBytes) * 8 / elapsedSeconds);
      listenerStats.lastBytes = listenerStats.bytes;
      sendWsJson(client, {
        type: 'stats',
        listenerBitsPerSecond,
        lastHeardAt: lastHeard.at,
        lastHeardLabel: lastHeard.label,
        secondsSinceLastHeard: lastHeard.secondsSince,
        hasUdp: stream.packetCount > 0,
        activeListeners: getActiveListeners(stream).length,
        compressedCodec,
        softwareVersion: SOFTWARE_VERSION,
      });
    }
  }
}

function formatCompressedStatus() {
  if (!compressedAvailable) {
    return `${compressedCodec} unavailable${compressedCodec === 'adpcm' ? '' : ' (ffmpeg not found)'}`;
  }
  if (compressedCodec === 'adpcm') {
    return `enabled via ADPCM (${adpcmFrameMs} ms frames)`;
  }
  return `enabled via ${ffmpegPath} (${compressedCodec})`;
}

function sendHtml(res, body) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    ...securityHeaders(),
  });
  res.end(body);
}

function sendAsset(res, body, contentType, cacheControl = 'no-store') {
  res.writeHead(200, {
    'content-type': contentType,
    'cache-control': cacheControl,
    ...securityHeaders(),
  });
  res.end(body);
}

function sendJsonResponse(res, value) {
  res.writeHead(200, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...securityHeaders(),
  });
  res.end(JSON.stringify(value));
}

function sendNotFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...securityHeaders() });
  res.end('not found\n');
}

function sendBadRequest(res) {
  res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', ...securityHeaders() });
  res.end('bad request\n');
}

function loadTlsOptions() {
  if (!tlsKeyPath || !tlsCertPath) {
    logger.warn('ssl_fallback_http', { reason: 'missing certificate path', key: tlsKeyPath || 'missing', cert: tlsCertPath || 'missing' });
    return null;
  }

  const resolvedKey = path.resolve(tlsKeyPath);
  const resolvedCert = path.resolve(tlsCertPath);
  if (!fs.existsSync(resolvedKey) || !fs.existsSync(resolvedCert)) {
    logger.warn('ssl_fallback_http', { reason: 'certificate file not found', key: resolvedKey, cert: resolvedCert });
    return null;
  }

  try {
    return {
      key: fs.readFileSync(resolvedKey),
      cert: fs.readFileSync(resolvedCert),
    };
  } catch (err) {
    logger.warn('ssl_fallback_http', { reason: 'certificate read failed', error: err.message });
    return null;
  }
}

function isTlsRequest(req) {
  return Boolean(req.socket && req.socket.encrypted);
}

function formatUrl(protocol, host, port) {
  const defaultPort = protocol === 'https' ? 443 : 80;
  return `${protocol}://${host}${port === defaultPort ? '' : `:${port}`}`;
}

function formatStreamStartupLine(stream) {
  const channelLabel = stream.channels === 1 ? 'mono' : 'stereo';
  return `Stream: ${stream.name} ( ${stream.udpHost}:${stream.udpPort} ) -> /${stream.name} (${stream.label}) ${channelLabel} @ ${stream.sampleRate} Hz`;
}

function isExpectedClientSocketError(err) {
  return ['EPIPE', 'ECONNRESET', 'ECONNABORTED', 'ERR_STREAM_DESTROYED'].includes(err && err.code);
}

function normalizePath(value) {
  let pathOnly;
  try {
    pathOnly = decodeURIComponent(value.split('?')[0]);
  } catch {
    return null;
  }
  if (pathOnly.length > 1 && pathOnly.endsWith('/')) {
    return pathOnly.slice(0, -1);
  }
  return pathOnly;
}

function securityHeaders() {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; media-src 'self' blob:; worker-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  };
}

function fatal(message) {
  logger.error('fatal', { message });
  process.exit(1);
}
