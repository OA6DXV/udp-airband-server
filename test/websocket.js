'use strict';

const assert = require('assert');
const { encodeWsBinary, sendWsBinary, sendWsEncoded } = require('../lib/websocket');

for (const length of [0, 125, 126, 640, 65535, 65536]) {
  const payload = Buffer.alloc(length, 0x5a);
  const frame = encodeWsBinary(payload);
  const headerLength = length < 126 ? 2 : (length <= 0xffff ? 4 : 10);
  assert.strictEqual(frame[0], 0x82);
  assert.strictEqual(frame.length, headerLength + length);
  assert.deepStrictEqual(frame.subarray(headerLength), payload);
  if (length < 126) assert.strictEqual(frame[1], length);
  else if (length <= 0xffff) assert.strictEqual(frame.readUInt16BE(2), length);
  else assert.strictEqual(Number(frame.readBigUInt64BE(2)), length);
}

const writes = [];
const socket = { write(frame) { writes.push(frame); return true; } };
const encoded = encodeWsBinary(Buffer.from('shared'));
assert.strictEqual(sendWsEncoded(socket, encoded), true);
assert.strictEqual(writes[0], encoded, 'pre-encoded frames must be written without another allocation');
assert.strictEqual(sendWsBinary(socket, Buffer.from('direct')), true);

console.log('WebSocket framing tests passed');
