'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { parseArgs } = require('../lib/config');
const { detectRuntimeMode } = require('../lib/runtime');
const { openSqliteDatabase } = require('../lib/sqlite-database');
const { createStorage } = require('../lib/storage');
const { migrateStorage } = require('../lib/storage-migration');
const { createUserHistory } = require('../lib/user-history');

const projectDir = path.resolve(__dirname, '..');

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

async function run() {
  testRuntimeDetection();
  testUserHistoryWindow();
  testStorageMigration();
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'udp-airband-admin-test-'));
  const publicPort = await reserveTcpPort();
  const adminPort = await reserveTcpPort();
  const configuredAdminPort = await reserveTcpPort();
  const initialUdpPort = await reserveUdpPort();
  const updatedUdpPort = await reserveUdpPort();
  const occupiedUdpPort = await reserveUdpPort();
  const configPath = path.join(temporaryDir, 'streams.json');
  const serverConfigPath = path.join(temporaryDir, 'server.conf');
  const dataDir = path.join(temporaryDir, 'data');
  fs.writeFileSync(serverConfigPath, [
    '[web]',
    'host = 127.0.0.1',
    `port = ${publicPort}`,
    '',
    '[admin]',
    'host = 127.0.0.1',
    `port = ${configuredAdminPort}`,
    'enabled = false',
    '',
    '[compressed]',
    'enabled = false',
    '',
  ].join('\n'));
  fs.writeFileSync(configPath, JSON.stringify({
    streams: [{
      name: 'test',
      label: 'Initial test',
      udpHost: '127.0.0.1',
      udpPort: initialUdpPort,
      sampleRate: 8000,
      channels: 1,
    }],
  }));

  const child = childProcess.spawn(process.execPath, [
    'server.js',
    '--server-config', serverConfigPath,
    '--config', configPath,
    '--data-dir', dataDir,
    '--http-host', '127.0.0.1',
    '--http-port', String(publicPort),
    '--webserver', String(adminPort),
    '--compressed-enabled', 'false',
  ], {
    cwd: projectDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  const occupiedSocket = dgram.createSocket('udp4');
  try {
    await waitFor(() => requestJson(adminPort, '/api/state'));
    await waitFor(() => output.includes('webadmin_config_override') && output.includes('priority=command-line'));
    assert.match(output, /webadmin_config_override source=--webserver/);
    assert.match(output, /overridden="admin\.enabled,admin\.port"/);

    const adminPage = await request(adminPort, '/');
    assert.strictEqual(adminPage.statusCode, 200);
    assert.match(adminPage.body, /Web Admin/);
    assert.match(adminPage.body, /last 12 hours/);
    assert.match(adminPage.body, /id="languageSelect"/);
    assert.match(adminPage.headers['content-security-policy'], /frame-ancestors 'none'/);

    const publicPage = await request(publicPort, '/');
    assert.strictEqual(publicPage.statusCode, 200);
    assert.match(publicPage.body, /Initial test/);

    const updated = {
      streams: [{
        name: 'test',
        label: 'Updated live',
        udpHost: '127.0.0.1',
        udpPort: updatedUdpPort,
        sampleRate: 8000,
        channels: 1,
      }],
    };
    const updateResponse = await requestJson(adminPort, '/api/streams', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-request': '1' },
      body: JSON.stringify(updated),
    });
    assert.strictEqual(updateResponse.ok, true);
    assert.strictEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')).streams[0].label, 'Updated live');

    await sendUdpFloat(updatedUdpPort);
    const activeState = await waitFor(async () => {
      const state = await requestJson(adminPort, '/api/state');
      return state.streams[0].hasUdp ? state : null;
    });
    assert.strictEqual(activeState.streams[0].udpPort, updatedUdpPort);
    assert.ok(['systemd', 'console', 'unknown'].includes(activeState.runtimeMode));

    fs.writeFileSync(configPath, JSON.stringify({
      streams: [{
        ...updated.streams[0],
        label: 'Reloaded from disk',
      }],
    }));
    const reloadResponse = await requestJson(adminPort, '/api/streams/reload', {
      method: 'POST',
      headers: { 'x-admin-request': '1' },
    });
    assert.match(reloadResponse.message, /reloaded from disk/);
    assert.strictEqual(reloadResponse.streams[0].label, 'Reloaded from disk');

    await bindUdp(occupiedSocket, occupiedUdpPort);
    const failedUpdate = await request(adminPort, '/api/streams', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-request': '1' },
      body: JSON.stringify({
        streams: [{
          ...updated.streams[0],
          udpPort: occupiedUdpPort,
        }],
      }),
    });
    assert.strictEqual(failedUpdate.statusCode, 409);

    await sendUdpFloat(updatedUdpPort);
    const rolledBackState = await requestJson(adminPort, '/api/state');
    assert.strictEqual(rolledBackState.streams[0].udpPort, updatedUdpPort);
    assert.strictEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')).streams[0].udpPort, updatedUdpPort);

    console.log('web admin integration test passed');
  } catch (err) {
    err.message = `${err.message}\nServer output:\n${output}`;
    throw err;
  } finally {
    occupiedSocket.close();
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }

  await testConfigEnabledStartup();
}

function testRuntimeDetection() {
  assert.deepStrictEqual(parseArgs(['--migrate', '-D']), { migrate: true, debug: true });
  const noTty = { stdin: {}, stdout: {}, stderr: {} };
  assert.strictEqual(detectRuntimeMode({ INVOCATION_ID: 'test-service' }, noTty), 'systemd');
  assert.strictEqual(detectRuntimeMode({ JOURNAL_STREAM: '8:1' }, noTty), 'systemd');
  assert.strictEqual(detectRuntimeMode({}, { stdin: {}, stdout: { isTTY: true }, stderr: {} }), 'console');
  assert.strictEqual(detectRuntimeMode({}, noTty), 'unknown');
}

function testUserHistoryWindow() {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'udp-airband-history-test-'));
  const filePath = path.join(temporaryDir, 'user-history.json');
  const now = Date.now();
  fs.writeFileSync(filePath, JSON.stringify([
    { at: now - 13 * 60 * 60 * 1000, count: 4 },
    { at: now - 11 * 60 * 60 * 1000, count: 2 },
  ]));
  const history = createUserHistory({ filePath, fs, path });
  const points = history.snapshot(now - 12 * 60 * 60 * 1000);
  assert.deepStrictEqual(points, [{ at: now - 11 * 60 * 60 * 1000, count: 2 }]);
  fs.rmSync(temporaryDir, { recursive: true, force: true });
}

function testStorageMigration() {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'udp-airband-storage-test-'));
  const sqliteFile = path.join(temporaryDir, 'runtime.sqlite');
  const historyPath = path.join(temporaryDir, 'user-history.json');
  const lastHeardPath = path.join(temporaryDir, 'last-heard.json');
  const now = Date.now();
  const logger = {
    info: () => {},
    warn: () => {},
  };

  try {
    fs.writeFileSync(historyPath, JSON.stringify([
      { at: now - 2000, count: 2 },
      { at: now - 1000, count: 3 },
    ]));
    fs.writeFileSync(lastHeardPath, JSON.stringify({
      alpha: now - 5000,
    }));

    migrateStorage({
      dataDir: temporaryDir,
      fs,
      logger,
      path,
      sqliteFile,
      target: 'sqlite',
    });

    let database = openSqliteDatabase({ filePath: sqliteFile, fs, path });
    assert.strictEqual(database.db.prepare('SELECT COUNT(*) AS count FROM user_history').get().count, 2);
    assert.strictEqual(
      database.db.prepare('SELECT last_heard_at FROM last_heard WHERE stream_name = ?').get('alpha').last_heard_at,
      now - 5000,
    );
    database.db.prepare('INSERT INTO user_history (at, count) VALUES (?, ?)').run(now, 4);
    database.db.prepare('INSERT INTO last_heard (stream_name, last_heard_at) VALUES (?, ?)').run('beta', now - 3000);
    database.close();

    fs.writeFileSync(historyPath, JSON.stringify([
      { at: now - 2000, count: 5 },
    ]));
    fs.writeFileSync(lastHeardPath, JSON.stringify({
      alpha: now - 6000,
      gamma: now - 1000,
    }));
    migrateStorage({
      dataDir: temporaryDir,
      fs,
      logger,
      path,
      sqliteFile,
      target: 'json',
    });

    assert.deepStrictEqual(JSON.parse(fs.readFileSync(historyPath, 'utf8')), [
      { at: now - 2000, count: 5 },
      { at: now - 1000, count: 3 },
      { at: now, count: 4 },
    ]);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(lastHeardPath, 'utf8')), {
      alpha: now - 5000,
      gamma: now - 1000,
      beta: now - 3000,
    });

    const storage = createStorage({
      backend: 'sqlite',
      dataDir: temporaryDir,
      fs,
      logger,
      path,
      sqliteFile,
    });
    const history = storage.createUserHistory();
    const lastHeard = storage.createLastHeardStore();
    const streams = [{ name: 'alpha', lastUdpAt: 0 }];
    lastHeard.apply(streams);
    assert.strictEqual(streams[0].lastUdpAt, now - 5000);
    lastHeard.record('alpha', now);
    assert.strictEqual(lastHeard.flush(), true);
    history.record(7, now + 1000);
    const recentHistory = history.snapshot(now);
    assert.strictEqual(recentHistory[recentHistory.length - 1].count, 7);
    storage.close();

    database = openSqliteDatabase({ filePath: sqliteFile, fs, path });
    assert.strictEqual(
      database.db.prepare('SELECT last_heard_at FROM last_heard WHERE stream_name = ?').get('alpha').last_heard_at,
      now,
    );
    database.close();
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

async function testConfigEnabledStartup() {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'udp-airband-admin-config-test-'));
  const publicPort = await reserveTcpPort();
  const adminPort = await reserveTcpPort();
  const udpPort = await reserveUdpPort();
  const configPath = path.join(temporaryDir, 'streams.json');
  const serverConfigPath = path.join(temporaryDir, 'server.conf');
  const dataDir = path.join(temporaryDir, 'data');
  fs.writeFileSync(configPath, JSON.stringify({
    streams: [{
      name: 'config-test',
      label: 'Config enabled',
      udpHost: '127.0.0.1',
      udpPort,
      sampleRate: 8000,
      channels: 1,
    }],
  }));
  fs.writeFileSync(serverConfigPath, [
    '[web]',
    'host = 127.0.0.1',
    `port = ${publicPort}`,
    '',
    '[admin]',
    'host = 127.0.0.1',
    `port = ${adminPort}`,
    'enabled = true',
    '',
    '[compressed]',
    'enabled = false',
    '',
    '[storage]',
    'backend = sqlite',
    'sqlite_file = runtime.sqlite',
    '',
  ].join('\n'));

  const child = childProcess.spawn(process.execPath, [
    'server.js',
    '--server-config', serverConfigPath,
    '--config', configPath,
    '--data-dir', dataDir,
  ], {
    cwd: projectDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  try {
    const state = await waitFor(() => requestJson(adminPort, '/api/state'));
    assert.strictEqual(state.streams[0].name, 'config-test');
    await waitFor(() => output.includes('webAdminEnabled=true') && output.includes('storageBackend=sqlite'));
    assert.doesNotMatch(output, /webadmin_config_override/);
  } catch (err) {
    err.message = `${err.message}\nConfig startup server output:\n${output}`;
    throw err;
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    assert.strictEqual(fs.existsSync(path.join(dataDir, 'runtime.sqlite')), true);
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        body: Buffer.concat(chunks).toString('utf8'),
        headers: res.headers,
        statusCode: res.statusCode,
      }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function requestJson(port, pathname, options) {
  const response = await request(port, pathname, options);
  const value = JSON.parse(response.body);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const err = new Error(value.error || `HTTP ${response.statusCode}`);
    err.statusCode = response.statusCode;
    throw err;
  }
  return value;
}

async function waitFor(callback, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error('Timed out waiting for condition.');
}

function reserveTcpPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function reserveUdpPort() {
  const socket = dgram.createSocket('udp4');
  await bindUdp(socket, 0);
  const port = socket.address().port;
  socket.close();
  return port;
}

function bindUdp(socket, port) {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(port, '127.0.0.1', () => {
      socket.removeListener('error', reject);
      resolve();
    });
  });
}

function sendUdpFloat(port) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const packet = Buffer.alloc(4);
    packet.writeFloatLE(0.25, 0);
    socket.send(packet, port, '127.0.0.1', (err) => {
      socket.close();
      if (err) reject(err);
      else setTimeout(resolve, 30);
    });
  });
}
