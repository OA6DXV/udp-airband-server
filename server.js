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
const { DEFAULT_STREAMS, loadStreams, loadStreamsFromConfig, renderMultiStreamPage, renderStreamList, validateStreams } = require('./lib/streams');
const { acceptWebSocket, sendWsBinary, sendWsJson } = require('./lib/websocket');
const { createCompressedManager } = require('./lib/compressed');
const { createNativeMultiAac } = require('./lib/native-multi-aac');
const { createLastHeardStore } = require('./lib/last-heard-store');
const { detectRuntimeMode } = require('./lib/runtime');
const { createUserHistory } = require('./lib/user-history');
const { createWebAdmin } = require('./lib/web-admin');

const MAX_SOCKET_BUFFER_BYTES = 1024 * 1024;
const MAX_OPUS_STDIN_BUFFER_BYTES = 512 * 1024;
const SOFTWARE_VERSION = '1.7-preview';
const COMPRESSED_CODECS = new Set(['adpcm', 'opus', 'aac', 'hls']);
const serverInstanceId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}
const serverConfigPath = args.serverConfig || args.serverConf || 'server.conf';
const serverConfigExists = fs.existsSync(path.resolve(serverConfigPath));
const serverConfigUpdated = ensureServerConfigDefaults(serverConfigPath, [
  {
    name: 'api',
    comments: ['Public status API. Keep disabled unless you explicitly want /status endpoints.'],
    keys: [{ key: 'enabled', value: 'false' }],
  },
  {
    name: 'admin',
    comments: ['Separate Web Admin listener. Keep disabled unless administrative access is required.'],
    keys: [
      { key: 'host', value: '127.0.0.1' },
      { key: 'port', value: '9090' },
      { key: 'enabled', value: 'false' },
    ],
  },
], fs, path);
const serverConfig = loadServerConfig(serverConfigPath, fs, path);
const defaultUdpHost = args.udpHost || getSetting(serverConfig, 'udp.host', '0.0.0.0');
const httpHost = args.httpHost || getSetting(serverConfig, 'web.host', '0.0.0.0');
const httpPort = Number(args.httpPort || args.http || getSetting(serverConfig, 'web.port', 8585));
const adminConfigEnabled = parseBoolean(getSetting(serverConfig, 'admin.enabled', false));
const adminConfigHost = String(getSetting(serverConfig, 'admin.host', '127.0.0.1'));
const adminConfigPort = Number(getSetting(serverConfig, 'admin.port', 9090));
const webAdminCliFlag = args.webserver !== undefined
  ? '--webserver'
  : (args.webadmin !== undefined ? '--webadmin' : '');
const webAdminCliPort = webAdminCliFlag === '--webserver' ? args.webserver : args.webadmin;
const webAdminEnabled = webAdminCliFlag ? true : adminConfigEnabled;
const webAdminPort = Number(webAdminCliFlag
  ? (webAdminCliPort !== true ? webAdminCliPort : Number.NaN)
  : adminConfigPort);
const webAdminHost = String(args.webadminHost || adminConfigHost);
const webAdminConfigOverridden = Boolean(webAdminCliFlag || args.webadminHost !== undefined);
const configPath = args.config || getSetting(serverConfig, 'streams.file', 'streams.json');
const dataDir = path.resolve(args.dataDir || path.join(__dirname, 'data'));
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
const runtimeMode = detectRuntimeMode();
const userHistory = createUserHistory({
  filePath: path.join(dataDir, 'user-history.json'),
  fs,
  logger,
  path,
});
const clientLifecycleLog = createClientLifecycleLog(logger, (count) => userHistory.record(count));

if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) {
  fatal('--http-port must be a valid port');
}
if (webAdminEnabled && (!Number.isInteger(webAdminPort) || webAdminPort < 1 || webAdminPort > 65535)) {
  fatal(webAdminCliFlag
    ? `${webAdminCliFlag} requires a valid port, for example: ${webAdminCliFlag} 9090`
    : '[admin].port must be a valid port when [admin].enabled is true');
}
if (webAdminEnabled && webAdminPort === httpPort && isOverlappingHost(webAdminHost, httpHost)) {
  fatal('Web Admin must use a different port from the public web player');
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
const adminAssets = webAdminEnabled ? {
  html: fs.readFileSync(path.join(publicDir, 'admin', 'index.html')),
  css: fs.readFileSync(path.join(publicDir, 'admin', 'admin.css')),
  js: fs.readFileSync(path.join(publicDir, 'admin', 'admin.js')),
  favicon: faviconIco,
} : null;
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
  logger.info('server_config_updated', { path: serverConfigPath, added: 'missing defaults' });
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
const lastHeardStore = createLastHeardStore({
  filePath: path.join(dataDir, 'last-heard.json'),
  fs,
  logger,
  path,
});
lastHeardStore.apply(streams);
const nativeMultiAac = createNativeMultiAac({
  aacBitrate,
  addListenerBytes,
  addListenerMode,
  ffmpegPath,
  logger,
  onClientConnected: (clientId, remote) => recordClientActivity('connected', 'multi', 'native-aac', clientId, remote),
  onClientDisconnected: (clientId, remote) => recordClientActivity('disconnected', 'multi', 'native-aac', clientId, remote),
  removeListenerMode,
  spawn,
  streamsByName,
});

const webProtocol = tlsEnabled ? 'https' : 'http';
const webServer = tlsEnabled
  ? https.createServer(tlsOptions, handleHttpRequest)
  : http.createServer(handleHttpRequest);
const webAdmin = webAdminEnabled ? createWebAdmin({
  assets: adminAssets,
  getState: getWebAdminState,
  host: webAdminHost,
  http,
  logger,
  onReloadStreams: reloadStreamsFromDisk,
  onReplaceStreams: replaceStreamsFromAdmin,
  onRestart: () => process.kill(process.pid, 'SIGTERM'),
  port: webAdminPort,
  softwareVersion: SOFTWARE_VERSION,
}) : null;

attachUpgradeHandler(webServer);
attachShutdownHandlers();
startUdpServers().then(startWebServers).catch((err) => fatal(err.message));

function startUdpServers() {
  return bindUdpServers(streams, true);
}

function bindUdpServers(items, logStartup = false) {
  return Promise.all(items.map((stream) => (
    bindUdpServer(stream, logStartup)
      .then(() => ({ ok: true }))
      .catch((error) => ({ error, ok: false }))
  ))).then((results) => {
    const failed = results.find((result) => !result.ok);
    if (failed) throw failed.error;
  });
}

function bindUdpServer(stream, logStartup) {
  return new Promise((resolve, reject) => {
    const udpServer = dgram.createSocket('udp4');
    stream.udpServer = udpServer;

    udpServer.on('message', (msg) => handleUdpMessage(stream, msg));
    const onBindError = (err) => {
      udpServer.removeListener('error', onBindError);
      reject(new Error(`UDP error on ${stream.name}: ${err.message}`));
    };
    udpServer.once('error', onBindError);
    udpServer.bind(stream.udpPort, stream.udpHost, () => {
      udpServer.removeListener('error', onBindError);
      udpServer.on('error', (err) => logger.error('udp_socket_error', { stream: stream.name, error: err.message }));
      if (logStartup) logger.plain('info', formatStreamStartupLine(stream));
      resolve();
    });
  });
}

function handleUdpMessage(stream, msg) {
  if (msg.length === 0 || msg.length % 4 !== 0) {
    return;
  }

  stream.packetCount += 1;
  stream.byteCount += msg.length;
  stream.lastUdpAt = Date.now();
  lastHeardStore.record(stream.name, stream.lastUdpAt);
  stream.levelPeak = Math.max(stream.levelPeak * 0.75, peakOfFloatPcm(msg));
  stream.levelPeakAt = stream.lastUdpAt;
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
    nativeMultiAac.serve(requestUrl, res, (value) => normalizeClientId(value, crypto), getRemoteAddress(req, req.socket));
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
    sendHtml(res, renderPlayerPage(indexHtml, SOFTWARE_VERSION));
    return;
  }

  sendNotFound(res);
}

function attachUpgradeHandler(server) {
  server.on('upgrade', (req, socket) => {
    const remoteAddress = getRemoteAddress(req, socket);
    if (typeof socket.setNoDelay === 'function') socket.setNoDelay(true);
    const requestUrl = new URL(req.url, `${socket.encrypted ? 'https' : 'http'}://${req.headers.host || 'localhost'}`);
    const pathname = normalizePath(requestUrl.pathname);
    if (pathname === null) {
      socket.destroy();
      return;
    }
    const match = pathname.match(/^\/([^/]+)\/(audio|control|adpcm|opus|aac)$/);
    if (!match) {
      logger.warn('websocket_rejected', { path: requestUrl.pathname, reason: 'invalid_route', remote: remoteAddress });
      socket.destroy();
      return;
    }

    const stream = streamsByName.get(match[1]);
    const socketType = match[2];
    if (!stream || !acceptWebSocket(req, socket, crypto)) {
      logger.warn('websocket_rejected', { path: requestUrl.pathname, reason: stream ? 'invalid_handshake' : 'unknown_stream', remote: remoteAddress });
      socket.destroy();
      return;
    }

    const clientId = normalizeClientId(requestUrl.searchParams.get('clientId'), crypto);
    let connectionLogMode = socketType === 'audio' ? 'raw' : socketType;
    if (socketType === 'control') {
      const monitorOnly = requestUrl.searchParams.get('monitor') === '1';
      connectionLogMode = monitorOnly ? 'control-monitor' : 'control';
      stream.controlClients.set(socket, clientId);
      if (!monitorOnly) addListenerMode(stream, clientId, 'control');
      sendWsJson(socket, streamConfig(stream));
      recordClientActivity('connected', stream.name, connectionLogMode, clientId, remoteAddress);
    } else if (socketType === 'adpcm' || socketType === 'opus' || socketType === 'aac') {
      compressed.serveWebSocket(stream, clientId, socket, socketType);
      recordClientActivity('connected', stream.name, socketType, clientId, remoteAddress);
    } else {
      stream.rawClients.set(socket, clientId);
      addListenerMode(stream, clientId, 'raw');
      recordClientActivity('connected', stream.name, 'raw', clientId, remoteAddress);
    }

    socket.on('error', (err) => {
      const fields = { stream: stream.name, mode: connectionLogMode, client: clientId, error: err.message };
      if (isExpectedClientSocketError(err)) {
        logger.debug('client_socket_closed', fields);
      } else {
        logger.warn('client_socket_error', fields);
      }
      removeWsClient(stream, socket);
    });
    socket.on('close', () => {
      recordClientActivity('disconnected', stream.name, connectionLogMode, clientId, remoteAddress);
      removeWsClient(stream, socket);
    });
    socket.on('data', () => {});
  });
}

function attachShutdownHandlers() {
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown', { signal });
    lastHeardStore.flush();
    userHistory.record(clientLifecycleLog.activeCount());
    userHistory.flush();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  }
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

function recordClientActivity(action, streamName, mode, clientId, remote) {
  logger.debug(`client_${action}`, { stream: streamName, mode, client: clientId, remote });
  clientLifecycleLog.record(action, clientId, remote);
}

function createClientLifecycleLog(activityLogger, onCountChanged) {
  const disconnectGraceMs = 2000;
  const clients = new Map();

  function record(action, clientId, remote) {
    if (!clientId) return;
    if (action === 'connected') {
      recordConnect(clientId, remote);
      return;
    }
    if (action === 'disconnected') {
      recordDisconnect(clientId);
    }
  }

  function recordConnect(clientId, remote) {
    let entry = clients.get(clientId);
    if (!entry) {
      entry = { socketCount: 0, remote, connectedAt: Date.now(), disconnectTimer: null };
      clients.set(clientId, entry);
      activityLogger.info('client_connected', { client: clientId, remote, activeClients: clients.size });
      if (onCountChanged) onCountChanged(clients.size);
    }
    if (entry.disconnectTimer) {
      clearTimeout(entry.disconnectTimer);
      entry.disconnectTimer = null;
    }
    entry.socketCount += 1;
    if (remote) entry.remote = remote;
  }

  function recordDisconnect(clientId) {
    const entry = clients.get(clientId);
    if (!entry) return;
    entry.socketCount = Math.max(0, entry.socketCount - 1);
    if (entry.socketCount > 0 || entry.disconnectTimer) return;
    entry.disconnectTimer = setTimeout(() => {
      const latest = clients.get(clientId);
      if (!latest || latest.socketCount > 0) return;
      clients.delete(clientId);
      activityLogger.info('client_disconnected', {
        client: clientId,
        remote: latest.remote,
        durationSec: Math.max(0, Math.round((Date.now() - latest.connectedAt) / 1000)),
        activeClients: clients.size,
      });
      if (onCountChanged) onCountChanged(clients.size);
    }, disconnectGraceMs);
    if (typeof entry.disconnectTimer.unref === 'function') entry.disconnectTimer.unref();
  }

  return {
    activeCount: () => clients.size,
    record,
  };
}

function startWebServers() {
  if (debugEnabled) {
    logger.debug('debug_enabled', { flag: '-D' });
  }
  const publicStart = new Promise((resolve, reject) => {
    webServer.once('error', reject);
    webServer.listen(httpPort, httpHost, () => {
      webServer.removeListener('error', reject);
      resolve();
    });
  });
  const adminStart = webAdmin ? webAdmin.start() : Promise.resolve();

  Promise.all([publicStart, adminStart]).then(() => {
    logger.plain('info', `Compressed: ${compressedEnabled ? formatCompressedStatus() : 'disabled by config'}`);
    if (compressedEnabled && !compressedAvailable) {
      logger.warn('compressed_unavailable', { codec: compressedCodec, ffmpeg: ffmpegPath });
    }
    if (webAdmin) {
      if (webAdminConfigOverridden) {
        logger.info('webadmin_config_override', {
          source: webAdminCliFlag || '--webadmin-host',
          priority: 'command-line',
          serverConfig: serverConfigPath,
          overridden: [
            webAdminCliFlag ? 'admin.enabled,admin.port' : '',
            args.webadminHost !== undefined ? 'admin.host' : '',
          ].filter(Boolean).join(','),
          host: webAdminHost,
          port: webAdminPort,
        });
      }
      logger.plain('info', `Web admin: ${formatUrl('http', webAdminHost, webAdminPort)}/`);
      if (!isLoopbackHost(webAdminHost)) {
        logger.warn('webadmin_exposed', { host: webAdminHost, port: webAdminPort, recommendation: 'bind to 127.0.0.1 and use an authenticated proxy or SSH tunnel' });
      }
    }
    logger.plain('info', `Web player: ${formatUrl(webProtocol, httpHost, httpPort)}/`);
    logger.info('startup', {
      version: SOFTWARE_VERSION,
      serverConfig: serverConfigPath,
      serverConfigLoaded: serverConfigExists,
      streamsConfig: configPath,
      streamsConfigLoaded: streamsConfigExists,
      apiEnabled,
      webAdminEnabled,
      webAdminHost: webAdminEnabled ? webAdminHost : undefined,
      webAdminPort: webAdminEnabled ? webAdminPort : undefined,
      runtimeMode,
      logLevel: logger.level,
    });
  }).catch((err) => fatal(err.message));

  setInterval(() => userHistory.record(clientLifecycleLog.activeCount()), 60 * 1000);
  setInterval(broadcastStreamStats, 250);
  if (compressedEnabled) {
    setInterval(() => compressed.writeSilenceKeepalive(streams, opusKeepaliveMs), opusKeepaliveMs);
  }
}

let streamUpdateQueue = Promise.resolve();

function replaceStreamsFromAdmin(payload) {
  const operation = streamUpdateQueue.then(() => applyStreamReplacement(payload));
  streamUpdateQueue = operation.catch(() => {});
  return operation;
}

function reloadStreamsFromDisk() {
  const operation = streamUpdateQueue.then(() => {
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'));
    } catch (err) {
      const reloadError = new Error(`Could not read ${configPath}: ${err.message}`);
      reloadError.statusCode = err.code === 'ENOENT' ? 404 : 400;
      throw reloadError;
    }
    return applyStreamReplacement(payload);
  });
  streamUpdateQueue = operation.catch(() => {});
  return operation;
}

async function applyStreamReplacement(payload) {
  let candidateStreams;
  try {
    candidateStreams = loadStreamsFromConfig(payload, {
      configPath,
      defaultUdpHost,
      opusKeepaliveMs,
    });
    validateStreams(candidateStreams);
  } catch (err) {
    const validationError = new Error(err.message);
    validationError.statusCode = 400;
    throw validationError;
  }

  const resolvedConfigPath = path.resolve(configPath);
  const temporaryConfigPath = `${resolvedConfigPath}.${process.pid}.tmp`;
  const serializedConfig = `${JSON.stringify({ streams: candidateStreams.map(streamFileEntry) }, null, 2)}\n`;
  try {
    fs.mkdirSync(path.dirname(resolvedConfigPath), { recursive: true });
    fs.writeFileSync(temporaryConfigPath, serializedConfig, { mode: 0o600 });
  } catch (err) {
    const saveError = new Error(`Could not stage ${configPath}: ${err.message}`);
    saveError.statusCode = 500;
    throw saveError;
  }

  const previousStreams = streams;
  if (canUpdateStreamsInPlace(previousStreams, candidateStreams)) {
    try {
      fs.renameSync(temporaryConfigPath, resolvedConfigPath);
    } catch (err) {
      safeUnlink(temporaryConfigPath);
      const saveError = new Error(`Could not save ${configPath}: ${err.message}`);
      saveError.statusCode = 500;
      throw saveError;
    }
    for (let index = 0; index < previousStreams.length; index += 1) {
      previousStreams[index].label = candidateStreams[index].label;
    }
    logger.info('streams_reloaded', {
      count: streams.length,
      names: streams.map((stream) => stream.name).join(','),
      listenersPreserved: true,
    });
    return {
      ok: true,
      message: `${streams.length} stream${streams.length === 1 ? '' : 's'} updated without interrupting listeners.`,
      streams: streams.map(adminStreamState),
    };
  }

  await closeUdpServers(previousStreams);

  try {
    await bindUdpServers(candidateStreams);
  } catch (err) {
    await closeUdpServers(candidateStreams);
    try {
      await bindUdpServers(previousStreams);
    } catch (rollbackError) {
      logger.error('stream_reload_rollback_failed', { error: rollbackError.message });
    }
    safeUnlink(temporaryConfigPath);
    const bindError = new Error(`${err.message}. The previous stream configuration was restored.`);
    bindError.statusCode = 409;
    throw bindError;
  }

  try {
    fs.renameSync(temporaryConfigPath, resolvedConfigPath);
  } catch (err) {
    await closeUdpServers(candidateStreams);
    await bindUdpServers(previousStreams);
    safeUnlink(temporaryConfigPath);
    const saveError = new Error(`Could not save ${configPath}: ${err.message}`);
    saveError.statusCode = 500;
    throw saveError;
  }

  lastHeardStore.apply(candidateStreams);
  streams = candidateStreams;
  streamsByName.clear();
  for (const stream of streams) streamsByName.set(stream.name, stream);

  nativeMultiAac.cleanupAll();
  for (const stream of previousStreams) closeStreamClients(stream);

  logger.info('streams_reloaded', {
    count: streams.length,
    names: streams.map((stream) => stream.name).join(','),
  });
  return {
    ok: true,
    message: `${streams.length} stream${streams.length === 1 ? '' : 's'} applied without restarting the server.`,
    streams: streams.map(adminStreamState),
  };
}

function canUpdateStreamsInPlace(currentStreams, candidateStreams) {
  if (currentStreams.length !== candidateStreams.length) return false;
  return currentStreams.every((stream, index) => {
    const candidate = candidateStreams[index];
    return stream.name === candidate.name
      && stream.udpHost === candidate.udpHost
      && stream.udpPort === candidate.udpPort
      && stream.sampleRate === candidate.sampleRate
      && stream.channels === candidate.channels;
  });
}

function closeUdpServers(items) {
  return Promise.all(items.map((stream) => new Promise((resolve) => {
    const udpServer = stream.udpServer;
    stream.udpServer = null;
    if (!udpServer) {
      resolve();
      return;
    }
    try {
      udpServer.close(resolve);
    } catch {
      resolve();
    }
  })));
}

function closeStreamClients(stream) {
  for (const socket of Array.from(stream.controlClients.keys())) socket.destroy();
  for (const socket of Array.from(stream.rawClients.keys())) socket.destroy();
  for (const client of Array.from(stream.opusClients)) compressed.cleanupClient(stream, client);
  stream.controlClients.clear();
  stream.rawClients.clear();
  stream.listenerStats.clear();
}

function streamFileEntry(stream) {
  return {
    name: stream.name,
    label: stream.label,
    udpHost: stream.udpHost,
    udpPort: stream.udpPort,
    sampleRate: stream.sampleRate,
    channels: stream.channels,
  };
}

function adminStreamState(stream) {
  return {
    ...streamFileEntry(stream),
    activeListeners: getActiveListeners(stream).length,
    hasUdp: stream.packetCount > 0,
    lastUdpAt: stream.lastUdpAt,
  };
}

function getWebAdminState() {
  return {
    version: SOFTWARE_VERSION,
    uptimeSeconds: Math.floor(process.uptime()),
    activeUsers: clientLifecycleLog.activeCount(),
    configPath,
    runtimeMode,
    streams: streams.map(adminStreamState),
    userHistory: userHistory.snapshot(),
  };
}

function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    logger.warn('temporary_file_cleanup_failed', { path: filePath, error: err.message });
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
    serverInstanceId,
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
    serverInstanceId,
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
        levelPeak: now - stream.levelPeakAt > 400 ? 0 : stream.levelPeak,
        hasUdp: stream.packetCount > 0,
        activeListeners: getActiveListeners(stream).length,
        compressedCodec,
        softwareVersion: SOFTWARE_VERSION,
        serverInstanceId,
      });
    }
  }
}

function peakOfFloatPcm(buffer) {
  let peak = 0;
  for (let offset = 0; offset + 4 <= buffer.length; offset += 4) {
    const value = Math.abs(buffer.readFloatLE(offset));
    if (Number.isFinite(value) && value > peak) peak = value;
  }
  return Math.min(1, peak);
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

function renderPlayerPage(template, softwareVersion) {
  return String(template).replace(/__SOFTWARE_VERSION__/g, softwareVersion);
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

function isLoopbackHost(host) {
  const normalized = String(host).trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function isOverlappingHost(first, second) {
  const normalizedFirst = String(first).trim().toLowerCase();
  const normalizedSecond = String(second).trim().toLowerCase();
  return normalizedFirst === normalizedSecond
    || (isLoopbackHost(normalizedFirst) && isLoopbackHost(normalizedSecond))
    || normalizedFirst === '0.0.0.0'
    || normalizedSecond === '0.0.0.0'
    || normalizedFirst === '::'
    || normalizedSecond === '::';
}

function formatStreamStartupLine(stream) {
  const channelLabel = stream.channels === 1 ? 'mono' : 'stereo';
  return `Stream: ${stream.name} ( ${stream.udpHost}:${stream.udpPort} ) -> /${stream.name} (${stream.label}) ${channelLabel} @ ${stream.sampleRate} Hz`;
}

function getRemoteAddress(req, socket) {
  const headers = req && req.headers ? req.headers : {};
  const forwarded = firstHeaderValue(headers['cf-connecting-ip'])
    || firstHeaderValue(headers['x-real-ip'])
    || firstForwardedFor(headers['x-forwarded-for']);
  return forwarded || (socket && socket.remoteAddress) || '';
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) return firstHeaderValue(value[0]);
  return String(value || '').split(',')[0].trim();
}

function firstForwardedFor(value) {
  return firstHeaderValue(value);
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
    'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; media-src 'self' blob:; worker-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  };
}

function fatal(message) {
  logger.error('fatal', { message });
  process.exit(1);
}

function printHelp() {
  process.stdout.write(`UDP Airband Server ${SOFTWARE_VERSION}

Usage:
  node server.js [options]
  npm start -- [options]

Core options:
  --help, -h                    Show this help and exit.
  -D                            Enable debug logging, timestamps, colors, and encoder output.
  --server-config PATH          Server configuration file. Default: server.conf.
  --server-conf PATH            Alias for --server-config.
  --config PATH                 Streams configuration file. Overrides [streams].file.
  --data-dir PATH               Directory for runtime data. Default: ./data.

Public web player:
  --http-host HOST              Web player bind host. Overrides [web].host.
  --http-port PORT              Web player port. Overrides [web].port.
  --http PORT                   Alias for --http-port.

Web Admin:
  --webserver PORT              Enable Web Admin on PORT. Overrides [admin].enabled and [admin].port.
  --webadmin PORT               Alias for --webserver.
  --webadmin-host HOST          Web Admin bind host. Overrides [admin].host.

UDP and streams:
  --udp-host HOST               Default UDP bind host for streams without udpHost.

Public status API:
  -A                            Enable public /status endpoints.
  --api-enabled true|false      Override [api].enabled.

TLS / HTTPS:
  --ssl-enabled true|false      Enable HTTPS when valid key and cert are configured.
  --tls-enabled true|false      Alias for --ssl-enabled.
  --tls-key PATH                TLS private key path. Overrides [ssl].key.
  --https-key PATH              Alias for --tls-key.
  --tls-cert PATH               TLS certificate path. Overrides [ssl].cert.
  --https-cert PATH             Alias for --tls-cert.

Compressed audio:
  --compressed-enabled true|false
                                Enable or disable compressed audio modes.
  --compressed-codec CODEC      Compressed codec: adpcm, opus, aac, or hls.
  --codec CODEC                 Alias for --compressed-codec.
  --adpcm-frame-ms MS           ADPCM frame duration, 10-100 ms. Default: 40.
  --ffmpeg PATH                 ffmpeg executable path.
  --opus-bitrate RATE           Opus bitrate for ffmpeg modes. Default: 24k.
  --aac-bitrate RATE            AAC bitrate for native/compatible modes. Default: 32k.
  --opus-keepalive-ms MS        Silence keepalive interval, 20-1000 ms.

Logging:
  --log-level LEVEL             error, warn, info, or debug.
  --log-timestamps true|false   Add timestamps to logs.
  --log-colors true|false       Color console log levels.

Examples:
  node server.js
  node server.js -D
  node server.js --webserver 9090
  node server.js --config streams.json --http-host 0.0.0.0 --http-port 8585
`);
}
