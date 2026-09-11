'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const { attachWsControlFrames, encodeWsBinary, sendWsBinary, sendWsEncoded } = require('../lib/websocket');

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

const controlSocket = createSocket();
attachWsControlFrames(controlSocket, maskedFrame(0x9, Buffer.from('ping')));
assert.strictEqual(controlSocket.writes.length, 1);
assert.strictEqual(controlSocket.writes[0][0], 0x8a, 'client ping must receive a pong');
assert.strictEqual(controlSocket.writes[0].subarray(2).toString(), 'ping');
controlSocket.emit('data', maskedFrame(0x8, Buffer.from([0x03, 0xe8])));
assert.strictEqual(controlSocket.ended, true, 'client close must receive a close response');
assert.strictEqual(controlSocket.endFrame[0], 0x88);

const invalidSocket = createSocket();
attachWsControlFrames(invalidSocket);
invalidSocket.emit('data', Buffer.from([0x89, 0x00]));
assert.strictEqual(invalidSocket.destroyed, true, 'unmasked client frames must be rejected');

console.log('WebSocket framing tests passed');

function createSocket() {
  const target = new EventEmitter();
  target.destroyed = false;
  target.ended = false;
  target.writes = [];
  target.write = (frame) => { target.writes.push(frame); return true; };
  target.end = (frame) => { target.ended = true; target.endFrame = frame; };
  target.destroy = () => { target.destroyed = true; };
  return target;
}

function maskedFrame(opcode, payload) {
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const frame = Buffer.alloc(2 + 4 + payload.length);
  frame[0] = 0x80 | opcode;
  frame[1] = 0x80 | payload.length;
  mask.copy(frame, 2);
  for (let index = 0; index < payload.length; index += 1) {
    frame[6 + index] = payload[index] ^ mask[index % 4];
  }
  return frame;
}
