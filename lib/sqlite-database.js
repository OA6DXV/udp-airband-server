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
        'SQLite storage requires Node.js with node:sqlite or the optional better-sqlite3 package. Run npm install before enabling SQLite.',
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
    PRAGMA user_version = 3;
  `);

  function transaction(callback) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Preserve the original transaction error.
      }
      throw err;
    }
  }

  return {
    close: () => db.close(),
    db,
    driver,
    filePath,
    transaction,
  };
}

module.exports = {
  openSqliteDatabase,
};
