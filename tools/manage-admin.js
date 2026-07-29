#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { getSetting, loadServerConfig, parseArgs } = require('../lib/config');
const { createPasswordHasher } = require('../lib/admin-password');
const { changeAdministratorPassword, createAdministrator, deleteAdministrator, listAdministrators, setAdministratorEnabled } = require('../lib/admin-users');
const { openSqliteDatabase } = require('../lib/sqlite-database');

run().catch((err) => {
  process.stderr.write(`Administrator command failed: ${err.message}\n`);
  process.exitCode = 1;
});

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const command = resolveCommand(args);
  const serverConfigPath = args.serverConfig || args.serverConf || 'server.conf';
  const serverConfig = loadServerConfig(serverConfigPath, fs, path);
  const dataDir = path.resolve(args.dataDir || path.join(__dirname, '..', 'data'));
  const sqliteSetting = String(args.sqliteFile || getSetting(serverConfig, 'storage.sqliteFile', '') || 'localdb.sqlite').trim();
  const sqliteFile = path.isAbsolute(sqliteSetting) ? path.normalize(sqliteSetting) : path.resolve(dataDir, sqliteSetting);
  const database = openSqliteDatabase({ filePath: sqliteFile, fs, path });

  try {
    if (command.name === 'list') return printAdministrators(listAdministrators(database));
    if (command.name === 'create') {
      const result = await createAdministrator({ database, password: requirePassword(args), passwordHasher: createPasswordHasher(), username: args.createuser });
      process.stdout.write(`Created administrator "${result.username}".\n`);
      return;
    }
    if (command.name === 'password') {
      const result = await changeAdministratorPassword({ database, password: requirePassword(args), passwordHasher: createPasswordHasher(), username: args.modifyuser });
      process.stdout.write(`Updated password for administrator "${result.username}". Active sessions were closed.\n`);
      return;
    }
    if (command.name === 'enabled') {
      const result = setAdministratorEnabled({ database, enabled: command.enabled, username: args.modifyuser });
      process.stdout.write(`${command.enabled ? 'Enabled' : 'Disabled'} administrator "${result.username}".${command.enabled ? '' : ' Active sessions were closed.'}\n`);
      return;
    }
    const administrator = listAdministrators(database).find((entry) => entry.username.toLowerCase() === String(args.deleteuser).trim().toLowerCase() && entry.deleted_at === null);
    if (!administrator) throw new Error(`Administrator "${args.deleteuser}" does not exist.`);
    const answer = await askConfirmation(`Delete administrator "${administrator.username}"? This account will no longer be able to sign in. [y/N]: `);
    if (!['y', 'yes'].includes(answer.trim().toLowerCase())) {
      process.stdout.write('Administrator deletion cancelled.\n');
      return;
    }
    deleteAdministrator({ database, username: administrator.username });
    process.stdout.write(`Deleted administrator "${administrator.username}". Active sessions were closed.\n`);
  } finally {
    database.close();
  }
}

function resolveCommand(args) {
  const selected = [args.createuser !== undefined && 'create', args.modifyuser !== undefined && 'modify', args.deleteuser !== undefined && 'delete', args.listusers !== undefined && 'list'].filter(Boolean);
  if (selected.length !== 1) throw new Error('Specify exactly one user command. Run node server.js --help for examples.');
  if (selected[0] !== 'modify') return { name: selected[0] };
  if (args.password !== undefined && args.password !== true) return { name: 'password' };
  const action = positionalModifyAction(process.argv.slice(2));
  if (!['enable', 'disable'].includes(action)) throw new Error('--modifyuser requires --password PASSWORD, enable, or disable.');
  return { name: 'enabled', enabled: action === 'enable' };
}

function positionalModifyAction(argv) {
  const index = argv.findIndex((value) => value === '--modifyuser' || value.startsWith('--modifyuser='));
  if (index === -1) return '';
  const offset = argv[index].includes('=') ? 1 : 2;
  const candidate = argv[index + offset];
  return !candidate || candidate.startsWith('-') ? '' : candidate.trim().toLowerCase();
}

function requirePassword(args) {
  if (args.password === undefined || args.password === true) throw new Error('--password PASSWORD is required.');
  return String(args.password);
}

function printAdministrators(administrators) {
  if (!administrators.length) return process.stdout.write('No administrator accounts exist.\n');
  process.stdout.write('Username\tStatus\tCreated\tUpdated\tDeleted\tLast login\n');
  for (const admin of administrators) {
    const status = admin.deleted_at !== null ? 'deleted' : (admin.enabled ? 'enabled' : 'disabled');
    process.stdout.write([admin.username, status, formatTimestamp(admin.created_at), formatTimestamp(admin.updated_at), formatTimestamp(admin.deleted_at), formatTimestamp(admin.last_login_at)].join('\t') + '\n');
  }
}

function formatTimestamp(value) {
  return value === null || value === undefined ? '-' : new Date(Number(value)).toISOString();
}

function askConfirmation(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Administrator deletion requires an interactive terminal confirmation.');
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => prompt.question(question, (answer) => {
    prompt.close();
    resolve(answer);
  }));
}
