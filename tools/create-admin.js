#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { loadServerConfig, getSetting, parseArgs } = require('../lib/config');
const { createPasswordHasher } = require('../lib/admin-password');
const { upsertAdministrator } = require('../lib/admin-auth');
const { openSqliteDatabase } = require('../lib/sqlite-database');

run().catch((err) => {
  process.stderr.write(`Administrator setup failed: ${err.message}\n`);
  process.exitCode = 1;
});

async function run() {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Run this command in an interactive terminal so the password can be entered without echo.');
  }
  const args = parseArgs(process.argv.slice(2));
  const serverConfigPath = args.serverConfig || args.serverConf || 'server.conf';
  const serverConfig = loadServerConfig(serverConfigPath, fs, path);
  const dataDir = path.resolve(args.dataDir || path.join(__dirname, '..', 'data'));
  const sqliteSetting = String(
    args.sqliteFile || getSetting(serverConfig, 'storage.sqliteFile', '') || 'localdb.sqlite',
  ).trim();
  const sqliteFile = path.isAbsolute(sqliteSetting)
    ? path.normalize(sqliteSetting)
    : path.resolve(dataDir, sqliteSetting);
  const database = openSqliteDatabase({ filePath: sqliteFile, fs, path });

  try {
    const existing = database.db.prepare('SELECT username FROM admin_users WHERE id = 1').get();
    if (existing) {
      const confirmed = await askVisible(
        `Administrator "${existing.username}" already exists. Replace its credentials? [y/N]: `,
      );
      if (!['y', 'yes'].includes(confirmed.trim().toLowerCase())) {
        process.stdout.write('Administrator setup cancelled.\n');
        return;
      }
    }

    const usernameAnswer = await askVisible(
      existing ? `Username [${existing.username}]: ` : 'Username: ',
    );
    const username = usernameAnswer.trim() || (existing && String(existing.username)) || '';
    const password = await askHidden('Password: ');
    const confirmation = await askHidden('Confirm password: ');
    if (password !== confirmation) throw new Error('Passwords do not match.');
    if (password.length < 12) throw new Error('Use a password with at least 12 characters.');

    const result = await upsertAdministrator({
      database,
      password,
      passwordHasher: createPasswordHasher(),
      username,
    });
    process.stdout.write(
      `${result.created ? 'Created' : 'Updated'} the single administrator "${result.username}". Existing sessions were invalidated.\n`,
    );
    process.stdout.write(`SQLite database: ${sqliteFile}\n`);
  } finally {
    database.close();
  }
}

function askVisible(question) {
  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  return new Promise((resolve) => {
    prompt.question(question, (answer) => {
      prompt.close();
      resolve(answer);
    });
  });
}

function askHidden(question) {
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    function finish(err) {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (err) reject(err);
      else resolve(value);
    }

    function onData(chunk) {
      for (const character of chunk) {
        if (character === '\u0003') return finish(new Error('Administrator setup cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    }

    process.stdin.on('data', onData);
  });
}
