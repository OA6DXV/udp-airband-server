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

function attachWsControlFrames(socket, initialData = Buffer.alloc(0), options = {}) {
  const maxPayloadBytes = options.maxPayloadBytes || 64 * 1024;
  let buffer = Buffer.alloc(0);

  function reject() {
    buffer = Buffer.alloc(0);
    socket.destroy();
  }

  function receive(chunk) {
    if (!chunk || chunk.length === 0 || socket.destroyed) return;
    if (buffer.length + chunk.length > maxPayloadBytes + 14) {
      reject();
      return;
    }
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk);

    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      const final = Boolean(first & 0x80);
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let payloadLength = second & 0x7f;
      let headerLength = 2;
      if ((first & 0x70) !== 0 || !masked) {
        reject();
        return;
      }
      if (payloadLength === 126) {
        if (buffer.length < 4) return;
        payloadLength = buffer.readUInt16BE(2);
        headerLength = 4;
      } else if (payloadLength === 127) {
        if (buffer.length < 10) return;
        const wideLength = buffer.readBigUInt64BE(2);
        if (wideLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          reject();
          return;
        }
        payloadLength = Number(wideLength);
        headerLength = 10;
      }
      const controlFrame = opcode >= 0x8;
      if (payloadLength > maxPayloadBytes || (controlFrame && (!final || payloadLength > 125))) {
        reject();
        return;
      }
      const frameLength = headerLength + 4 + payloadLength;
      if (buffer.length < frameLength) return;

      const maskOffset = headerLength;
      const payloadOffset = maskOffset + 4;
      const payload = Buffer.allocUnsafe(payloadLength);
      for (let index = 0; index < payloadLength; index += 1) {
        payload[index] = buffer[payloadOffset + index] ^ buffer[maskOffset + (index % 4)];
      }
      buffer = buffer.subarray(frameLength);

      if (opcode === 0x8) {
        socket.end(encodeWsFrame(payload, 0x8));
        return;
      }
      if (opcode === 0x9) socket.write(encodeWsFrame(payload, 0x0a));
    }
  }

  socket.on('data', receive);
  if (initialData.length) receive(initialData);
}

function sendWsJson(socket, value) {
  return socket.write(encodeWsFrame(Buffer.from(JSON.stringify(value), 'utf8'), 0x1));
}

function sendWsBinary(socket, buffer) {
  return sendWsEncoded(socket, encodeWsBinary(buffer));
}

function encodeWsBinary(buffer) {
  return encodeWsFrame(buffer, 0x2);
}

function sendWsEncoded(socket, frame) {
  return socket.write(frame);
}

function encodeWsFrame(payload, opcode) {
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

  return Buffer.concat([header, payload]);
}

module.exports = {
  acceptWebSocket,
  attachWsControlFrames,
  encodeWsBinary,
  sendWsBinary,
  sendWsEncoded,
  sendWsJson,
};
