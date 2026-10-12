'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { DEFAULT_SERVER_CONFIG_TEMPLATE, ensureServerConfigFromTemplateWithTemp } = require('../lib/config');

async function freeTcpPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function freeUdpPort() {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  socket.close();
  return port;
}

async function waitForHttp(port, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}`);
    try {
      const status = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/`, (response) => {
          response.resume();
          resolve(response.statusCode);
        }).on('error', reject);
      });
      if (status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Server did not start in time');
}

async function main() {
  assert.strictEqual(typeof WebSocket, 'function', 'Node.js with built-in WebSocket support is required');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'udp-airband-opus-test-'));
  const httpPort = await freeTcpPort();
  const udpPort = await freeUdpPort();
  const configPath = path.join(directory, 'server.conf');
  const streamsPath = path.join(directory, 'streams.json');
  const generatedPath = path.join(directory, 'generated.conf');
  const generated = ensureServerConfigFromTemplateWithTemp(generatedPath, path.join(directory, 'generated.tmp'), fs, path);
  assert(generated.created);
  const generatedText = fs.readFileSync(generatedPath, 'utf8');
  assert(!generatedText.includes('[audio]') && !generatedText.includes('[compressed]'), 'startup must not generate audio configuration');
  const config = DEFAULT_SERVER_CONFIG_TEMPLATE
    .replace('port = 8585', `port = ${httpPort}`)
    .replace(/(\[admin\][\s\S]*?enabled = )true/, '$1false')
    .replace(/(\[geo\][\s\S]*?enabled = )true/, '$1false')
    + '\n[compressed]\nenabled = false\ncodec = aac\nffmpeg = /nonexistent/ffmpeg\nopus_realtime_bitrate_8k = 6k\nadpcm_frame_ms = 100\n[audio]\nopus_worklet_target_latency_ms = 500\n';
  fs.writeFileSync(configPath, config);
  fs.writeFileSync(streamsPath, JSON.stringify({ streams: [{ name: 'test', label: 'Test', udpHost: '127.0.0.1', udpPort, sampleRate: 8000, channels: 1 }] }));
  const child = spawn(process.execPath, [
    path.join(__dirname, '..', 'server.js'),
    '--server-config', configPath,
    '--config', streamsPath,
    '--data-dir', path.join(directory, 'data'),
    '--http-host', '127.0.0.1',
  ], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const sockets = [];
  async function connect(endpoint, frames, clientId = `${endpoint}-${sockets.length}`) {
    const socket = new WebSocket(`ws://127.0.0.1:${httpPort}/test/${endpoint}?clientId=${clientId}`);
    sockets.push(socket);
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', (event) => frames.push(typeof event.data === 'string' ? JSON.parse(event.data) : Buffer.from(event.data)));
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return socket;
  }
  let udp;
  try {
    await waitForHttp(httpPort, child);
    assert.strictEqual(fs.readFileSync(configPath, 'utf8'), config, 'existing codec settings must not be modified');
    for (const endpoint of ['/multi/native.aac?streams=test', '/multi/native-gain?stream=test&gain=0.5', '/test/hls/integration/playlist.m3u8', '/test/opus']) {
      const response = await fetch(`http://127.0.0.1:${httpPort}${endpoint}`);
      assert.strictEqual(response.status, 404, 'Legacy audio routes must be removed');
      await response.text();
    }
    const rejected = new WebSocket(`ws://127.0.0.1:${httpPort}/test/aac`);
    sockets.push(rejected);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('AAC route did not reject the connection')), 2000);
      rejected.addEventListener('open', () => { clearTimeout(timeout); reject(new Error('AAC route is still available')); }, { once: true });
      rejected.addEventListener('error', () => { clearTimeout(timeout); resolve(); }, { once: true });
    });
    const frames = [], raw = [], normal = [], secondNormal = [], configs = [], mirrorFrames = [];
    const mirror = await connect('audio', mirrorFrames, 'opus-mirror-test');
    await connect('control', configs);
    await Promise.all([connect('opus-live', frames), connect('audio', raw), connect('adpcm', normal), connect('adpcm', secondNormal)]);
    const configMessage = configs.find(message => message.type === 'config');
    assert(configMessage, 'control must announce the fixed profiles');
    assert.strictEqual(configMessage.adpcmAvailable, true, 'old enabled=false must not disable Normal');
    assert.strictEqual(configMessage.opusRealtimeAvailable, true, 'old codec=aac must not disable Opus');
    assert.strictEqual(configMessage.adpcmFrameMs, 40);
    assert.strictEqual(configMessage.opusRealtimeBitrate, '20k');
    assert.strictEqual(configMessage.opusRealtimeFrameMs, 20);
    assert.strictEqual(configMessage.opusWorkletTargetLatencyMs, 100);
    for (const field of ['compressedCodec', 'compressedEnabled', 'aacAvailable', 'hlsAvailable']) {
      assert(!(field in configMessage), 'obsolete capability fields must be removed: ' + field);
    }
    udp = dgram.createSocket('udp4');
    const pcm = Buffer.alloc(320 * 4);
    for (let sample = 0; sample < 320; sample += 1) {
      pcm.writeFloatLE(Math.sin(sample * Math.PI * 2 * 440 / 8000) * 0.5, sample * 4);
    }
    await new Promise((resolve, reject) => udp.send(pcm, udpPort, '127.0.0.1', (error) => error ? reject(error) : resolve()));
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && (!mirrorFrames.length || !raw.length || !normal.length || !secondNormal.length || !frames.some((frame) => frame.subarray(0, 4).toString() === 'OPU1' && frame.length > 18))) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert(frames.some((frame) => frame.subarray(0, 4).toString() === 'OPC1'), 'Opus config frame was not delivered');
    assert(frames.some((frame) => frame.subarray(0, 4).toString() === 'OPU1' && frame.length > 18), 'UDP input was not encoded to Opus');
    assert.deepStrictEqual(raw[0], pcm, 'RAW must deliver the original UDP payload');
    assert.deepStrictEqual(mirrorFrames[0], pcm, 'internal mirrors must still receive unchanged real stream audio');
    assert(!/client_connected client=opus-mirror-test/.test(output), 'internal mirrors must not inflate the global user count');
    assert.strictEqual(Math.max(...Array.from(output.matchAll(/activeClients=(\d+)/g), match => Number(match[1]))), 5, 'only the five real browser clients must be counted');
    assert.deepStrictEqual(normal[0], secondNormal[0], 'Normal listeners must receive identical shared frames');
    const { decodeAdpcmFrame } = await import('../assets/adpcm-decoder.mjs');
    const decoded = decodeAdpcmFrame(Uint8Array.from(normal[0]).buffer);
    assert(decoded && decoded.frames === 320, 'Normal must preserve the full input frame count');
    assert(decoded.samples.some(value => Math.abs(value) > .1), 'Normal must contain decoded audio');
    assert(output.includes('2.0-preview'), 'Server did not report the preview version');
    assert(!output.includes('ffmpeg_start'), 'Opus playback must not spawn FFmpeg');
    for (const socket of sockets) if (socket !== mirror && socket.readyState === WebSocket.OPEN) socket.close();
    const closeDeadline = Date.now() + 5000;
    while (Date.now() < closeDeadline && !/client_disconnected[^\n]*activeClients=0/.test(output)) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert(/client_disconnected[^\n]*activeClients=0/.test(output), 'all browser close handshakes must release the global user count');
    assert(sockets.filter(socket => socket !== mirror).every(socket => socket.readyState === WebSocket.CLOSED), 'browser close must complete without waiting for a TCP timeout');
    assert.strictEqual(mirror.readyState, WebSocket.OPEN, 'an internal relay may remain connected while user count is zero');
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(path.join(directory, 'data', 'localdb.sqlite'), { readOnly: true });
    try {
      assert.strictEqual(database.prepare('SELECT count FROM user_history ORDER BY at DESC LIMIT 1').get().count, 0, 'history must return to zero after the last listener leaves');
    } finally {
      database.close();
    }
    console.log('Fixed RAW, Normal and low data server integration tests passed');
  } catch (error) {
    error.message += `\nServer output: ${output.slice(-2500)}`;
    throw error;
  } finally {
    for (const socket of sockets) socket.close();
    if (udp) udp.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
