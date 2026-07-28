'use strict';

const { openSqliteDatabase } = require('./sqlite-database');
const { normalizeGeoRecord } = require('./geo-cache');

function getLegacyJsonPaths(dataDir, path) {
  return {
    geoCache: path.join(dataDir, 'geo-cache.json'),
    lastHeard: path.join(dataDir, 'last-heard.json'),
    userHistory: path.join(dataDir, 'user-history.json'),
  };
}

function findLegacyJsonFiles({ dataDir, fs, path }) {
  return Object.values(getLegacyJsonPaths(dataDir, path)).filter((filePath) => fs.existsSync(filePath));
}

function migrateStorage({ dataDir, fs, logger, path, sqliteFile }) {
  const jsonPaths = getLegacyJsonPaths(dataDir, path);
  const legacyFiles = findLegacyJsonFiles({ dataDir, fs, path });
  if (!legacyFiles.length) {
    throw new Error(`No legacy JSON storage files were found in ${dataDir}`);
  }

  const source = readJsonStorage(jsonPaths, fs);
  const database = openSqliteDatabase({ filePath: sqliteFile, fs, path });
  let result;
  try {
    result = mergeIntoSqlite(database, source);
  } finally {
    database.close();
  }

  const backupDir = archiveLegacyJsonFiles({ dataDir, files: legacyFiles, fs, path });
  logger.info('storage_migration_complete', {
    from: 'json',
    to: 'sqlite',
    userHistory: result.userHistory,
    lastHeard: result.lastHeard,
    geoCache: result.geoCache,
    destination: sqliteFile,
    jsonBackup: backupDir,
  });
  return { ...result, backupDir };
}

function archiveLegacyJsonFiles({ dataDir, files, fs, path }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(dataDir, 'legacy-json-backups', timestamp);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const filePath of files) {
    fs.renameSync(filePath, path.join(backupDir, path.basename(filePath)));
  }
  return backupDir;
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

function normalizeUserHistory(points) {
  return points
    .filter((point) => point && Number.isFinite(Number(point.at)) && Number.isFinite(Number(point.count)))
    .map((point) => ({
      at: Math.floor(Number(point.at)),
      count: Math.max(0, Math.floor(Number(point.count))),
    }))
    .sort((a, b) => a.at - b.at);
}

module.exports = {
  findLegacyJsonFiles,
  getLegacyJsonPaths,
  migrateStorage,
  readJsonStorage,
};
