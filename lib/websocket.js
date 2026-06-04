'use strict';

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
  sendWsBinary,
  sendWsJson,
};
