'use strict';

const { openSqliteDatabase } = require('./sqlite-database');
const { createSqliteGeoCache, createSqliteLastHeardStore, createSqliteUserHistory } = require('./sqlite-stores');

function createStorage({ fs, logger, path, sqliteFile }) {
  const database = openSqliteDatabase({ filePath: sqliteFile, fs, path });
  logger.info('storage_sqlite_opened', { path: sqliteFile, driver: database.driver });
  return {
    backend: 'sqlite',
    close: () => database.close(),
    createGeoCache: () => createSqliteGeoCache({ database, logger }),
    createLastHeardStore: () => createSqliteLastHeardStore({ database, logger }),
    createUserHistory: () => createSqliteUserHistory({ database, logger }),
    database,
    sqliteFile,
  };
}

module.exports = {
  createStorage,
};
