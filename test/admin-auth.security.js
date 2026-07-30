'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { solveChallenge } = require('altcha-lib');
const { deriveKey } = require('altcha-lib/algorithms/pbkdf2');
const { createAdminAuth, loadAdminAuthConfig, upsertAdministrator } = require('../lib/admin-auth');
const { createPasswordHasher } = require('../lib/admin-password');
const { createProxyTrust, resolveRequestContext } = require('../lib/proxy-trust');
const { openSqliteDatabase } = require('../lib/sqlite-database');

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

async function run() {
  testConfigurationValidation();
  await testAuthenticationFlow();
  await testAltchaDisabledFlow();
  await testChallengeFailuresAndReplay();
  await testRateLimitsAndCleanup();
  await testAccountRateLimits();
  await testSessionExpiry();
  testProxyTrust();
  console.log('admin authentication security tests passed');
}

function testConfigurationValidation() {
  assert.throws(() => loadAdminAuthConfig({}), /ADMIN_AUTH_SECRET/);
  assert.throws(() => loadAdminAuthConfig({
    ADMIN_AUTH_SECRET: 'same-secret-that-is-more-than-thirty-two-bytes',
    ADMIN_ALTCHA_SECRET: 'same-secret-that-is-more-than-thirty-two-bytes',
  }), /must be different/);
  assert.throws(() => loadAdminAuthConfig({
    ADMIN_AUTH_SECRET: 'auth-secret-that-is-more-than-thirty-two-bytes',
    ADMIN_ALTCHA_SECRET: 'altcha-secret-that-is-more-than-thirty-two-bytes',
    ADMIN_ALTCHA_TTL_SECONDS: '9999',
  }), /ADMIN_ALTCHA_TTL_SECONDS/);
}

async function testAuthenticationFlow() {
  const fixture = await createFixture();
  try {
    assert.strictEqual(fixture.adminResult.created, true);
    assert.strictEqual(fixture.database.db.prepare('SELECT COUNT(*) AS count FROM admin_users').get().count, 1);

    const unknown = await fixture.login('nobody', 'wrong');
    assert.strictEqual(unknown.statusCode, 401);
    assert.strictEqual(unknown.body.error, 'Invalid username, password, or verification.');

    const first = await fixture.login('admin', 'wrong');
    const second = await fixture.login('admin', 'wrong');
    const third = await fixture.login('admin', 'wrong');
    assert.strictEqual(first.body.challengeRequired, false);
    assert.strictEqual(second.body.challengeRequired, false);
    assert.strictEqual(third.body.challengeRequired, true);
    const adminState = fixture.database.db.prepare(
      'SELECT failed_attempts, challenge_required FROM admin_users WHERE id = 1',
    ).get();
    assert.strictEqual(adminState.failed_attempts, 3);
    assert.strictEqual(adminState.challenge_required, 1);

    const fourth = await fixture.login('admin', 'correct horse battery staple');
    assert.strictEqual(fourth.statusCode, 403);
    assert.strictEqual(fourth.body.code, 'challenge_missing');

    const challenge = await fixture.challenge('admin');
    const wrongPayload = await solve(challenge.body);
    const wrongAfterChallenge = await fixture.login('admin', 'wrong', wrongPayload);
    assert.strictEqual(wrongAfterChallenge.statusCode, 401);
    assert.strictEqual(wrongAfterChallenge.body.challengeRequired, true);
    assert.strictEqual(
      fixture.database.db.prepare('SELECT challenge_required FROM admin_users WHERE id = 1').get().challenge_required,
      1,
    );

    const successChallenge = await fixture.challenge('admin');
    const success = await fixture.login(
      'admin',
      'correct horse battery staple',
      await solve(successChallenge.body, { clientPayload: true }),
    );
    assert.strictEqual(success.statusCode, 200);
    assert.match(success.cookie, /HttpOnly/);
    assert.match(success.cookie, /SameSite=Strict/);
    assert.doesNotMatch(success.cookie, /Secure/);
    const sessionCookie = success.cookie.split(';')[0];
    const rawToken = sessionCookie.slice(sessionCookie.indexOf('=') + 1);
    const storedToken = fixture.database.db.prepare('SELECT token_hash FROM admin_sessions').get().token_hash;
    assert.match(storedToken, /^[a-f0-9]{64}$/);
    assert.notStrictEqual(storedToken, rawToken);
    const request = { headers: { cookie: sessionCookie } };
    const session = fixture.auth.authenticateRequest(request);
    assert.strictEqual(session.username, 'admin');
    const initialAudit = fixture.database.db.prepare(
      'SELECT * FROM admin_change_sessions WHERE token_hash = ?',
    ).get(session.tokenHash);
    assert.strictEqual(initialAudit.username, 'admin');
    assert.strictEqual(initialAudit.client_ip, '198.51.100.20');
    assert.strictEqual(initialAudit.started_at, fixture.now());
    assert.strictEqual(initialAudit.ended_at, null);
    assert.strictEqual(initialAudit.change_count, 0);

    const firstBase = { streams: [{ name: 'before-first-change' }] };
    assert.deepStrictEqual(fixture.auth.recordChange(session, {
      action: 'streams_updated',
      baseConfig: firstBase,
      details: { changeScope: 'label' },
    }), { changeCount: 1, sessionId: initialAudit.id });
    assert.strictEqual(fixture.auth.recordChange(session, {
      action: 'streams_updated',
      baseConfig: { streams: [{ name: 'before-second-change' }] },
      details: { changeScope: 'structural' },
    }).changeCount, 2);
    const changedAudit = fixture.database.db.prepare(
      'SELECT * FROM admin_change_sessions WHERE token_hash = ?',
    ).get(session.tokenHash);
    assert.strictEqual(changedAudit.change_count, 2);
    assert.deepStrictEqual(JSON.parse(changedAudit.base_config_json), firstBase);
    assert.strictEqual(fixture.database.db.prepare(
      'SELECT COUNT(*) AS count FROM admin_change_events WHERE change_session_id = ?',
    ).get(initialAudit.id).count, 2);
    assert.strictEqual(fixture.auth.verifySessionCsrf(session, success.body.csrfToken), true);
    assert.strictEqual(fixture.auth.verifySessionCsrf(session, 'wrong'), false);

    const loginCsrf = fixture.auth.createLoginCsrf(true);
    const loginRequest = { headers: { cookie: loginCsrf.cookie.split(';')[0] } };
    assert.strictEqual(fixture.auth.verifyLoginCsrf(loginRequest, loginCsrf.token), true);
    assert.match(loginCsrf.cookie, /Secure/);

    const logoutCookie = fixture.auth.logout(session, false);
    assert.match(logoutCookie, /Max-Age=0/);
    assert.strictEqual(fixture.auth.authenticateRequest(request), null);
    const closedAudit = fixture.database.db.prepare(
      'SELECT ended_at, end_reason, change_count FROM admin_change_sessions WHERE token_hash = ?',
    ).get(session.tokenHash);
    assert.strictEqual(closedAudit.ended_at, fixture.now());
    assert.strictEqual(closedAudit.end_reason, 'logout');
    assert.strictEqual(closedAudit.change_count, 2);

    const postSuccess = fixture.database.db.prepare(
      'SELECT failed_attempts, challenge_required, last_login_at FROM admin_users WHERE id = 1',
    ).get();
    assert.strictEqual(postSuccess.failed_attempts, 0);
    assert.strictEqual(postSuccess.challenge_required, 0);
    assert.ok(postSuccess.last_login_at > 0);
  } finally {
    fixture.close();
  }
}

async function testAltchaDisabledFlow() {
  const fixture = await createFixture({ config: { altchaEnabled: false } });
  try {
    await fixture.login('admin', 'wrong');
    await fixture.login('admin', 'wrong');
    const third = await fixture.login('admin', 'wrong');
    assert.strictEqual(third.statusCode, 401);
    assert.strictEqual(third.body.challengeRequired, false);

    const success = await fixture.login('admin', 'correct horse battery staple');
    assert.strictEqual(success.statusCode, 200);
    assert.strictEqual(success.body.authenticated, true);
  } finally {
    fixture.close();
  }
}

async function testChallengeFailuresAndReplay() {
  const fixture = await createFixture();
  try {
    await triggerChallenge(fixture);

    const invalidChallenge = await fixture.challenge('admin');
    const invalidPayload = decodePayload(await solve(invalidChallenge.body));
    invalidPayload.solution.derivedKey = (invalidPayload.solution.derivedKey.startsWith('0') ? '1' : '0') + invalidPayload.solution.derivedKey.slice(1);
    const invalid = await fixture.login('admin', 'wrong', encodePayload(invalidPayload));
    assert.strictEqual(invalid.statusCode, 403);
    assert.strictEqual(invalid.body.code, 'challenge_invalid');

    const signatureChallenge = await fixture.challenge('admin');
    const signaturePayload = decodePayload(await solve(signatureChallenge.body));
    signaturePayload.challenge.signature = (signaturePayload.challenge.signature.startsWith('0') ? '1' : '0') + signaturePayload.challenge.signature.slice(1);
    const alteredSignature = await fixture.login('admin', 'wrong', encodePayload(signaturePayload));
    assert.strictEqual(alteredSignature.statusCode, 403);
    assert.strictEqual(alteredSignature.body.code, 'challenge_binding_invalid');
    const alteredSignatureReuse = await fixture.login('admin', 'wrong', encodePayload(signaturePayload));
    assert.strictEqual(alteredSignatureReuse.statusCode, 409);

    const purposeChallenge = await fixture.challenge('admin');
    const purposePayload = decodePayload(await solve(purposeChallenge.body));
    purposePayload.challenge.parameters.data.purpose = 'other-action';
    const wrongPurpose = await fixture.login('admin', 'wrong', encodePayload(purposePayload));
    assert.strictEqual(wrongPurpose.statusCode, 403);
    assert.strictEqual(wrongPurpose.body.code, 'challenge_binding_invalid');

    const expiringChallenge = await fixture.challenge('admin');
    const expiringPayload = await solve(expiringChallenge.body);
    fixture.advance(fixture.config.altchaTtlMs + 1000);
    const expired = await fixture.login('admin', 'wrong', expiringPayload);
    assert.strictEqual(expired.statusCode, 403);
    assert.strictEqual(expired.body.code, 'challenge_expired');

    const reusableChallenge = await fixture.challenge('admin');
    const reusablePayload = await solve(reusableChallenge.body);
    const concurrent = await Promise.all([
      fixture.login('admin', 'wrong', reusablePayload),
      fixture.login('admin', 'wrong', reusablePayload),
    ]);
    assert.strictEqual(concurrent.filter((result) => result.statusCode === 401).length, 1);
    assert.strictEqual(concurrent.filter((result) => result.statusCode === 409).length, 1);
  } finally {
    fixture.close();
  }
}

async function testRateLimitsAndCleanup() {
  let verifyCalls = 0;
  const baseHasher = createPasswordHasher({ N: 1024, maxmem: 16 * 1024 * 1024 });
  const fixture = await createFixture({
    config: {
      loginIpLimit: 4,
      loginAccountLimit: 100,
      challengeIpLimit: 2,
      challengeAccountLimit: 100,
    },
    passwordHasher: {
      hash: baseHasher.hash,
      verify: async (...args) => {
        verifyCalls += 1;
        return baseHasher.verify(...args);
      },
    },
  });
  try {
    await fixture.login('admin', 'wrong');
    await fixture.login('admin', 'wrong');
    await fixture.login('admin', 'wrong');
    await fixture.login('admin', 'wrong');
    const beforeLimited = verifyCalls;
    const limited = await fixture.login('admin', 'wrong');
    assert.strictEqual(limited.statusCode, 429);
    assert.ok(limited.retryAfter >= 1);
    assert.strictEqual(verifyCalls, beforeLimited);

    fixture.advance(fixture.config.loginWindowMs + 1);
    const challengeOne = await fixture.challenge('admin');
    const challengeTwo = await fixture.challenge('admin');
    const challengeLimited = await fixture.challenge('admin');
    assert.strictEqual(challengeOne.statusCode, 200);
    assert.strictEqual(challengeTwo.statusCode, 200);
    assert.strictEqual(challengeLimited.statusCode, 429);

    const old = fixture.now() - 2000000;
    fixture.database.db.prepare(
      "INSERT INTO admin_rate_events (category, scope, key_hash, created_at) VALUES ('login', 'ip', 'old', ?)",
    ).run(old);
    fixture.database.db.prepare(`
      INSERT INTO admin_sessions (token_hash, admin_id, created_at, last_seen_at, expires_at)
      VALUES ('old-session', 1, ?, ?, ?)
    `).run(old, old, old);
    fixture.database.db.prepare(`
      INSERT INTO admin_altcha_challenges (
        id, purpose, account_key_hash, challenge_hash, created_at, expires_at, consumed_at
      ) VALUES ('old', 'login', 'old', 'old', ?, ?, ?)
    `).run(old, old, old);
    fixture.auth.cleanup(fixture.now(), 500);
    assert.strictEqual(
      fixture.database.db.prepare("SELECT COUNT(*) AS count FROM admin_rate_events WHERE key_hash = 'old'").get().count,
      0,
    );
    assert.strictEqual(
      fixture.database.db.prepare("SELECT COUNT(*) AS count FROM admin_altcha_challenges WHERE id = 'old'").get().count,
      0,
    );
    assert.strictEqual(
      fixture.database.db.prepare("SELECT COUNT(*) AS count FROM admin_sessions WHERE token_hash = 'old-session'").get().count,
      0,
    );
  } finally {
    fixture.close();
  }
}

async function testAccountRateLimits() {
  let verifyCalls = 0;
  const baseHasher = createPasswordHasher({ N: 1024, maxmem: 16 * 1024 * 1024 });
  const fixture = await createFixture({
    config: {
      loginIpLimit: 100,
      loginAccountLimit: 2,
      challengeIpLimit: 100,
      challengeAccountLimit: 2,
    },
    passwordHasher: {
      hash: baseHasher.hash,
      verify: async (...args) => {
        verifyCalls += 1;
        return baseHasher.verify(...args);
      },
    },
  });
  try {
    await fixture.login('admin', 'wrong', undefined, '198.51.100.1');
    await fixture.login('admin', 'wrong', undefined, '198.51.100.2');
    const beforeLimited = verifyCalls;
    const accountLimited = await fixture.login('admin', 'wrong', undefined, '198.51.100.3');
    assert.strictEqual(accountLimited.statusCode, 429);
    assert.strictEqual(verifyCalls, beforeLimited);

    fixture.advance(fixture.config.loginWindowMs + 1);
    await fixture.login('admin', 'wrong', undefined, '198.51.100.4');
    const challengeOne = await fixture.challenge('admin', '198.51.100.5');
    const challengeTwo = await fixture.challenge('admin', '198.51.100.6');
    const challengeLimited = await fixture.challenge('admin', '198.51.100.7');
    assert.strictEqual(challengeOne.statusCode, 200);
    assert.strictEqual(challengeTwo.statusCode, 200);
    assert.strictEqual(challengeLimited.statusCode, 429);
  } finally {
    fixture.close();
  }
}

async function testSessionExpiry() {
  const fixture = await createFixture({
    config: { sessionIdleMs: 60 * 1000, sessionTtlMs: 5 * 60 * 1000 },
  });
  try {
    const idleLogin = await fixture.login('admin', 'correct horse battery staple');
    const idleCookie = idleLogin.cookie.split(';')[0];
    fixture.advance(fixture.config.sessionIdleMs + 1);
    assert.strictEqual(fixture.auth.authenticateRequest({ headers: { cookie: idleCookie } }), null);
    assert.strictEqual(fixture.database.db.prepare(
      "SELECT end_reason FROM admin_change_sessions WHERE client_ip = '198.51.100.20' ORDER BY id DESC LIMIT 1",
    ).get().end_reason, 'idle_timeout');

    const absoluteLogin = await fixture.login(
      'admin', 'correct horse battery staple', undefined, '198.51.100.20', true,
    );
    assert.match(absoluteLogin.cookie, /Secure/);
    const absoluteCookie = absoluteLogin.cookie.split(';')[0];
    fixture.database.db.prepare('UPDATE admin_sessions SET expires_at = ?').run(fixture.now() - 1);
    assert.strictEqual(fixture.auth.authenticateRequest({ headers: { cookie: absoluteCookie } }), null);
    assert.strictEqual(fixture.database.db.prepare(
      "SELECT end_reason FROM admin_change_sessions WHERE client_ip = '198.51.100.20' ORDER BY id DESC LIMIT 1",
    ).get().end_reason, 'absolute_timeout');
  } finally {
    fixture.close();
  }
}

function testProxyTrust() {
  const trust = createProxyTrust('127.0.0.1,10.0.0.0/24,::1');
  const direct = resolveRequestContext({
    headers: {
      host: 'admin.internal:8584',
      'x-forwarded-for': '198.51.100.10',
      'x-forwarded-proto': 'https',
    },
    socket: { remoteAddress: '203.0.113.9', encrypted: false },
  }, trust);
  assert.strictEqual(direct.clientAddress, '203.0.113.9');
  assert.strictEqual(direct.secure, false);

  const proxied = resolveRequestContext({
    headers: {
      host: '127.0.0.1:8584',
      'x-forwarded-for': '198.51.100.10',
      'x-forwarded-host': 'admin.example.com',
      'x-forwarded-proto': 'https',
    },
    socket: { remoteAddress: '127.0.0.1', encrypted: false },
  }, trust);
  assert.strictEqual(proxied.clientAddress, '198.51.100.10');
  assert.strictEqual(proxied.origin, 'https://admin.example.com');
  assert.strictEqual(proxied.secure, true);
  assert.throws(() => createProxyTrust('0.0.0.0/0'), /prefix between 1 and 32/);
}

async function triggerChallenge(fixture) {
  await fixture.login('admin', 'wrong');
  await fixture.login('admin', 'wrong');
  const third = await fixture.login('admin', 'wrong');
  assert.strictEqual(third.body.challengeRequired, true);
}

async function createFixture(options = {}) {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'udp-airband-auth-test-'));
  const database = openSqliteDatabase({
    filePath: path.join(temporaryDir, 'auth.sqlite'),
    fs,
    path,
  });
  const passwordHasher = options.passwordHasher
    || createPasswordHasher({ N: 1024, maxmem: 16 * 1024 * 1024 });
  const adminResult = await upsertAdministrator({
    database,
    password: 'correct horse battery staple',
    passwordHasher,
    username: 'admin',
  });
  let currentTime = 2000000000000;
  const config = {
    authSecret: 'auth-secret-that-is-longer-than-thirty-two-bytes',
    altchaSecret: 'altcha-secret-that-is-longer-than-thirty-two-bytes',
    altchaEnabled: true,
    sessionTtlMs: 8 * 60 * 60 * 1000,
    sessionIdleMs: 30 * 60 * 1000,
    altchaTtlMs: 120000,
    altchaCost: 10,
    altchaCounterMin: 5,
    altchaCounterMax: 5,
    loginWindowMs: 15 * 60 * 1000,
    loginIpLimit: 100,
    loginAccountLimit: 100,
    challengeWindowMs: 60 * 1000,
    challengeIpLimit: 100,
    challengeAccountLimit: 100,
    ...(options.config || {}),
  };
  const auth = await createAdminAuth({
    config,
    database,
    logger: { info: () => {} },
    now: () => currentTime,
    passwordHasher,
  });
  return {
    adminResult,
    auth,
    config,
    database,
    now: () => currentTime,
    advance: (milliseconds) => { currentTime += milliseconds; },
    challenge: (username, clientAddress = '198.51.100.20') => auth.createLoginChallenge({
      username,
      clientAddress,
    }),
    login: (username, password, altchaPayload, clientAddress = '198.51.100.20', secure = false) => auth.login({
      username,
      password,
      altchaPayload,
      clientAddress,
      secure,
    }),
    close() {
      auth.close();
      database.close();
      fs.rmSync(temporaryDir, { force: true, recursive: true });
    },
  };
}

async function solve(challenge, options = {}) {
  const solution = await solveChallenge({
    challenge,
    deriveKey,
    timeout: 5000,
  });
  assert.ok(solution);
  const payloadChallenge = options.clientPayload
    ? { parameters: challenge.parameters, signature: challenge.signature }
    : challenge;
  return encodePayload({ challenge: payloadChallenge, solution });
}

function decodePayload(payload) {
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}
