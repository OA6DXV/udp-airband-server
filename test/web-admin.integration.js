'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { DEFAULT_SERVER_CONFIG_TEMPLATE, ensureServerConfigFromTemplateWithTemp, loadServerConfig, parseArgs, setServerConfigSetting } = require('../lib/config');
const { upsertAdministrator } = require('../lib/admin-auth');
const { createPasswordHasher } = require('../lib/admin-password');
const { createGeoService } = require('../lib/geo-service');
const { aggregateGeoStats } = require('../lib/geo-stats');
const { classifyAddress } = require('../lib/ip-privacy');
const { detectRuntimeMode } = require('../lib/runtime');
const { openSqliteDatabase } = require('../lib/sqlite-database');
const { createStorage } = require('../lib/storage');
const { findLegacyJsonFiles, migrateStorage } = require('../lib/storage-migration');
const { createUserHistory } = require('../lib/user-history');

const projectDir = path.resolve(__dirname, '..');
const TEST_AUTH_ENV = {
  ADMIN_AUTH_SECRET: 'integration-auth-secret-that-is-at-least-thirty-two-bytes',
  ADMIN_ALTCHA_SECRET: 'integration-altcha-secret-that-is-at-least-thirty-two-bytes',
  ADMIN_TRUSTED_PROXIES: '127.0.0.1,::1',
};
const adminSessions = new Map();

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

async function run() {
  testRuntimeDetection();
  testServerConfigSettingUpdate();
  testServerConfigTemplateUpdate();
  testUserHistoryWindow();
  testGeoStatsAggregation();
  testStorageMigration();
  await testGeoPrivacyAndCache();
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
  fs.mkdirSync(dataDir, { recursive: true });
  const runtimeDatabasePath = path.join(dataDir, 'localdb.sqlite');
  await createTestAdministrator(runtimeDatabasePath);
  seedGeoRecords(runtimeDatabasePath, [
    geoRecord('203.0.113.0', 'PE', 'Peru', 'Cusco'),
    geoRecord('203.0.114.0', 'PE', 'Peru', 'Cusco'),
    geoRecord('203.0.115.0', 'PE', 'Peru', 'Lima'),
    geoRecord('198.51.100.0', 'US', 'United States', 'Miami'),
    geoRecord('127.0.0.1', '', 'Local IP', 'Local IP', 'local'),
  ]);
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
  ensureServerConfigFromTemplateWithTemp(serverConfigPath, path.join(temporaryDir, 'server.conf.tmp'), fs, path);
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
    env: { ...process.env, ...TEST_AUTH_ENV },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  const occupiedSocket = dgram.createSocket('udp4');
  try {
    const loginPage = await waitFor(() => request(adminPort, '/'));
    assert.match(loginPage.body, /id="loginForm"/);
    assert.match(loginPage.body, /<form[^>]+novalidate/);
    assert.strictEqual((await request(adminPort, '/api/state')).statusCode, 401);
    const altchaWorker = await request(adminPort, '/altcha-pbkdf2.js');
    assert.strictEqual(altchaWorker.statusCode, 200);
    assert.match(altchaWorker.body, /onmessage/);
    await loginTestAdmin(adminPort, true);
    await waitFor(() => requestJson(adminPort, '/api/state'));
    await waitFor(() => output.includes('webadmin_config_override') && output.includes('priority=command-line'));
    assert.doesNotMatch(output, /Legacy JSON runtime data was detected/);
    assert.match(output, /webadmin_config_override source=--webserver/);
    assert.match(output, /overridden="admin\.enabled,admin\.port"/);

    const adminPage = await request(adminPort, '/');
    assert.strictEqual(adminPage.statusCode, 200);
    assert.match(adminPage.body, /Web Admin/);
    assert.match(adminPage.body, /last 12 hours/);
    assert.match(adminPage.body, /id="languageSelect"/);
    assert.match(adminPage.body, /id="revertStreams"/);
    assert.match(adminPage.headers['content-security-policy'], /frame-ancestors 'none'/);

    const usersPage = await request(adminPort, '/users');
    assert.strictEqual(usersPage.statusCode, 200);
    assert.match(usersPage.body, /Web Admin/);
    assert.match(usersPage.body, /id="geoChart"/);
    assert.match(usersPage.body, /\/users\.js/);
    assert.match(usersPage.headers['content-security-policy'], /https:\/\/www\.gstatic\.com/);

    const geoResponse = await request(adminPort, '/api/users/geo');
    assert.strictEqual(geoResponse.statusCode, 200);
    assert.doesNotMatch(geoResponse.body, /203\.0\.113\.0|127\.0\.0\.1/);
    const geoPayload = JSON.parse(geoResponse.body);
    assert.strictEqual(geoPayload.totalListeners, 4);
    assert.deepStrictEqual(geoPayload.countries[0], {
      code: 'PE',
      country: 'Peru',
      listeners: 3,
      topCities: [
        { city: 'Cusco', listeners: 2 },
        { city: 'Lima', listeners: 1 },
      ],
    });

    const publicPage = await request(publicPort, '/');
    assert.strictEqual(publicPage.statusCode, 200);
    assert.match(publicPage.body, /Initial test/);
    assert.match(publicPage.headers['content-security-policy'], /worker-src 'self'/);

    const audioWorklet = await request(publicPort, '/assets/audio-worklet.js');
    assert.strictEqual(audioWorklet.statusCode, 200);
    assert.match(audioWorklet.headers['content-type'], /application\/javascript/);
    assert.match(audioWorklet.body, /registerProcessor\('airband-pcm'/);
    const audioRingBuffer = await request(publicPort, '/assets/audio-ring-buffer.mjs');
    assert.strictEqual(audioRingBuffer.statusCode, 200);
    assert.match(audioRingBuffer.body, /class MonoPcmRingBuffer/);

    const activePlayer = await openControlWebSocket(publicPort, '/test/control?clientId=integration-player');
    const hubMonitor = await openControlWebSocket(publicPort, '/test/control?monitor=1&clientId=integration-hub');
    const playerConfig = await activePlayer.waitForMessage('config');
    assert.strictEqual(playerConfig.audioWorkletStreaming, true);
    assert.strictEqual(playerConfig.adpcmFrameMs, 20);
    assert.strictEqual(playerConfig.adpcmPacing, true);
    await hubMonitor.waitForMessage('config');

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
    const csrfRejected = await request(adminPort, '/api/streams/reload', {
      method: 'POST',
      skipCsrf: true,
    });
    assert.strictEqual(csrfRejected.statusCode, 403);

    const updateResponse = await requestJson(adminPort, '/api/streams', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-request': '1' },
      body: JSON.stringify(updated),
    });
    assert.strictEqual(updateResponse.ok, true);
    assert.strictEqual(updateResponse.audit.changeCount, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')).streams[0].label, 'Updated live');
    const unavailableMessage = await activePlayer.waitForMessage('streamUnavailable');
    assert.strictEqual(unavailableMessage.reason, 'configuration_changed');
    assert.strictEqual(unavailableMessage.redirectTo, '/');
    const catalogMessage = await hubMonitor.waitForMessage('streamCatalogChanged');
    assert.strictEqual(catalogMessage.streams[0].label, 'Updated live');

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
    const updatedPlayer = await openControlWebSocket(publicPort, '/test/control?clientId=integration-updated-player');
    await updatedPlayer.waitForMessage('config');
    const reloadResponse = await requestJson(adminPort, '/api/streams/reload', {
      method: 'POST',
      headers: { 'x-admin-request': '1' },
    });
    assert.match(reloadResponse.message, /reloaded from disk/);
    assert.strictEqual(reloadResponse.streams[0].label, 'Reloaded from disk');
    const liveUpdateMessage = await updatedPlayer.waitForMessage('streamUpdated');
    assert.strictEqual(liveUpdateMessage.stream.label, 'Reloaded from disk');
    assert.strictEqual(updatedPlayer.socket.destroyed, false);
    updatedPlayer.close();

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

function testServerConfigSettingUpdate() {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'udp-airband-config-test-'));
  const filePath = path.join(temporaryDir, 'server.conf');
  try {
    fs.writeFileSync(filePath, [
      '[web]',
      'port = 8585',
      '',
      '[storage]',
      '# keep this comment',
      'sqlite_file = localdb.sqlite',
      '',
    ].join('\n'));
    setServerConfigSetting(filePath, 'storage', 'sqlite_file', 'runtime.sqlite', fs, path);
    const config = loadServerConfig(filePath, fs, path);
    assert.strictEqual(config['storage.sqliteFile'], 'runtime.sqlite');
    assert.match(fs.readFileSync(filePath, 'utf8'), /# keep this comment/);
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function testServerConfigTemplateUpdate() {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'udp-airband-config-template-test-'));
  const configPath = path.join(temporaryDir, 'server.conf');
  const temporaryPath = path.join(temporaryDir, 'server.conf.tmp');
  const template = [
    '[web]',
    'host = 0.0.0.0',
    'port = 8585',
    '',
    '[admin]',
    '# Keep admin on loopback.',
    'host = 127.0.0.1',
    'port = 8584',
    'enabled = true',
    '',
  ].join('\n');
  try {
    let result = ensureServerConfigFromTemplateWithTemp(configPath, temporaryPath, fs, path, template);
    assert.strictEqual(result.created, true);
    assert.strictEqual(fs.existsSync(temporaryPath), false);
    assert.strictEqual(loadServerConfig(configPath, fs, path)['admin.port'], '8584');

    fs.writeFileSync(configPath, [
      '[web]',
      'port = 9000',
      '',
      '[admin]',
      'enabled = false',
      '',
    ].join('\n'));
    result = ensureServerConfigFromTemplateWithTemp(configPath, temporaryPath, fs, path, template);
    const config = loadServerConfig(configPath, fs, path);
    assert.strictEqual(result.updated, true);
    assert.deepStrictEqual(result.added, ['web.host', 'admin.host', 'admin.port']);
    assert.strictEqual(config['web.port'], '9000');
    assert.strictEqual(config['admin.enabled'], 'false');
    assert.strictEqual(config['admin.host'], '127.0.0.1');
    assert.strictEqual(config['admin.port'], '8584');
    assert.match(fs.readFileSync(configPath, 'utf8'), /# Keep admin on loopback./);
    assert.strictEqual((fs.readFileSync(configPath, 'utf8').match(/^\[admin\]$/gm) || []).length, 1);
    assert.strictEqual(fs.existsSync(temporaryPath), false);
    assert.match(DEFAULT_SERVER_CONFIG_TEMPLATE, /\[storage\]/);
    assert.match(DEFAULT_SERVER_CONFIG_TEMPLATE, /\[audio\][\s\S]*worklet_streaming = true/);
    assert.match(DEFAULT_SERVER_CONFIG_TEMPLATE, /adpcm_frame_ms = 20/);
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function testRuntimeDetection() {
  assert.deepStrictEqual(parseArgs(['--migrate', '-D']), { migrate: true, debug: true });
  assert.deepStrictEqual(parseArgs(['--audio-worklet-streaming', 'false']), { audioWorkletStreaming: 'false' });
  assert.deepStrictEqual(parseArgs(['--adpcm-pacing', 'false']), { adpcmPacing: 'false' });
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

function testGeoStatsAggregation() {
  const result = aggregateGeoStats([
    geoRecord('203.0.113.0', 'PE', 'Peru', 'Lima'),
    geoRecord('203.0.114.0', 'PE', 'Peru', 'Cusco'),
    geoRecord('203.0.115.0', 'PE', 'Peru', 'Cusco'),
    geoRecord('203.0.116.0', 'PE', 'Peru', 'Arequipa'),
    geoRecord('203.0.117.0', 'PE', 'Peru', 'Tacna'),
    geoRecord('127.0.0.1', '', 'Local IP', 'Local IP', 'local'),
  ]);
  assert.strictEqual(result.totalListeners, 5);
  assert.deepStrictEqual(result.countries[0].topCities, [
    { city: 'Cusco', listeners: 2 },
    { city: 'Arequipa', listeners: 1 },
    { city: 'Lima', listeners: 1 },
  ]);
}

function geoRecord(anonymizedIp, countryCode, country, city, source = 'ipwhois') {
  return {
    anonymizedIp,
    countryCode,
    country,
    city,
    lookedUpAt: Date.now(),
    source,
  };
}

function seedGeoRecords(sqliteFile, records) {
  const database = openSqliteDatabase({ filePath: sqliteFile, fs, path });
  const insert = database.db.prepare(`
    INSERT INTO geo_cache (anonymized_ip, country_code, country, city, looked_up_at, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  database.transaction(() => {
    for (const record of records) {
      insert.run(
        record.anonymizedIp,
        record.countryCode,
        record.country,
        record.city,
        record.lookedUpAt,
        record.source,
      );
    }
  });
  database.close();
}

function testStorageMigration() {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'udp-airband-storage-test-'));
  const sqliteFile = path.join(temporaryDir, 'runtime.sqlite');
  const historyPath = path.join(temporaryDir, 'user-history.json');
  const lastHeardPath = path.join(temporaryDir, 'last-heard.json');
  const geoCachePath = path.join(temporaryDir, 'geo-cache.json');
  const now = Date.now();
  const logger = { info: () => {}, warn: () => {} };

  try {
    fs.writeFileSync(historyPath, JSON.stringify([
      { at: now - 2000, count: 2 },
      { at: now - 1000, count: 3 },
    ]));
    fs.writeFileSync(lastHeardPath, JSON.stringify({ alpha: now - 5000 }));
    fs.writeFileSync(geoCachePath, JSON.stringify({
      '203.0.114.0': geoRecord('203.0.114.0', 'PE', 'Peru', 'Cusco'),
    }));

    const result = migrateStorage({ dataDir: temporaryDir, fs, logger, path, sqliteFile });
    assert.strictEqual(result.userHistory, 2);
    assert.strictEqual(result.lastHeard, 1);
    assert.strictEqual(result.geoCache, 1);
    assert.deepStrictEqual(findLegacyJsonFiles({ dataDir: temporaryDir, fs, path }), []);
    assert.strictEqual(fs.existsSync(path.join(result.backupDir, 'user-history.json')), true);
    assert.strictEqual(fs.existsSync(path.join(result.backupDir, 'last-heard.json')), true);
    assert.strictEqual(fs.existsSync(path.join(result.backupDir, 'geo-cache.json')), true);

    let database = openSqliteDatabase({ filePath: sqliteFile, fs, path });
    assert.strictEqual(database.db.prepare('SELECT COUNT(*) AS count FROM user_history').get().count, 2);
    assert.strictEqual(
      database.db.prepare('SELECT last_heard_at FROM last_heard WHERE stream_name = ?').get('alpha').last_heard_at,
      now - 5000,
    );
    assert.strictEqual(
      database.db.prepare('SELECT city FROM geo_cache WHERE anonymized_ip = ?').get('203.0.114.0').city,
      'Cusco',
    );
    database.close();

    const storage = createStorage({ dataDir: temporaryDir, fs, logger, path, sqliteFile });
    const history = storage.createUserHistory();
    const lastHeard = storage.createLastHeardStore();
    const geoCache = storage.createGeoCache();
    const streams = [{ name: 'alpha', lastUdpAt: 0 }];
    lastHeard.apply(streams);
    assert.strictEqual(streams[0].lastUdpAt, now - 5000);
    lastHeard.record('alpha', now);
    assert.strictEqual(lastHeard.flush(), true);
    history.record(7, now + 1000);
    assert.strictEqual(history.snapshot(now).at(-1).count, 7);
    assert.strictEqual(geoCache.get('203.0.114.0').countryCode, 'PE');
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
async function testGeoPrivacyAndCache() {
  assert.deepStrictEqual(classifyAddress('::ffff:192.168.1.45'), {
    anonymized: '192.168.1.45',
    family: 4,
    isLocal: true,
    normalized: '192.168.1.45',
  });
  assert.strictEqual(classifyAddress('8.8.8.8').anonymized, '8.8.8.0');
  assert.strictEqual(classifyAddress('2001:4860:4860::8888').anonymized, '2001:4860:4860::');

  const records = new Map();
  const cache = {
    get: (key) => records.get(key) || null,
    set: (record) => {
      records.set(record.anonymizedIp, { ...record });
      return true;
    },
  };
  const messages = [];
  const logger = {
    debug: (event, fields) => messages.push({ event, fields }),
    warn: (event, fields) => messages.push({ event, fields }),
  };
  let now = 1_700_000_000_000;
  let lookups = 0;
  const disabledService = createGeoService({
    cache,
    enabled: false,
    logger,
    lookup: async () => {
      throw new Error('disabled geolocation must not make requests');
    },
    now: () => now,
  });
  await disabledService.observe('10.0.0.7');
  assert.strictEqual(records.size, 0);

  const service = createGeoService({
    cache,
    enabled: true,
    logger,
    lookup: async (address) => {
      lookups += 1;
      assert.strictEqual(address, '8.8.8.8');
      return { countryCode: 'US', country: 'United States', city: 'Mountain View' };
    },
    now: () => now,
    ttlMs: 30 * 24 * 60 * 60 * 1000,
  });

  await service.observe('10.0.0.7');
  assert.deepStrictEqual(records.get('10.0.0.7'), {
    anonymizedIp: '10.0.0.7',
    countryCode: '',
    country: 'Local IP',
    city: 'Local IP',
    lookedUpAt: now,
    source: 'local',
  });
  await Promise.all([service.observe('8.8.8.8'), service.observe('8.8.8.8')]);
  assert.strictEqual(lookups, 1);
  assert.strictEqual(records.get('8.8.8.0').countryCode, 'US');
  assert.strictEqual(records.get('8.8.8.0').city, 'Mountain View');
  await service.observe('8.8.8.8');
  assert.strictEqual(lookups, 1);
  now += (30 * 24 * 60 * 60 * 1000) + 1;
  await service.observe('8.8.8.8');
  assert.strictEqual(lookups, 2);
  assert.strictEqual(messages.some((message) => message.fields.remote === '8.8.8.8'), false);
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
    'sqlite_file = runtime.sqlite',
    '',
  ].join('\n'));
  ensureServerConfigFromTemplateWithTemp(serverConfigPath, path.join(temporaryDir, 'server.conf.tmp'), fs, path);

  fs.mkdirSync(dataDir, { recursive: true });
  await createTestAdministrator(path.join(dataDir, 'runtime.sqlite'));

  const child = childProcess.spawn(process.execPath, [
    'server.js',
    '--server-config', serverConfigPath,
    '--config', configPath,
    '--data-dir', dataDir,
  ], {
    cwd: projectDir,
    env: { ...process.env, ...TEST_AUTH_ENV },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  try {
    await waitFor(() => request(adminPort, '/api/auth/status'));
    await loginTestAdmin(adminPort);
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

async function createTestAdministrator(sqliteFile) {
  const database = openSqliteDatabase({ filePath: sqliteFile, fs, path });
  try {
    await upsertAdministrator({
      database,
      password: "integration password is sufficiently long",
      passwordHasher: createPasswordHasher({ N: 1024, maxmem: 16 * 1024 * 1024 }),
      username: "admin",
    });
  } finally {
    database.close();
  }
}

async function loginTestAdmin(port, forwardedHttps = false) {
  const proxyHeaders = forwardedHttps ? {
    'x-forwarded-for': '198.51.100.25',
    'x-forwarded-host': 'admin.example.test',
    'x-forwarded-proto': 'https',
  } : {};
  const statusResponse = await request(port, "/api/auth/status", { headers: proxyHeaders });
  const status = JSON.parse(statusResponse.body);
  const loginCookie = firstSetCookie(statusResponse.headers["set-cookie"]);
  const loginResponse = await request(port, "/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: loginCookie,
      "x-csrf-token": status.loginCsrfToken,
      ...proxyHeaders,
    },
    body: JSON.stringify({
      username: "admin",
      password: "integration password is sufficiently long",
    }),
  });
  assert.strictEqual(loginResponse.statusCode, 200, loginResponse.body);
  if (forwardedHttps) {
    assert.match(String(loginResponse.headers["set-cookie"]), /Secure/);
  }
  const body = JSON.parse(loginResponse.body);
  adminSessions.set(port, {
    cookie: firstSetCookie(loginResponse.headers["set-cookie"]),
    csrfToken: body.csrfToken,
  });
}

function firstSetCookie(value) {
  const header = Array.isArray(value) ? value[0] : value;
  return String(header || "").split(";")[0];
}

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const method = options.method || 'GET';
    const auth = adminSessions.get(port);
    const headers = {
      ...(auth ? { cookie: auth.cookie } : {}),
      ...(options.headers || {}),
    };
    if (auth && !options.skipCsrf && !['GET', 'HEAD'].includes(method.toUpperCase())) {
      headers['x-csrf-token'] = auth.csrfToken;
    }
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers,
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

function openControlWebSocket(port, pathname) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const messages = [];
    const waiters = [];
    let buffer = Buffer.alloc(0);
    let handshakeComplete = false;

    function dispatch(message) {
      messages.push(message);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        if (waiters[index].type !== message.type) continue;
        const waiter = waiters.splice(index, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }

    function parseFrames() {
      while (buffer.length >= 2) {
        let payloadLength = buffer[1] & 0x7f;
        let headerLength = 2;
        if (payloadLength === 126) {
          if (buffer.length < 4) return;
          payloadLength = buffer.readUInt16BE(2);
          headerLength = 4;
        } else if (payloadLength === 127) {
          if (buffer.length < 10) return;
          payloadLength = Number(buffer.readBigUInt64BE(2));
          headerLength = 10;
        }
        if (buffer.length < headerLength + payloadLength) return;
        const opcode = buffer[0] & 0x0f;
        const payload = buffer.subarray(headerLength, headerLength + payloadLength);
        buffer = buffer.subarray(headerLength + payloadLength);
        if (opcode === 0x1) dispatch(JSON.parse(payload.toString('utf8')));
      }
    }

    socket.once('error', reject);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshakeComplete) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const responseHeaders = buffer.subarray(0, headerEnd).toString('utf8');
        if (!responseHeaders.startsWith('HTTP/1.1 101')) {
          reject(new Error(`WebSocket handshake failed: ${responseHeaders.split('\r\n')[0]}`));
          socket.destroy();
          return;
        }
        buffer = buffer.subarray(headerEnd + 4);
        handshakeComplete = true;
        socket.removeListener('error', reject);
        socket.on('error', () => {});
        resolve({
          socket,
          close: () => socket.destroy(),
          waitForMessage(type, timeoutMs = 3000) {
            const existing = messages.find((message) => message.type === type);
            if (existing) return Promise.resolve(existing);
            return new Promise((resolveMessage, rejectMessage) => {
              const waiter = {
                type,
                resolve: resolveMessage,
                timer: setTimeout(() => {
                  const index = waiters.indexOf(waiter);
                  if (index >= 0) waiters.splice(index, 1);
                  rejectMessage(new Error(`Timed out waiting for WebSocket message "${type}"`));
                }, timeoutMs),
              };
              waiters.push(waiter);
            });
          },
        });
      }
      parseFrames();
    });
    socket.once('connect', () => {
      const key = Buffer.from(`integration-${Date.now()}-${Math.random()}`).toString('base64');
      socket.write([
        `GET ${pathname} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        `Sec-WebSocket-Key: ${key}`,
        '',
        '',
      ].join('\r\n'));
    });
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
