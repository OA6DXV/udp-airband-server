'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { DEFAULT_SERVER_CONFIG_TEMPLATE } = require('../lib/config');

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
  const config = DEFAULT_SERVER_CONFIG_TEMPLATE
    .replace('port = 8585', `port = ${httpPort}`)
    .replace(/(\[admin\][\s\S]*?enabled = )true/, '$1false')
    .replace(/(\[geo\][\s\S]*?enabled = )true/, '$1false')
    .replace('ffmpeg = ffmpeg', 'ffmpeg = /nonexistent/ffmpeg');
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
  let socket;
  let udp;
  try {
    await waitForHttp(httpPort, child);
    for (const endpoint of ['/multi/native.aac?streams=test', '/multi/native-gain?stream=test&gain=0.5']) {
      const response = await fetch(`http://127.0.0.1:${httpPort}${endpoint}`);
      assert.strictEqual(response.status, 404, 'Legacy multistream AAC and gain routes must be removed');
      await response.text();
    }
    const frames = [];
    socket = new WebSocket(`ws://127.0.0.1:${httpPort}/test/opus-live?clientId=integration`);
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', (event) => frames.push(Buffer.from(event.data)));
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    udp = dgram.createSocket('udp4');
    const pcm = Buffer.alloc(8000 / 50 * 4);
    for (let sample = 0; sample < 8000 / 50; sample += 1) {
      pcm.writeFloatLE(Math.sin(sample * Math.PI * 2 * 440 / 8000) * 0.5, sample * 4);
    }
    await new Promise((resolve, reject) => udp.send(pcm, udpPort, '127.0.0.1', (error) => error ? reject(error) : resolve()));
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !frames.some((frame) => frame.subarray(0, 4).toString() === 'OPU1' && frame.length > 18)) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert(frames.some((frame) => frame.subarray(0, 4).toString() === 'OPC1'), 'Opus config frame was not delivered');
    assert(frames.some((frame) => frame.subarray(0, 4).toString() === 'OPU1' && frame.length > 18), 'UDP input was not encoded to Opus');
    assert(output.includes('1.9-preview'), 'Server did not report the preview version');
    assert(!output.includes('ffmpeg_start'), 'Opus playback must not spawn FFmpeg');
    console.log('Realtime Opus server integration test passed');
  } catch (error) {
    error.message += `\nServer output: ${output.slice(-2500)}`;
    throw error;
  } finally {
    if (socket) socket.close();
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
