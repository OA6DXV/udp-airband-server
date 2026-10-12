'use strict';

const crypto = require('crypto');

// Browsers answer protocol pings even when page JavaScript is suspended.
// The timeout allows occasional delays without accumulating abandoned sockets.
function attachWebSocketLifecycle(socket, {
  head = Buffer.alloc(0),
  onDisconnect = () => {},
  now = Date.now,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  heartbeatMs = 15000,
  timeoutMs = 45000,
} = {}) {
  let pending = Buffer.alloc(0);
  let disconnected = false;
  let ping = null;
  let pingAt = 0;
  let closeTimer = null;
  let heartbeat = null;

  function disconnect() {
    if (disconnected) return;
    disconnected = true;
    if (heartbeat !== null) clearIntervalFn(heartbeat);
    pending = Buffer.alloc(0);
    onDisconnect();
  }

  function fail() {
    disconnect();
    socket.destroy();
  }

  function receive(chunk) {
    if (disconnected) return;
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= 2) {
      const opcode = pending[0] & 0x0f;
      const control = opcode >= 8;
      if ((pending[0] & 0x70) || !(pending[1] & 0x80)
        || ![0, 1, 2, 8, 9, 10].includes(opcode)
        || (control && (!(pending[0] & 0x80) || (pending[1] & 0x7f) > 125))) return fail();
      let length = pending[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (pending.length < 4) return;
        length = pending.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (pending.length < 10) return;
        const largeLength = pending.readBigUInt64BE(2);
        if (largeLength > 65536n) return fail();
        length = Number(largeLength);
        offset = 10;
      }
      if (length > 65536 || (opcode === 8 && length === 1)) return fail();
      const payloadAt = offset + 4;
      if (pending.length < payloadAt + length) return;
      const payload = Buffer.from(pending.subarray(payloadAt, payloadAt + length));
      for (let i = 0; i < length; i += 1) payload[i] ^= pending[offset + i % 4];
      pending = pending.subarray(payloadAt + length);
      if (opcode === 8) {
        disconnect();
        sendFrame(socket, payload, 8);
        socket.end();
        closeTimer = setTimeoutFn(() => socket.destroy(), 5000);
        if (closeTimer && typeof closeTimer.unref === 'function') closeTimer.unref();
        return;
      }
      if (opcode === 9) sendFrame(socket, payload, 10);
      if (opcode === 10 && ping && payload.equals(ping)) ping = null;
    }
  }

  socket.on('data', receive);
  socket.on('end', disconnect);
  socket.on('error', fail);
  socket.on('close', () => {
    disconnect();
    if (closeTimer !== null) clearTimeoutFn(closeTimer);
  });
  heartbeat = setIntervalFn(() => {
    if (disconnected || socket.destroyed) return fail();
    if (ping) {
      if (now() - pingAt >= timeoutMs) fail();
      return;
    }
    ping = crypto.randomBytes(8);
    pingAt = now();
    sendFrame(socket, ping, 9);
  }, heartbeatMs);
  if (heartbeat && typeof heartbeat.unref === 'function') heartbeat.unref();
  if (socket.destroyed) disconnect();
  else if (head.length) receive(head);
}

function acceptWebSocket(req, socket, crypto) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return false;
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
  return true;
}

function sendWsJson(socket, value) {
  sendFrame(socket, Buffer.from(JSON.stringify(value), 'utf8'), 0x1);
}

function sendWsBinary(socket, buffer) {
  return sendFrame(socket, buffer, 0x2);
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

module.exports = {
  acceptWebSocket,
  attachWebSocketLifecycle,
  sendWsBinary,
  sendWsJson,
};
