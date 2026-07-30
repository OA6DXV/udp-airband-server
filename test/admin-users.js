'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPasswordHasher } = require('../lib/admin-password');
const { assessPasswordStrength, changeAdministratorPassword, createAdministrator, deleteAdministrator, listAdministrators, setAdministratorEnabled } = require('../lib/admin-users');
const { openSqliteDatabase } = require('../lib/sqlite-database');

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

function testLegacySchemaMigration() {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'udp-airband-admin-migration-test-'));
  const filePath = path.join(temporaryDir, 'legacy.sqlite');
  let Database;
  try {
    ({ DatabaseSync: Database } = require('node:sqlite'));
  } catch {
    Database = require('better-sqlite3');
  }
  const legacy = new Database(filePath);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE admin_users (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
      challenge_required INTEGER NOT NULL DEFAULT 0 CHECK (challenge_required IN (0, 1)),
      last_failure_at INTEGER,
      last_login_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE admin_sessions (
      token_hash TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    INSERT INTO admin_users (
      id, username, password_hash, enabled, failed_attempts, challenge_required, created_at, updated_at
    ) VALUES (1, 'legacy', 'hash', 1, 0, 0, 1000, 1000);
    INSERT INTO admin_sessions (token_hash, admin_id, created_at, last_seen_at, expires_at)
    VALUES ('legacy-session', 1, 1000, 1000, 2000);
  `);
  legacy.close();

  const migrated = openSqliteDatabase({ filePath, fs, path });
  try {
    const schema = migrated.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'admin_users'").get().sql;
    assert.doesNotMatch(schema, /CHECK\s*\(\s*id\s*=\s*1\s*\)/i);
    assert.ok(migrated.db.prepare('PRAGMA table_info(admin_users)').all().some((column) => column.name === 'deleted_at'));
    assert.strictEqual(migrated.db.prepare('SELECT username FROM admin_users WHERE id = 1').get().username, 'legacy');
    assert.strictEqual(migrated.db.prepare('SELECT token_hash FROM admin_sessions').get().token_hash, 'legacy-session');
    assert.deepStrictEqual(migrated.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    migrated.close();
    fs.rmSync(temporaryDir, { force: true, recursive: true });
  }
}

async function testPasswordPolicy() {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'udp-airband-admin-password-test-'));
  const database = openSqliteDatabase({ filePath: path.join(temporaryDir, 'test.sqlite'), fs, path });
  const passwordHasher = createPasswordHasher({ N: 1024, maxmem: 16 * 1024 * 1024 });
  try {
    await assert.rejects(() => createAdministrator({ database, password: '1234', passwordHasher, username: 'short' }), /at least 5 characters/);
    await createAdministrator({ database, password: '12345', passwordHasher, username: 'short-ok' });
    assert.ok(assessPasswordStrength('12345', 'short-ok').length > 0);
    assert.deepStrictEqual(assessPasswordStrength('correct horse battery staple', 'admin'), []);
  } finally {
    database.close();
    fs.rmSync(temporaryDir, { force: true, recursive: true });
  }
}

async function run() {
  testLegacySchemaMigration();
  await testPasswordPolicy();
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'udp-airband-admin-users-test-'));
  const database = openSqliteDatabase({ filePath: path.join(temporaryDir, 'test.sqlite'), fs, path });
  const passwordHasher = createPasswordHasher({ N: 1024, maxmem: 16 * 1024 * 1024 });
  let now = 2000000000000;
  try {
    await createAdministrator({ database, password: 'first password', passwordHasher, username: 'Alice', now });
    now += 1000;
    await createAdministrator({ database, password: 'second password', passwordHasher, username: 'Bob', now });
    assert.strictEqual(listAdministrators(database).length, 2);
    assert.throws(() => setAdministratorEnabled({ database, enabled: false, username: 'missing', now }), /does not exist/);
    database.db.prepare("INSERT INTO admin_sessions (token_hash, admin_id, created_at, last_seen_at, expires_at) VALUES ('token', 1, ?, ?, ?)").run(now, now, now + 10000);
    now += 1000;
    setAdministratorEnabled({ database, enabled: false, username: 'alice', now });
    assert.strictEqual(database.db.prepare('SELECT COUNT(*) AS count FROM admin_sessions').get().count, 0);
    assert.strictEqual(listAdministrators(database).find((entry) => entry.username === 'alice').enabled, 0);
    now += 1000;
    setAdministratorEnabled({ database, enabled: true, username: 'Alice', now });
    now += 1000;
    await changeAdministratorPassword({ database, password: 'changed password', passwordHasher, username: 'Alice', now });
    now += 1000;
    deleteAdministrator({ database, username: 'Bob', now });
    const bob = listAdministrators(database).find((entry) => entry.username === 'bob');
    assert.strictEqual(bob.enabled, 0);
    assert.strictEqual(bob.deleted_at, now);
    assert.throws(() => setAdministratorEnabled({ database, enabled: true, username: 'Bob', now }), /does not exist/);
    assert.strictEqual(database.db.prepare('SELECT COUNT(*) AS count FROM admin_user_events').get().count, 6);
    now += 1000;
    await createAdministrator({ database, password: 'recreated password', passwordHasher, username: 'bob', now });
    const recreated = listAdministrators(database).find((entry) => entry.username === 'bob');
    assert.strictEqual(recreated.enabled, 1);
    assert.strictEqual(recreated.deleted_at, null);
    assert.strictEqual(recreated.created_at, now);
    console.log('administrator management tests passed');
  } finally {
    database.close();
    fs.rmSync(temporaryDir, { force: true, recursive: true });
  }
}
