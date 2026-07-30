'use strict';

function openSqliteDatabase({ filePath, fs, path }) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  let Database;
  let driver;
  try {
    ({ DatabaseSync: Database } = require('node:sqlite'));
    driver = 'node:sqlite';
  } catch {
    try {
      Database = require('better-sqlite3');
      driver = 'better-sqlite3';
    } catch (err) {
      const error = new Error(
        `SQLite is required for runtime data on Node.js ${process.versions.node}. `
        + 'Install the compatibility driver with "npm install better-sqlite3", '
        + 'or upgrade to Node.js 22.13+ where node:sqlite is built in.',
      );
      error.cause = err;
      throw error;
    }
  }

  const db = new Database(filePath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_history (
      at INTEGER PRIMARY KEY,
      count INTEGER NOT NULL CHECK (count >= 0)
    );
    CREATE TABLE IF NOT EXISTS last_heard (
      stream_name TEXT PRIMARY KEY,
      last_heard_at INTEGER NOT NULL CHECK (last_heard_at > 0)
    );
    CREATE TABLE IF NOT EXISTS geo_cache (
      anonymized_ip TEXT PRIMARY KEY,
      country_code TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL,
      city TEXT NOT NULL,
      looked_up_at INTEGER NOT NULL CHECK (looked_up_at > 0),
      source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
      challenge_required INTEGER NOT NULL DEFAULT 0 CHECK (challenge_required IN (0, 1)),
      last_failure_at INTEGER,
      last_login_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_change_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      admin_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      client_ip TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      end_reason TEXT,
      change_count INTEGER NOT NULL DEFAULT 0 CHECK (change_count >= 0),
      first_change_at INTEGER,
      last_change_at INTEGER,
      base_config_json TEXT
    );
    CREATE TABLE IF NOT EXISTS admin_change_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      change_session_id INTEGER NOT NULL REFERENCES admin_change_sessions(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      action TEXT NOT NULL,
      details_json TEXT
    );
    CREATE TABLE IF NOT EXISTS admin_rate_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL CHECK (category IN ('login', 'challenge')),
      scope TEXT NOT NULL CHECK (scope IN ('account', 'ip')),
      key_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_altcha_challenges (
      id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      account_key_hash TEXT NOT NULL,
      challenge_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx
      ON admin_sessions (expires_at, last_seen_at);
    CREATE INDEX IF NOT EXISTS admin_change_sessions_started_idx
      ON admin_change_sessions (started_at);
    CREATE INDEX IF NOT EXISTS admin_change_events_session_idx
      ON admin_change_events (change_session_id, created_at);
    CREATE INDEX IF NOT EXISTS admin_rate_lookup_idx
      ON admin_rate_events (category, scope, key_hash, created_at);
    CREATE INDEX IF NOT EXISTS admin_rate_cleanup_idx
      ON admin_rate_events (created_at);
    CREATE TABLE IF NOT EXISTS admin_user_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      username TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('created', 'password_changed', 'enabled', 'disabled', 'deleted')),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS admin_altcha_expiry_idx
      ON admin_altcha_challenges (expires_at, consumed_at);
    CREATE INDEX IF NOT EXISTS admin_user_events_lookup_idx
      ON admin_user_events (username, created_at);
    PRAGMA user_version = 6;
  `);

  migrateAdminUsersSchema(db);

  function transaction(callback) {
    const maximumAttempts = 4;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        db.exec('BEGIN IMMEDIATE');
        const result = callback();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Preserve the original transaction error.
        }
        if (!isSqliteBusy(err) || attempt === maximumAttempts) throw err;
        waitForRetry(10 * attempt);
      }
    }
    throw new Error('SQLite transaction retry limit reached.');
  }

  return {
    close: () => db.close(),
    db,
    driver,
    filePath,
    transaction,
  };
}

function migrateAdminUsersSchema(db) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'admin_users'").get();
  const columns = db.prepare('PRAGMA table_info(admin_users)').all();
  const hasDeletedAt = columns.some((column) => column.name === 'deleted_at');
  const singletonConstraint = /CHECK\s*\(\s*id\s*=\s*1\s*\)/i.test(String(table && table.sql));
  if (hasDeletedAt && !singletonConstraint) return;

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec(`
      CREATE TABLE admin_users_v6 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
        challenge_required INTEGER NOT NULL DEFAULT 0 CHECK (challenge_required IN (0, 1)),
        last_failure_at INTEGER,
        last_login_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      INSERT INTO admin_users_v6 (
        id, username, password_hash, enabled, failed_attempts, challenge_required,
        last_failure_at, last_login_at, created_at, updated_at, deleted_at
      )
      SELECT id, username, password_hash, enabled, failed_attempts, challenge_required,
        last_failure_at, last_login_at, created_at, updated_at, NULL
      FROM admin_users;
      DROP TABLE admin_users;
      ALTER TABLE admin_users_v6 RENAME TO admin_users;
    `);
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('SQLite admin user migration failed a foreign key integrity check.');
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve the migration error.
    }
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

function isSqliteBusy(err) {
  return err && (err.code === 'SQLITE_BUSY' || /database is locked/i.test(String(err.message || '')));
}

function waitForRetry(milliseconds) {
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(waitBuffer, 0, 0, milliseconds);
}

module.exports = {
  openSqliteDatabase,
};
