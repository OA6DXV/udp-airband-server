'use strict';

function createSqliteUserHistory({
  database,
  logger,
  retentionMs = 12 * 60 * 60 * 1000,
  sampleMs = 60 * 1000,
}) {
  const { db, filePath, transaction } = database;
  const latestStatement = db.prepare('SELECT at, count FROM user_history ORDER BY at DESC LIMIT 1');
  const deletePointStatement = db.prepare('DELETE FROM user_history WHERE at = ?');
  const insertStatement = db.prepare(`
    INSERT INTO user_history (at, count) VALUES (?, ?)
    ON CONFLICT(at) DO UPDATE SET count = excluded.count
  `);
  const pruneStatement = db.prepare('DELETE FROM user_history WHERE at < ?');
  const snapshotStatement = db.prepare('SELECT at, count FROM user_history WHERE at >= ? ORDER BY at ASC');

  prune(Date.now());

  function record(count, at = Date.now()) {
    const point = {
      at: Math.floor(at),
      count: Math.max(0, Math.floor(Number(count) || 0)),
    };
    try {
      transaction(() => {
        const last = latestStatement.get();
        if (last && point.at - Number(last.at) < sampleMs) {
          deletePointStatement.run(last.at);
        }
        insertStatement.run(point.at, point.count);
        pruneStatement.run(point.at - retentionMs);
      });
    } catch (err) {
      if (logger) logger.warn('user_history_save_failed', { path: filePath, error: err.message });
    }
  }

  function snapshot(since = Date.now() - 12 * 60 * 60 * 1000) {
    try {
      return snapshotStatement.all(Math.floor(since)).map((point) => ({
        at: Number(point.at),
        count: Number(point.count),
      }));
    } catch (err) {
      if (logger) logger.warn('user_history_load_failed', { path: filePath, error: err.message });
      return [];
    }
  }

  function prune(now = Date.now()) {
    try {
      pruneStatement.run(Math.floor(now - retentionMs));
    } catch (err) {
      if (logger) logger.warn('user_history_prune_failed', { path: filePath, error: err.message });
    }
  }

  return {
    flush: () => true,
    record,
    snapshot,
  };
}

function createSqliteLastHeardStore({ database, logger, debounceMs = 1000 }) {
  const { db, filePath, transaction } = database;
  const values = new Map();
  const dirtyNames = new Set();
  const loadStatement = db.prepare('SELECT stream_name, last_heard_at FROM last_heard');
  const upsertStatement = db.prepare(`
    INSERT INTO last_heard (stream_name, last_heard_at) VALUES (?, ?)
    ON CONFLICT(stream_name) DO UPDATE SET last_heard_at = excluded.last_heard_at
  `);
  let timer = null;

  try {
    for (const row of loadStatement.all()) {
      values.set(String(row.stream_name), Number(row.last_heard_at));
    }
  } catch (err) {
    logger.warn('last_heard_store_read_failed', { path: filePath, error: err.message });
  }

  function apply(streams) {
    let restored = 0;
    for (const stream of streams) {
      const timestamp = Number(values.get(stream.name));
      if (Number.isFinite(timestamp) && timestamp > 0) {
        stream.lastUdpAt = timestamp;
        restored += 1;
      }
    }
    if (restored > 0) logger.info('last_heard_store_loaded', { path: filePath, streams: restored });
  }

  function record(streamName, timestamp) {
    values.set(streamName, timestamp);
    dirtyNames.add(streamName);
    scheduleFlush();
  }

  function scheduleFlush() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, debounceMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function flush() {
    if (!dirtyNames.size) return true;
    const pending = Array.from(dirtyNames, (name) => [name, values.get(name)]);
    try {
      transaction(() => {
        for (const [name, timestamp] of pending) {
          upsertStatement.run(name, timestamp);
        }
      });
      for (const [name] of pending) dirtyNames.delete(name);
      return true;
    } catch (err) {
      logger.warn('last_heard_store_write_failed', { path: filePath, error: err.message });
      return false;
    }
  }

  return { apply, flush, record };
}

module.exports = {
  createSqliteLastHeardStore,
  createSqliteUserHistory,
};
