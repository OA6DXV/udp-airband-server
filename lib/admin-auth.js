'use strict';

const crypto = require('crypto');
const { createChallenge, verifySolution } = require('altcha-lib');
const { deriveKey } = require('altcha-lib/algorithms/pbkdf2');
const { createPasswordHasher } = require('./admin-password');

const SESSION_COOKIE = 'udp_airband_admin_session';
const LOGIN_COOKIE = 'udp_airband_admin_login';
const GENERIC_LOGIN_ERROR = 'Invalid username, password, or verification.';
const MAX_USERNAME_BYTES = 128;
const MAX_ALTCHA_PAYLOAD_BYTES = 32 * 1024;

function loadAdminAuthConfig(env = process.env) {
  const config = {
    authSecret: String(env.ADMIN_AUTH_SECRET || ''),
    altchaSecret: String(env.ADMIN_ALTCHA_SECRET || ''),
    altchaEnabled: env.ADMIN_ALTCHA_ENABLED === undefined ? true : parseBoolean(env.ADMIN_ALTCHA_ENABLED),
    sessionTtlMs: readInteger(env, 'ADMIN_SESSION_TTL_SECONDS', 8 * 60 * 60, 300, 7 * 24 * 60 * 60) * 1000,
    sessionIdleMs: readInteger(env, 'ADMIN_SESSION_IDLE_SECONDS', 30 * 60, 60, 24 * 60 * 60) * 1000,
    altchaTtlMs: readInteger(env, 'ADMIN_ALTCHA_TTL_SECONDS', 120, 30, 600) * 1000,
    altchaCost: readInteger(env, 'ADMIN_ALTCHA_COST', 5000, 1000, 100000),
    altchaCounterMin: readInteger(env, 'ADMIN_ALTCHA_COUNTER_MIN', 5000, 1000, 100000),
    altchaCounterMax: readInteger(env, 'ADMIN_ALTCHA_COUNTER_MAX', 10000, 1000, 200000),
    loginWindowMs: readInteger(env, 'ADMIN_LOGIN_WINDOW_SECONDS', 15 * 60, 60, 24 * 60 * 60) * 1000,
    loginIpLimit: readInteger(env, 'ADMIN_LOGIN_IP_LIMIT', 20, 4, 1000),
    loginAccountLimit: readInteger(env, 'ADMIN_LOGIN_ACCOUNT_LIMIT', 15, 4, 1000),
    challengeWindowMs: readInteger(env, 'ADMIN_CHALLENGE_WINDOW_SECONDS', 60, 10, 60 * 60) * 1000,
    challengeIpLimit: readInteger(env, 'ADMIN_CHALLENGE_IP_LIMIT', 10, 1, 1000),
    challengeAccountLimit: readInteger(env, 'ADMIN_CHALLENGE_ACCOUNT_LIMIT', 10, 1, 1000),
  };
  if (Buffer.byteLength(config.authSecret, 'utf8') < 32) {
    throw new Error('ADMIN_AUTH_SECRET must contain at least 32 UTF-8 bytes.');
  }
  if (config.altchaEnabled && Buffer.byteLength(config.altchaSecret, 'utf8') < 32) {
    throw new Error('ADMIN_ALTCHA_SECRET must contain at least 32 UTF-8 bytes.');
  }
  if (config.altchaEnabled && config.authSecret === config.altchaSecret) {
    throw new Error('ADMIN_AUTH_SECRET and ADMIN_ALTCHA_SECRET must be different secrets.');
  }
  if (config.altchaCounterMax < config.altchaCounterMin) {
    throw new Error('ADMIN_ALTCHA_COUNTER_MAX must be greater than or equal to ADMIN_ALTCHA_COUNTER_MIN.');
  }
  return config;
}

async function createAdminAuth(options) {
  const {
    config,
    database,
    logger,
    now = () => Date.now(),
    passwordHasher = createPasswordHasher(),
  } = options;
  const { db, transaction } = database;
  const keySignatureSecret = hmac(config.altchaSecret, 'altcha-v2-key-signature');
  const dummyHash = await passwordHasher.hash(crypto.randomBytes(32).toString('base64url'));
  let loginQueue = Promise.resolve();

  const statements = prepareStatements(db);

  function queueLogin(callback) {
    const operation = loginQueue.then(callback, callback);
    loginQueue = operation.catch(() => {});
    return operation;
  }

  async function login({ username, password, altchaPayload, clientAddress, secure }) {
    return queueLogin(async () => {
      const at = now();
      const normalizedUsername = normalizeUsername(username);
      const accountKey = keyedHash(config.authSecret, `account:${normalizedUsername}`);
      const ipKey = keyedHash(config.authSecret, `ip:${String(clientAddress || '')}`);
      const rate = recordRateEvent({
        accountKey,
        at,
        category: 'login',
        ipKey,
        limits: {
          account: config.loginAccountLimit,
          ip: config.loginIpLimit,
          windowMs: config.loginWindowMs,
        },
      });
      if (!rate.allowed) return rateLimited(rate.retryAfterMs);

      const administrator = statements.getAdministrator.get(normalizedUsername);
      const recentAccountAttempts = countRate('login', 'account', accountKey, at - config.loginWindowMs);
      const challengeRequired = config.altchaEnabled && Boolean(
        (administrator && Number(administrator.challenge_required))
        || recentAccountAttempts >= 4,
      );

      if (challengeRequired) {
        const verification = await consumeAndVerifyChallenge({
          accountKey,
          at,
          payload: altchaPayload,
        });
        if (!verification.ok) {
          securityLog('admin_login_challenge_rejected', { accountKey, clientAddress, reason: verification.reason });
          return {
            body: {
              error: GENERIC_LOGIN_ERROR,
              challengeRequired: true,
              code: verification.code,
            },
            statusCode: verification.statusCode,
          };
        }
      }

      let passwordValid = false;
      try {
        passwordValid = await passwordHasher.verify(
          typeof password === 'string' ? password : '',
          administrator ? administrator.password_hash : dummyHash,
        );
      } catch {
        passwordValid = false;
      }
      const validLogin = Boolean(administrator && Number(administrator.enabled) && passwordValid);

      if (!validLogin) {
        let requiresNextChallenge = config.altchaEnabled && recentAccountAttempts >= 3;
        transaction(() => {
          if (administrator) {
            statements.recordFailure.run(at, at, administrator.id);
            const current = statements.getAdministratorById.get(administrator.id);
            requiresNextChallenge = config.altchaEnabled && Number(current.challenge_required) === 1;
          }
        });
        securityLog('admin_login_failed', { accountKey, clientAddress, challengeRequired: requiresNextChallenge });
        return {
          body: {
            error: GENERIC_LOGIN_ERROR,
            challengeRequired: requiresNextChallenge,
            code: 'invalid_credentials',
          },
          statusCode: 401,
        };
      }

      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = sha256(token);
      const expiresAt = at + config.sessionTtlMs;
      transaction(() => {
        statements.closeAdministratorAuditSessions.run(at, 'replaced', administrator.id);
        statements.deleteAdministratorSessions.run(administrator.id);
        statements.createSession.run(tokenHash, administrator.id, at, at, expiresAt);
        statements.createAuditSession.run(
          tokenHash, administrator.id, administrator.username, String(clientAddress || ''), at,
        );
        statements.recordSuccess.run(at, at, administrator.id);
        statements.deleteAccountLoginEvents.run(accountKey);
      });
      securityLog('admin_login_succeeded', { accountKey, clientAddress });
      return {
        body: {
          authenticated: true,
          csrfToken: csrfToken(token, config.authSecret),
        },
        cookie: serializeCookie(SESSION_COOKIE, token, {
          httpOnly: true,
          maxAge: Math.floor(config.sessionTtlMs / 1000),
          sameSite: 'Strict',
          secure,
        }),
        statusCode: 200,
      };
    });
  }

  async function createLoginChallenge({ username, clientAddress }) {
    const at = now();
    const normalizedUsername = normalizeUsername(username);
    const accountKey = keyedHash(config.authSecret, `account:${normalizedUsername}`);
    const ipKey = keyedHash(config.authSecret, `ip:${String(clientAddress || '')}`);
    const administrator = statements.getAdministrator.get(normalizedUsername);
    const recentAttempts = countRate('login', 'account', accountKey, at - config.loginWindowMs);
    const required = config.altchaEnabled && Boolean(
      (administrator && Number(administrator.challenge_required))
      || recentAttempts >= 3,
    );
    if (!required) {
      return {
        body: { error: 'Verification is not required.', code: 'challenge_not_required' },
        statusCode: 409,
      };
    }

    const rate = recordRateEvent({
      accountKey,
      at,
      category: 'challenge',
      ipKey,
      limits: {
        account: config.challengeAccountLimit,
        ip: config.challengeIpLimit,
        windowMs: config.challengeWindowMs,
      },
    });
    if (!rate.allowed) return rateLimited(rate.retryAfterMs);

    const challengeId = crypto.randomUUID();
    const expiresAt = at + config.altchaTtlMs;
    const counter = crypto.randomInt(config.altchaCounterMin, config.altchaCounterMax + 1);
    const challenge = await createChallenge({
      algorithm: 'PBKDF2/SHA-256',
      cost: config.altchaCost,
      counter,
      data: {
        account: accountKey,
        challengeId,
        purpose: 'login',
      },
      deriveKey,
      expiresAt: Math.floor(expiresAt / 1000),
      hmacKeySignatureSecret: keySignatureSecret,
      hmacSignatureSecret: config.altchaSecret,
    });
    const challengeHash = hashChallenge(challenge);
    transaction(() => {
      statements.createChallenge.run(
        challengeId,
        'login',
        accountKey,
        challengeHash,
        at,
        expiresAt,
      );
    });
    securityLog('admin_login_challenge_created', { accountKey, clientAddress, challengeId });
    return { body: challenge, statusCode: 200 };
  }

  async function consumeAndVerifyChallenge({ accountKey, at, payload }) {
    const parsed = parseAltchaPayload(payload);
    if (!parsed.ok) return parsed;
    const data = parsed.challenge.parameters && parsed.challenge.parameters.data;
    const challengeId = data && String(data.challengeId || '');
    const purpose = data && String(data.purpose || '');
    const boundAccount = data && String(data.account || '');
    if (!challengeId) {
      return challengeFailure('challenge_binding_invalid');
    }
    const challengeHash = hashChallenge(parsed.challenge);
    let challengeState = null;
    const consumed = transaction(() => {
      challengeState = statements.getChallengeState.get(challengeId);
      if (!challengeState || challengeState.consumed_at !== null || Number(challengeState.expires_at) < at) {
        return { changes: 0 };
      }
      return statements.consumeChallenge.run(at, challengeId, at);
    });
    if (Number(consumed.changes) !== 1) {
      if (challengeState && challengeState.consumed_at === null && Number(challengeState.expires_at) < at) {
        return challengeFailure('challenge_expired');
      }
      return challengeFailure('challenge_unavailable', 409);
    }
    if (
      challengeState.purpose !== 'login'
      || !safeEqual(challengeState.account_key_hash, accountKey)
      || purpose !== 'login'
      || !safeEqual(boundAccount, accountKey)
      || !safeEqual(challengeState.challenge_hash, challengeHash)
    ) {
      return challengeFailure('challenge_binding_invalid');
    }
    try {
      const result = await verifySolution({
        challenge: parsed.challenge,
        deriveKey,
        hmacKeySignatureSecret: keySignatureSecret,
        hmacSignatureSecret: config.altchaSecret,
        solution: parsed.solution,
      });
      if (!result.verified) {
        return challengeFailure(result.expired ? 'challenge_expired' : 'challenge_invalid');
      }
      return { ok: true };
    } catch {
      return challengeFailure('challenge_invalid');
    }
  }

  function authenticateRequest(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token || token.length > 128) return null;
    const at = now();
    const session = statements.getSession.get(sha256(token));
    if (!session) return null;
    if (Number(session.expires_at) <= at || at - Number(session.last_seen_at) > config.sessionIdleMs) {
      const tokenHash = sha256(token);
      const reason = Number(session.expires_at) <= at ? 'absolute_timeout' : 'idle_timeout';
      transaction(() => {
        statements.closeAuditSession.run(at, reason, tokenHash);
        statements.deleteSession.run(tokenHash);
      });
      return null;
    }
    if (at - Number(session.last_seen_at) >= 60 * 1000) {
      statements.touchSession.run(at, sha256(token));
    }
    return {
      adminId: Number(session.admin_id),
      csrfToken: csrfToken(token, config.authSecret),
      token,
      tokenHash: sha256(token),
      username: String(session.username),
    };
  }

  function createLoginCsrf(secure) {
    const nonce = crypto.randomBytes(24).toString('base64url');
    return {
      cookie: serializeCookie(LOGIN_COOKIE, nonce, {
        httpOnly: true,
        maxAge: 10 * 60,
        sameSite: 'Strict',
        secure,
      }),
      token: loginCsrfToken(nonce, config.authSecret),
    };
  }

  function verifyLoginCsrf(req, token) {
    const nonce = parseCookies(req.headers.cookie)[LOGIN_COOKIE];
    return Boolean(nonce && safeEqual(loginCsrfToken(nonce, config.authSecret), String(token || '')));
  }

  function verifySessionCsrf(session, token) {
    return Boolean(session && safeEqual(session.csrfToken, String(token || '')));
  }

  function logout(session, secure) {
    if (session) {
      const tokenHash = session.tokenHash || sha256(session.token);
      transaction(() => {
        statements.closeAuditSession.run(now(), 'logout', tokenHash);
        statements.deleteSession.run(tokenHash);
      });
    }
    return serializeCookie(SESSION_COOKIE, '', {
      httpOnly: true,
      maxAge: 0,
      sameSite: 'Strict',
      secure,
    });
  }

  function cleanup(at = now(), batchSize = 500) {
    transaction(() => {
      statements.closeExpiredAuditSessions.run(at, at, at, at - config.sessionIdleMs, batchSize);
      statements.cleanupSessions.run(at, at - config.sessionIdleMs, batchSize);
      statements.cleanupAttempts.run(at - Math.max(config.loginWindowMs, config.challengeWindowMs), batchSize);
      statements.cleanupChallenges.run(at, batchSize);
    });
  }

  function recordChange(session, { action, baseConfig, details }) {
    if (!session || !session.tokenHash) throw new Error('Authenticated administrator session required.');
    const at = now();
    const baseConfigJson = baseConfig === undefined ? null : JSON.stringify(baseConfig);
    const detailsJson = details === undefined ? null : JSON.stringify(details);
    return transaction(() => {
      const updated = statements.recordAuditChange.run(at, at, baseConfigJson, session.tokenHash);
      if (Number(updated.changes) !== 1) {
        throw new Error('Administrator audit session is unavailable.');
      }
      const auditSession = statements.getAuditSession.get(session.tokenHash);
      statements.createAuditEvent.run(auditSession.id, at, String(action || 'change'), detailsJson);
      return { changeCount: Number(auditSession.change_count), sessionId: Number(auditSession.id) };
    });
  }

  function recordRateEvent({ accountKey, at, category, ipKey, limits }) {
    return transaction(() => {
      const since = at - limits.windowMs;
      const ipCount = countRate(category, 'ip', ipKey, since);
      const accountCount = countRate(category, 'account', accountKey, since);
      if (ipCount >= limits.ip || accountCount >= limits.account) {
        const oldest = statements.oldestRate.get(category, since, ipKey, accountKey);
        return {
          allowed: false,
          retryAfterMs: Math.max(1000, Number(oldest && oldest.at || at) + limits.windowMs - at),
        };
      }
      statements.insertRate.run(category, 'ip', ipKey, at);
      statements.insertRate.run(category, 'account', accountKey, at);
      return { allowed: true };
    });
  }

  function countRate(category, scope, keyHash, since) {
    return Number(statements.countRate.get(category, scope, keyHash, since).count);
  }

  function securityLog(event, fields) {
    if (!logger) return;
    logger.info(event, {
      account: String(fields.accountKey || '').slice(0, 12),
      challenge: fields.challengeId,
      challengeRequired: fields.challengeRequired,
      remote: String(keyedHash(config.authSecret, `log-ip:${fields.clientAddress || ''}`)).slice(0, 12),
      reason: fields.reason,
    });
  }

  cleanup();
  const cleanupTimer = setInterval(() => cleanup(), 10 * 60 * 1000);
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

  return {
    authenticateRequest,
    cleanup,
    close() {
      clearInterval(cleanupTimer);
    },
    config,
    createLoginChallenge,
    createLoginCsrf,
    login,
    logout,
    recordChange,
    verifyLoginCsrf,
    verifySessionCsrf,
  };
}

async function upsertAdministrator({ database, password, passwordHasher = createPasswordHasher(), username, now = Date.now() }) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) throw new Error('Administrator username is required and must not exceed 128 UTF-8 bytes.');
  const passwordHash = await passwordHasher.hash(password);
  const { db, transaction } = database;
  const existing = db.prepare('SELECT id FROM admin_users WHERE id = 1').get();
  transaction(() => {
    db.prepare(`
      UPDATE admin_change_sessions
      SET ended_at = ?, end_reason = 'administrator_replaced'
      WHERE ended_at IS NULL
    `).run(now);
    db.prepare(`
      INSERT INTO admin_users (
        id, username, password_hash, enabled, failed_attempts, challenge_required,
        created_at, updated_at
      ) VALUES (1, ?, ?, 1, 0, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        password_hash = excluded.password_hash,
        enabled = 1,
        failed_attempts = 0,
        challenge_required = 0,
        last_failure_at = NULL,
        updated_at = excluded.updated_at
    `).run(normalizedUsername, passwordHash, now, now);
    db.prepare('DELETE FROM admin_sessions').run();
  });
  return { created: !existing, username: normalizedUsername };
}

function prepareStatements(db) {
  return {
    getAdministrator: db.prepare(`
      SELECT id, username, password_hash, enabled, failed_attempts, challenge_required
      FROM admin_users WHERE username = ? COLLATE NOCASE LIMIT 1
    `),
    getAdministratorById: db.prepare(`
      SELECT id, challenge_required FROM admin_users WHERE id = ?
    `),
    recordFailure: db.prepare(`
      UPDATE admin_users SET
        failed_attempts = failed_attempts + 1,
        challenge_required = CASE WHEN failed_attempts + 1 >= 3 THEN 1 ELSE challenge_required END,
        last_failure_at = ?,
        updated_at = ?
      WHERE id = ?
    `),
    recordSuccess: db.prepare(`
      UPDATE admin_users SET failed_attempts = 0, challenge_required = 0,
        last_failure_at = NULL, last_login_at = ?, updated_at = ?
      WHERE id = ?
    `),
    createSession: db.prepare(`
      INSERT INTO admin_sessions (token_hash, admin_id, created_at, last_seen_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    createAuditSession: db.prepare(`
      INSERT INTO admin_change_sessions (token_hash, admin_id, username, client_ip, started_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    closeAuditSession: db.prepare(`
      UPDATE admin_change_sessions SET ended_at = ?, end_reason = ?
      WHERE token_hash = ? AND ended_at IS NULL
    `),
    closeAdministratorAuditSessions: db.prepare(`
      UPDATE admin_change_sessions SET ended_at = ?, end_reason = ?
      WHERE admin_id = ? AND ended_at IS NULL
    `),
    closeExpiredAuditSessions: db.prepare(`
      UPDATE admin_change_sessions
      SET ended_at = ?,
          end_reason = CASE WHEN token_hash IN (
            SELECT token_hash FROM admin_sessions WHERE expires_at < ?
          ) THEN 'absolute_timeout' ELSE 'idle_timeout' END
      WHERE ended_at IS NULL AND token_hash IN (
        SELECT token_hash FROM admin_sessions
        WHERE expires_at < ? OR last_seen_at < ?
        ORDER BY expires_at LIMIT ?
      )
    `),
    recordAuditChange: db.prepare(`
      UPDATE admin_change_sessions SET
        change_count = change_count + 1,
        first_change_at = COALESCE(first_change_at, ?),
        last_change_at = ?,
        base_config_json = COALESCE(base_config_json, ?)
      WHERE token_hash = ? AND ended_at IS NULL
    `),
    getAuditSession: db.prepare(`
      SELECT id, change_count FROM admin_change_sessions WHERE token_hash = ?
    `),
    createAuditEvent: db.prepare(`
      INSERT INTO admin_change_events (change_session_id, created_at, action, details_json)
      VALUES (?, ?, ?, ?)
    `),
    getSession: db.prepare(`
      SELECT s.admin_id, s.created_at, s.last_seen_at, s.expires_at, a.username
      FROM admin_sessions s
      JOIN admin_users a ON a.id = s.admin_id
      WHERE s.token_hash = ? AND a.enabled = 1
    `),
    touchSession: db.prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?'),
    deleteAdministratorSessions: db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?'),
    deleteAccountLoginEvents: db.prepare("DELETE FROM admin_rate_events WHERE category = 'login' AND scope = 'account' AND key_hash = ?"),
    insertRate: db.prepare(`
      INSERT INTO admin_rate_events (category, scope, key_hash, created_at) VALUES (?, ?, ?, ?)
    `),
    countRate: db.prepare(`
      SELECT COUNT(*) AS count FROM admin_rate_events
      WHERE category = ? AND scope = ? AND key_hash = ? AND created_at >= ?
    `),
    oldestRate: db.prepare(`
      SELECT MIN(created_at) AS at FROM admin_rate_events
      WHERE category = ? AND created_at >= ? AND (
        (scope = 'ip' AND key_hash = ?) OR (scope = 'account' AND key_hash = ?)
      )
    `),
    createChallenge: db.prepare(`
      INSERT INTO admin_altcha_challenges (
        id, purpose, account_key_hash, challenge_hash, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `),
    getChallengeState: db.prepare(`
      SELECT purpose, account_key_hash, challenge_hash, expires_at, consumed_at
      FROM admin_altcha_challenges WHERE id = ?
    `),
    consumeChallenge: db.prepare(`
      UPDATE admin_altcha_challenges SET consumed_at = ?
      WHERE id = ? AND consumed_at IS NULL AND expires_at >= ?
    `),
    cleanupSessions: db.prepare(`
      DELETE FROM admin_sessions WHERE rowid IN (
        SELECT rowid FROM admin_sessions
        WHERE expires_at < ? OR last_seen_at < ?
        ORDER BY expires_at LIMIT ?
      )
    `),
    cleanupAttempts: db.prepare(`
      DELETE FROM admin_rate_events WHERE id IN (
        SELECT id FROM admin_rate_events WHERE created_at < ? ORDER BY created_at LIMIT ?
      )
    `),
    cleanupChallenges: db.prepare(`
      DELETE FROM admin_altcha_challenges WHERE rowid IN (
        SELECT rowid FROM admin_altcha_challenges
        WHERE expires_at < ? OR consumed_at IS NOT NULL
        ORDER BY expires_at LIMIT ?
      )
    `),
  };
}

function parseAltchaPayload(value) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > MAX_ALTCHA_PAYLOAD_BYTES) {
    return challengeFailure('challenge_missing');
  }
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object' || !parsed.challenge || !parsed.solution) {
      return challengeFailure('challenge_invalid');
    }
    return { ok: true, challenge: parsed.challenge, solution: parsed.solution };
  } catch {
    return challengeFailure('challenge_invalid');
  }
}

function challengeFailure(code, statusCode = 403) {
  return { ok: false, code, reason: code, statusCode };
}

function rateLimited(retryAfterMs) {
  return {
    body: {
      error: 'Too many requests. Try again later.',
      code: 'rate_limited',
      retryAfter: Math.ceil(retryAfterMs / 1000),
    },
    retryAfter: Math.ceil(retryAfterMs / 1000),
    statusCode: 429,
  };
}

function normalizeUsername(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > MAX_USERNAME_BYTES) return '';
  return normalized;
}

function hashChallenge(challenge) {
  return sha256(JSON.stringify(sortObject(canonicalChallengeForClient(challenge))));
}

function canonicalChallengeForClient(challenge) {
  if (!challenge || typeof challenge !== 'object') return challenge;
  return {
    parameters: challenge.parameters,
    signature: challenge.signature,
  };
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    try {
      cookies[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // Ignore malformed cookies.
    }
  }
  return cookies;
}

function serializeCookie(name, value, options) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `SameSite=${options.sameSite}`,
    `Max-Age=${Math.max(0, options.maxAge)}`,
  ];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function csrfToken(token, secret) {
  return keyedHash(secret, `csrf:${token}`);
}

function loginCsrfToken(nonce, secret) {
  return keyedHash(secret, `login-csrf:${nonce}`);
}

function keyedHash(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function readInteger(env, name, fallback, minimum, maximum) {
  const raw = env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

module.exports = {
  createAdminAuth,
  loadAdminAuthConfig,
  normalizeUsername,
  upsertAdministrator,
};
