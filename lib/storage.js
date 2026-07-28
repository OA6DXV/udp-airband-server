'use strict';

const { createLastHeardStore } = require('./last-heard-store');
const { createJsonGeoCache } = require('./geo-cache');
const { openSqliteDatabase } = require('./sqlite-database');
const { createSqliteGeoCache, createSqliteLastHeardStore, createSqliteUserHistory } = require('./sqlite-stores');
const { createUserHistory } = require('./user-history');

const STORAGE_BACKENDS = new Set(['json', 'sqlite']);

function normalizeStorageBackend(value) {
  const backend = String(value || '').trim().toLowerCase();
  if (!STORAGE_BACKENDS.has(backend)) {
    throw new Error('Storage backend must be one of: json, sqlite');
  }
  return backend;
}

function createStorage({ backend, dataDir, fs, logger, path, sqliteFile }) {
  const normalizedBackend = normalizeStorageBackend(backend);
  const jsonPaths = {
    geoCache: path.join(dataDir, 'geo-cache.json'),
    lastHeard: path.join(dataDir, 'last-heard.json'),
    userHistory: path.join(dataDir, 'user-history.json'),
  };

  if (normalizedBackend === 'json') {
    return {
      backend: normalizedBackend,
      close: () => {},
      createGeoCache: () => createJsonGeoCache({
        filePath: jsonPaths.geoCache,
        fs,
        logger,
        path,
      }),
      createLastHeardStore: () => createLastHeardStore({
        filePath: jsonPaths.lastHeard,
        fs,
        logger,
        path,
      }),
      createUserHistory: () => createUserHistory({
        filePath: jsonPaths.userHistory,
        fs,
        logger,
        path,
      }),
      jsonPaths,
      sqliteFile,
    };
  }

  const database = openSqliteDatabase({ filePath: sqliteFile, fs, path });
  logger.info('storage_sqlite_opened', { path: sqliteFile, driver: database.driver });
  return {
    backend: normalizedBackend,
    close: () => database.close(),
    createGeoCache: () => createSqliteGeoCache({ database, logger }),
    createLastHeardStore: () => createSqliteLastHeardStore({ database, logger }),
    createUserHistory: () => createSqliteUserHistory({ database, logger }),
    database,
    jsonPaths,
    sqliteFile,
  };
}

module.exports = {
  createStorage,
  normalizeStorageBackend,
  STORAGE_BACKENDS,
};
