#!/usr/bin/env node
'use strict';

const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = parseArgs(process.argv.slice(2));
const udpHost = args.udpHost || '0.0.0.0';
const udpPort = Number(args.udpPort || args.udp || 7355);
const httpHost = args.httpHost || '127.0.0.1';
const httpPort = Number(args.httpPort || args.http || 8080);
const sampleRate = Number(args.sampleRate || 8000);
const channels = Number(args.channels || 1);

if (![1, 2].includes(channels)) {
  fatal('--channels must be 1 or 2');
}
if (!Number.isInteger(udpPort) || udpPort < 1 || udpPort > 65535) {
  fatal('--udp-port must be a valid port');
}
if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) {
  fatal('--http-port must be a valid port');
}
if (!Number.isInteger(sampleRate) || sampleRate < 1000) {
  fatal('--sample-rate must be a positive integer');
}

const clients = new Set();
let packetCount = 0;
let byteCount = 0;
let lastUdpAt = 0;

const publicDir = __dirname;
const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'));

const httpServer = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(indexHtml);
    return;
  }

  if (req.url === '/favicon.ico') {
    res.writeHead(204, { 'cache-control': 'public, max-age=86400' });
    res.end();
    return;
  }

  if (req.url === '/status') {
    const body = JSON.stringify({
      udpHost,
      udpPort,
      sampleRate,
      channels,
      clients: clients.size,
      packetCount,
      byteCount,
      lastUdpAt,
    });
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    res.end(body);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found\n');
});

httpServer.on('upgrade', (req, socket) => {
  if (req.url !== '/audio') {
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
  clients.add(socket);
  sendJson(socket, {
    type: 'config',
    sampleRate,
    channels,
    format: 'f32le',
  });

  socket.on('error', () => clients.delete(socket));
  socket.on('close', () => clients.delete(socket));
  socket.on('data', () => {
    // Browser messages are not needed. Drain them so TCP backpressure stays sane.
  });
});

const udpServer = dgram.createSocket('udp4');

udpServer.on('message', (msg) => {
  if (msg.length === 0 || msg.length % 4 !== 0) {
    return;
  }

  packetCount += 1;
  byteCount += msg.length;
  lastUdpAt = Date.now();

  for (const client of clients) {
    if (client.destroyed || client.writableLength > 1024 * 1024) {
      client.destroy();
      clients.delete(client);
      continue;
    }
    sendBinary(client, msg);
  }
});

udpServer.on('error', (err) => fatal(`UDP error: ${err.message}`));

udpServer.bind(udpPort, udpHost, () => {
  httpServer.listen(httpPort, httpHost, () => {
    console.log(`UDP input:  ${udpHost}:${udpPort}`);
    console.log(`Web player: http://${httpHost}:${httpPort}/`);
    console.log(`Format:     ${channels === 1 ? 'mono' : 'stereo'} float32 little-endian @ ${sampleRate} Hz`);
  });
});

function sendJson(socket, value) {
  sendFrame(socket, Buffer.from(JSON.stringify(value), 'utf8'), 0x1);
}

function sendBinary(socket, buffer) {
  sendFrame(socket, buffer, 0x2);
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

function fatal(message) {
  console.error(message);
  process.exit(1);
}
