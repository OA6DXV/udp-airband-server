'use strict';

const { openSqliteDatabase } = require('./sqlite-database');
const { normalizeGeoRecord } = require('./geo-cache');
const { normalizeStorageBackend } = require('./storage');

function migrateStorage({ dataDir, fs, logger, path, sqliteFile, target }) {
  const targetBackend = normalizeStorageBackend(target);
  const sourceBackend = targetBackend === 'sqlite' ? 'json' : 'sqlite';
  const jsonPaths = {
    geoCache: path.join(dataDir, 'geo-cache.json'),
    lastHeard: path.join(dataDir, 'last-heard.json'),
    userHistory: path.join(dataDir, 'user-history.json'),
  };

  if (sourceBackend === 'json') {
    if (!fs.existsSync(jsonPaths.userHistory)
      && !fs.existsSync(jsonPaths.lastHeard)
      && !fs.existsSync(jsonPaths.geoCache)) {
      throw new Error(`No JSON storage files were found in ${dataDir}`);
    }
    const source = readJsonStorage(jsonPaths, fs);
    const database = openSqliteDatabase({ filePath: sqliteFile, fs, path });
    try {
      const result = mergeIntoSqlite(database, source);
      logger.info('storage_migration_complete', {
        from: sourceBackend,
        to: targetBackend,
        userHistory: result.userHistory,
        lastHeard: result.lastHeard,
        geoCache: result.geoCache,
        destination: sqliteFile,
      });
      return result;
    } finally {
      database.close();
    }
  }

  if (!fs.existsSync(sqliteFile)) {
    throw new Error(`SQLite database not found: ${sqliteFile}`);
  }
  const database = openSqliteDatabase({ filePath: sqliteFile, fs, path });
  let source;
  try {
    source = readSqliteStorage(database);
  } finally {
    database.close();
  }
  const merged = mergeStorageData(readJsonStorage(jsonPaths, fs), source);
  writeJsonStorage(jsonPaths, merged, fs, path);
  logger.info('storage_migration_complete', {
    from: sourceBackend,
    to: targetBackend,
    userHistory: merged.userHistory.length,
    lastHeard: Object.keys(merged.lastHeard).length,
    geoCache: Object.keys(merged.geoCache).length,
    destination: dataDir,
  });
  return {
    lastHeard: Object.keys(merged.lastHeard).length,
    userHistory: merged.userHistory.length,
    geoCache: Object.keys(merged.geoCache).length,
  };
}

function readJsonStorage(jsonPaths, fs) {
  return {
    geoCache: readGeoCacheJson(jsonPaths.geoCache, fs),
    lastHeard: readLastHeardJson(jsonPaths.lastHeard, fs),
    userHistory: readUserHistoryJson(jsonPaths.userHistory, fs),
  };
}

function readGeoCacheJson(filePath, fs) {
  if (!fs.existsSync(filePath)) return {};
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid geo cache JSON: ${filePath}`);
  }
  const records = {};
  for (const [key, value] of Object.entries(parsed)) {
    const normalized = normalizeGeoRecord(value, key);
    if (normalized) records[normalized.anonymizedIp] = normalized;
  }
  return records;
}

function readLastHeardJson(filePath, fs) {
  if (!fs.existsSync(filePath)) return {};
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid last heard JSON: ${filePath}`);
  }
  const values = {};
  for (const [name, value] of Object.entries(parsed)) {
    const timestamp = Number(value);
    if (name && Number.isFinite(timestamp) && timestamp > 0) values[name] = Math.floor(timestamp);
  }
  return values;
}

function readUserHistoryJson(filePath, fs) {
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`Invalid user history JSON: ${filePath}`);
  return normalizeUserHistory(parsed);
}

function readSqliteStorage(database) {
  return {
    geoCache: Object.fromEntries(database.db.prepare(`
      SELECT anonymized_ip, country_code, country, city, looked_up_at, source FROM geo_cache
    `).all().map((row) => [String(row.anonymized_ip), {
      anonymizedIp: String(row.anonymized_ip),
      countryCode: String(row.country_code),
      country: String(row.country),
      city: String(row.city),
      lookedUpAt: Number(row.looked_up_at),
      source: String(row.source),
    }])),
    lastHeard: Object.fromEntries(database.db.prepare(
      'SELECT stream_name, last_heard_at FROM last_heard',
    ).all().map((row) => [String(row.stream_name), Number(row.last_heard_at)])),
    userHistory: database.db.prepare(
      'SELECT at, count FROM user_history ORDER BY at ASC',
    ).all().map((row) => ({ at: Number(row.at), count: Number(row.count) })),
  };
}

function mergeIntoSqlite(database, source) {
  const insertHistory = database.db.prepare(`
    INSERT INTO user_history (at, count) VALUES (?, ?)
    ON CONFLICT(at) DO UPDATE SET count = MAX(user_history.count, excluded.count)
  `);
  const insertLastHeard = database.db.prepare(`
    INSERT INTO last_heard (stream_name, last_heard_at) VALUES (?, ?)
    ON CONFLICT(stream_name) DO UPDATE SET last_heard_at = MAX(last_heard.last_heard_at, excluded.last_heard_at)
  `);
  const insertGeoCache = database.db.prepare(`
    INSERT INTO geo_cache (anonymized_ip, country_code, country, city, looked_up_at, source)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(anonymized_ip) DO UPDATE SET
      country_code = CASE WHEN excluded.looked_up_at >= geo_cache.looked_up_at THEN excluded.country_code ELSE geo_cache.country_code END,
      country = CASE WHEN excluded.looked_up_at >= geo_cache.looked_up_at THEN excluded.country ELSE geo_cache.country END,
      city = CASE WHEN excluded.looked_up_at >= geo_cache.looked_up_at THEN excluded.city ELSE geo_cache.city END,
      looked_up_at = MAX(geo_cache.looked_up_at, excluded.looked_up_at),
      source = CASE WHEN excluded.looked_up_at >= geo_cache.looked_up_at THEN excluded.source ELSE geo_cache.source END
  `);

  database.transaction(() => {
    for (const point of normalizeUserHistory(source.userHistory)) {
      insertHistory.run(point.at, point.count);
    }
    for (const [name, timestamp] of Object.entries(source.lastHeard)) {
      insertLastHeard.run(name, timestamp);
    }
    for (const record of Object.values(source.geoCache || {})) {
      const normalized = normalizeGeoRecord(record, record && record.anonymizedIp);
      if (normalized) {
        insertGeoCache.run(
          normalized.anonymizedIp,
          normalized.countryCode,
          normalized.country,
          normalized.city,
          normalized.lookedUpAt,
          normalized.source,
        );
      }
    }
  });

  return {
    geoCache: Number(database.db.prepare('SELECT COUNT(*) AS count FROM geo_cache').get().count),
    lastHeard: Number(database.db.prepare('SELECT COUNT(*) AS count FROM last_heard').get().count),
    userHistory: Number(database.db.prepare('SELECT COUNT(*) AS count FROM user_history').get().count),
  };
}

function mergeStorageData(current, incoming) {
  const historyByTime = new Map();
  for (const point of [...normalizeUserHistory(current.userHistory), ...normalizeUserHistory(incoming.userHistory)]) {
    historyByTime.set(point.at, Math.max(point.count, historyByTime.get(point.at) || 0));
  }
  const lastHeard = { ...current.lastHeard };
  for (const [name, timestamp] of Object.entries(incoming.lastHeard)) {
    lastHeard[name] = Math.max(Number(lastHeard[name]) || 0, Number(timestamp));
  }
  const geoCache = { ...(current.geoCache || {}) };
  for (const [key, record] of Object.entries(incoming.geoCache || {})) {
    const normalized = normalizeGeoRecord(record, key);
    const currentRecord = normalizeGeoRecord(geoCache[key], key);
    if (normalized && (!currentRecord || normalized.lookedUpAt >= currentRecord.lookedUpAt)) {
      geoCache[key] = normalized;
    }
  }
  return {
    geoCache,
    lastHeard,
    userHistory: Array.from(historyByTime, ([at, count]) => ({ at, count })).sort((a, b) => a.at - b.at),
  };
}

function normalizeUserHistory(points) {
  return points
    .filter((point) => point && Number.isFinite(Number(point.at)) && Number.isFinite(Number(point.count)))
    .map((point) => ({
      at: Math.floor(Number(point.at)),
      count: Math.max(0, Math.floor(Number(point.count))),
    }))
    .sort((a, b) => a.at - b.at);
}

function writeJsonStorage(jsonPaths, data, fs, path) {
  fs.mkdirSync(path.dirname(jsonPaths.userHistory), { recursive: true });
  writeAtomic(jsonPaths.userHistory, `${JSON.stringify(data.userHistory)}\n`, fs);
  writeAtomic(jsonPaths.lastHeard, `${JSON.stringify(data.lastHeard, null, 2)}\n`, fs);
  writeAtomic(jsonPaths.geoCache, `${JSON.stringify(data.geoCache || {}, null, 2)}\n`, fs);
}

function writeAtomic(filePath, content, fs) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, content, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

module.exports = {
  mergeStorageData,
  migrateStorage,
  readJsonStorage,
  readSqliteStorage,
};
