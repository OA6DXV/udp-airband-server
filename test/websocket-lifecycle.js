'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { attachWebSocketLifecycle } = require('../lib/websocket');
const { createUserHistory } = require('../lib/user-history');
const { createStorage } = require('../lib/storage');
const { isInternalAudioRelay } = require('../lib/clients');

// Local test bridges do not represent listeners. Public/proxied connections
// cannot hide from the count by copying a bridge ID or query parameter.
{
  const local = { remoteAddress: '127.0.0.1' };
  const url = new URL('ws://localhost/test/audio');
  assert(isInternalAudioRelay({ headers: {} }, local, 'opus-mirror-test', url));
  assert(!isInternalAudioRelay({ headers: {} }, local, 'browser-client', url));
  url.searchParams.set('internal', '1');
  assert(isInternalAudioRelay({ headers: {} }, local, 'local-relay', url));
  assert(!isInternalAudioRelay({ headers: {} }, { remoteAddress: '192.0.2.10' }, 'opus-mirror-test', url));
  for (const header of ['forwarded', 'x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'x-forwarded-host', 'x-forwarded-proto']) {
    assert(!isInternalAudioRelay({ headers: { [header]: '127.0.0.1' } }, local, 'opus-mirror-test', url));
  }
}

function clientFrame(opcode, payload = Buffer.alloc(0)) {
  const mask = Buffer.from([17, 34, 51, 68]);
  const header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function fixture(head) {
  const socket = new EventEmitter();
  socket.destroyed = false;
  socket.writes = [];
  socket.write = frame => { socket.writes.push(frame); return true; };
  socket.end = () => { socket.ended = true; socket.emit('end'); };
  socket.destroy = () => {
    if (socket.destroyed) return;
    socket.destroyed = true;
    socket.emit('close');
  };
  let at = 0, disconnected = 0, tick, stopped = false;
  attachWebSocketLifecycle(socket, {
    head,
    now: () => at,
    onDisconnect: () => { disconnected += 1; },
    setIntervalFn: fn => { tick = fn; return 1; },
    clearIntervalFn: () => { stopped = true; },
    setTimeoutFn: () => 2,
    clearTimeoutFn: () => {},
  });
  return {
    socket,
    tick(time) { at = time; tick(); },
    disconnectCount: () => disconnected,
    stopped: () => stopped,
  };
}

// A fragmented close arriving in the HTTP upgrade head must be acknowledged,
// and end/error/close events must release the client exactly once.
{
  const closePayload = Buffer.from([3, 232]); // normal close (1000)
  const frame = clientFrame(8, closePayload);
  const f = fixture(frame.subarray(0, 3));
  f.socket.emit('data', frame.subarray(3));
  assert.strictEqual(f.disconnectCount(), 1);
  assert(f.socket.ended && f.stopped());
  assert.deepStrictEqual(f.socket.writes[0], Buffer.concat([Buffer.from([0x88, 2]), closePayload]));
  f.socket.emit('error', new Error('connection reset'));
  f.socket.emit('close');
  assert.strictEqual(f.disconnectCount(), 1);
}

// Coalesced application frames and client pings are consumed without losing
// frame boundaries; client pings get an identical pong payload.
{
  const f = fixture();
  const payload = Buffer.from('alive');
  f.socket.emit('data', Buffer.concat([clientFrame(1, Buffer.from('ignored')), clientFrame(9, payload)]));
  assert.deepStrictEqual(f.socket.writes[0], Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
  assert.strictEqual(f.disconnectCount(), 0);
  f.socket.destroy();
}

// A browser's matching pong keeps a silent/background connection alive.
// Missing or unrelated pongs cannot keep abandoned sockets counted forever.
for (const acknowledge of [true, false]) {
  const f = fixture();
  f.tick(15000);
  const ping = f.socket.writes.at(-1);
  assert.strictEqual(ping[0], 0x89);
  const pong = clientFrame(10, acknowledge ? ping.subarray(2) : Buffer.from('wrong'));
  f.socket.emit('data', pong.subarray(0, 5));
  f.socket.emit('data', pong.subarray(5));
  f.tick(45000);
  assert(!f.socket.destroyed);
  if (acknowledge) {
    const nextPing = f.socket.writes.at(-1);
    f.socket.emit('data', clientFrame(10, nextPing.subarray(2)));
  }
  f.tick(60000);
  assert.strictEqual(f.socket.destroyed, !acknowledge);
  assert.strictEqual(f.disconnectCount(), acknowledge ? 0 : 1);
  f.socket.destroy();
}

for (const invalid of [Buffer.from([0x88, 0]), clientFrame(8, Buffer.from([1]))]) {
  const f = fixture();
  f.socket.emit('data', invalid);
  assert(f.socket.destroyed);
  assert.strictEqual(f.disconnectCount(), 1);
}

// Continuous activity must keep one point in EVERY minute, rather than
// indefinitely replacing the latest point whenever events are <60 s apart.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'udp-airband-lifecycle-'));
const logger = { info() {}, warn(event) { throw new Error(event); } };
const storage = createStorage({ fs, path, logger, sqliteFile: path.join(directory, 'history.sqlite') });
try {
  const histories = [
    storage.createUserHistory(),
    createUserHistory({ fs, path, logger, filePath: path.join(directory, 'history.json') }),
  ];
  const start = Math.floor(Date.now() / 60000) * 60000 - 180000;
  for (const history of histories) {
    for (let i = 0; i <= 18; i += 1) history.record(i === 18 ? 0 : i % 5 + 1, start + i * 10000);
    const points = history.snapshot(start);
    assert.strictEqual(points.length, 4, 'busy clients must not erase earlier minute samples');
    assert.strictEqual(points.at(-1).count, 0, 'disconnect must persist zero');
    assert.strictEqual(new Set(points.map(point => Math.floor(point.at / 60000))).size, 4);
    history.flush();
  }
} finally {
  storage.close();
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log('WebSocket close, heartbeat, idempotent cleanup and history regression tests passed');
