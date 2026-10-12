'use strict';

// One-time export only: normal server startup never consults the legacy layout tables.
const fs = require('node:fs');
const path = require('node:path');
const { openSqliteDatabase } = require('../lib/sqlite-database');
const { loadStreamsFromConfig, validateStreams } = require('../lib/streams');

function exportStreamLayout(configPath, databasePath) {
  const original = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(original);
  if (config.sections !== undefined) throw new Error('This file already defines sections; export refused.');
  if (!fs.existsSync(databasePath)) throw new Error('Legacy database does not exist.');
  const database = openSqliteDatabase({ filePath: databasePath, fs, path });
  let sections;
  let layout;
  try {
    database.transaction(() => {
      sections = database.db.prepare('SELECT id, name FROM stream_sections ORDER BY sort_order, name COLLATE NOCASE').all();
      layout = database.db.prepare('SELECT stream_name, section_id FROM stream_layout ORDER BY sort_order, stream_name COLLATE NOCASE').all();
    });
  } finally {
    database.close();
  }
  const usedIds = new Set();
  const idMap = new Map();
  sections = sections.map((section) => {
    const readable = section.name.replace(/Feeder$/i, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    const id = readable && !usedIds.has(readable) ? readable : section.id;
    if (usedIds.has(id)) throw new Error('Section ID collision during export.');
    usedIds.add(id);
    idMap.set(section.id, id);
    return { id, name: section.name };
  });
  const byName = new Map(config.streams.map((stream) => [stream.name, stream]));
  const ordered = [];
  for (const item of layout) {
    const stream = byName.get(item.stream_name);
    if (!stream) continue;
    const sectionId = idMap.get(item.section_id);
    ordered.push({ ...stream, ...(sectionId ? { sectionId } : {}) });
    byName.delete(item.stream_name);
  }
  ordered.push(...byName.values());
  const exported = { ...config, sections, streams: ordered };
  validateStreams(loadStreamsFromConfig(exported, { configPath, defaultUdpHost: '0.0.0.0' }));
  if (fs.readFileSync(configPath, 'utf8') !== original) throw new Error('Configuration changed during export; retry.');
  const backupPath = `${configPath}.before-layout-export-${Date.now()}`;
  fs.writeFileSync(backupPath, original, { flag: 'wx', mode: 0o600 });
  const temporaryPath = `${configPath}.layout-export-${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(exported, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (fs.readFileSync(configPath, 'utf8') !== original) throw new Error('Configuration changed before save; export aborted.');
    fs.renameSync(temporaryPath, configPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
  return { backupPath, sections: sections.length, streams: ordered.length };
}

if (require.main === module) {
  try {
    const [configPath, databasePath] = process.argv.slice(2);
    if (!configPath || !databasePath) throw new Error('Usage: node tools/export-stream-layout.js /path/streams.json /path/localdb.sqlite');
    console.log(JSON.stringify(exportStreamLayout(path.resolve(configPath), path.resolve(databasePath))));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { exportStreamLayout };
