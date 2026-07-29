'use strict';

const { createPasswordHasher } = require('./admin-password');
const { normalizeUsername } = require('./admin-auth');

const MINIMUM_PASSWORD_LENGTH = 12;

async function createAdministrator({ database, password, passwordHasher = createPasswordHasher(), username, now = Date.now() }) {
  const normalizedUsername = validateUsername(username);
  validatePassword(password);
  const existing = findAdministrator(database.db, normalizedUsername);
  if (existing && existing.deleted_at === null) throw new Error(`Administrator "${normalizedUsername}" already exists.`);
  const passwordHash = await passwordHasher.hash(password);
  let adminId;
  database.transaction(() => {
    if (existing) {
      database.db.prepare(`
        UPDATE admin_users SET password_hash = ?, enabled = 1, failed_attempts = 0,
          challenge_required = 0, last_failure_at = NULL, last_login_at = NULL,
          created_at = ?, updated_at = ?, deleted_at = NULL
        WHERE id = ?
      `).run(passwordHash, now, now, existing.id);
      adminId = existing.id;
    } else {
      const result = database.db.prepare(`
        INSERT INTO admin_users (
          username, password_hash, enabled, failed_attempts, challenge_required,
          created_at, updated_at, deleted_at
        ) VALUES (?, ?, 1, 0, 0, ?, ?, NULL)
      `).run(normalizedUsername, passwordHash, now, now);
      adminId = Number(result.lastInsertRowid);
    }
    recordEvent(database.db, adminId, normalizedUsername, 'created', now);
  });
  return getAdministrator(database.db, normalizedUsername);
}

async function changeAdministratorPassword({ database, password, passwordHasher = createPasswordHasher(), username, now = Date.now() }) {
  const administrator = requireActiveRecord(database.db, username);
  validatePassword(password);
  const passwordHash = await passwordHasher.hash(password);
  database.transaction(() => {
    database.db.prepare(`
      UPDATE admin_users SET password_hash = ?, failed_attempts = 0,
        challenge_required = 0, last_failure_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(passwordHash, now, administrator.id);
    invalidateSessions(database.db, administrator, now, 'password_changed');
    recordEvent(database.db, administrator.id, administrator.username, 'password_changed', now);
  });
  return getAdministrator(database.db, administrator.username);
}

function setAdministratorEnabled({ database, enabled, username, now = Date.now() }) {
  const administrator = requireActiveRecord(database.db, username);
  const nextEnabled = enabled ? 1 : 0;
  database.transaction(() => {
    database.db.prepare(`
      UPDATE admin_users SET enabled = ?, failed_attempts = 0,
        challenge_required = 0, last_failure_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(nextEnabled, now, administrator.id);
    if (!nextEnabled) invalidateSessions(database.db, administrator, now, 'administrator_disabled');
    recordEvent(database.db, administrator.id, administrator.username, nextEnabled ? 'enabled' : 'disabled', now);
  });
  return getAdministrator(database.db, administrator.username);
}

function deleteAdministrator({ database, username, now = Date.now() }) {
  const administrator = requireActiveRecord(database.db, username);
  database.transaction(() => {
    database.db.prepare(`
      UPDATE admin_users SET enabled = 0, failed_attempts = 0,
        challenge_required = 0, last_failure_at = NULL, updated_at = ?, deleted_at = ?
      WHERE id = ?
    `).run(now, now, administrator.id);
    invalidateSessions(database.db, administrator, now, 'administrator_deleted');
    recordEvent(database.db, administrator.id, administrator.username, 'deleted', now);
  });
  return getAdministrator(database.db, administrator.username);
}

function listAdministrators(database) {
  return database.db.prepare(`
    SELECT id, username, enabled, created_at, updated_at, deleted_at, last_login_at
    FROM admin_users ORDER BY username COLLATE NOCASE
  `).all();
}

function getAdministrator(db, username) {
  return db.prepare(`
    SELECT id, username, enabled, created_at, updated_at, deleted_at, last_login_at
    FROM admin_users WHERE username = ? COLLATE NOCASE LIMIT 1
  `).get(username);
}

function findAdministrator(db, username) {
  return db.prepare(`
    SELECT id, username, enabled, deleted_at
    FROM admin_users WHERE username = ? COLLATE NOCASE LIMIT 1
  `).get(username);
}

function requireActiveRecord(db, username) {
  const normalizedUsername = validateUsername(username);
  const administrator = findAdministrator(db, normalizedUsername);
  if (!administrator || administrator.deleted_at !== null) throw new Error(`Administrator "${normalizedUsername}" does not exist.`);
  return administrator;
}

function validateUsername(username) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) throw new Error('Administrator username is required and must not exceed 128 UTF-8 bytes.');
  return normalizedUsername;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error(`Use a password with at least ${MINIMUM_PASSWORD_LENGTH} characters.`);
  }
}

function invalidateSessions(db, administrator, now, reason) {
  db.prepare(`
    UPDATE admin_change_sessions SET ended_at = ?, end_reason = ?
    WHERE admin_id = ? AND ended_at IS NULL
  `).run(now, reason, administrator.id);
  db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(administrator.id);
}

function recordEvent(db, adminId, username, action, now) {
  db.prepare(`
    INSERT INTO admin_user_events (admin_id, username, action, created_at)
    VALUES (?, ?, ?, ?)
  `).run(adminId, username, action, now);
}

module.exports = {
  changeAdministratorPassword,
  createAdministrator,
  deleteAdministrator,
  listAdministrators,
  setAdministratorEnabled,
};
