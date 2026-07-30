'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureAdminSecrets, readSecretFile } = require('../lib/admin-secrets');

const temporaryRoot = fs.existsSync('/tmp') ? '/tmp' : os.tmpdir();
const dataDir = fs.mkdtempSync(path.join(temporaryRoot, 'udp-airband-admin-secrets-'));
const first = ensureAdminSecrets({ crypto, dataDir, env: {}, fs, path });
assert.strictEqual(first.generated, true);
assert.match(first.env.ADMIN_AUTH_SECRET, /^[A-Za-z0-9+/]+=*$/);
assert.match(first.env.ADMIN_ALTCHA_SECRET, /^[A-Za-z0-9+/]+=*$/);
assert.notStrictEqual(first.env.ADMIN_AUTH_SECRET, first.env.ADMIN_ALTCHA_SECRET);
assert.strictEqual(fs.statSync(first.filePath).mode & 0o777, 0o600);

const second = ensureAdminSecrets({ crypto, dataDir, env: {}, fs, path });
assert.strictEqual(second.generated, false);
assert.strictEqual(second.env.ADMIN_AUTH_SECRET, first.env.ADMIN_AUTH_SECRET);
assert.strictEqual(second.env.ADMIN_ALTCHA_SECRET, first.env.ADMIN_ALTCHA_SECRET);

const override = 'x'.repeat(48);
const third = ensureAdminSecrets({
  crypto,
  dataDir,
  env: { ADMIN_AUTH_SECRET: override },
  fs,
  path,
});
assert.strictEqual(third.env.ADMIN_AUTH_SECRET, override);
assert.strictEqual(third.env.ADMIN_ALTCHA_SECRET, first.env.ADMIN_ALTCHA_SECRET);

const fileValues = readSecretFile(first.filePath, fs);
assert.strictEqual(fileValues.ADMIN_ALTCHA_SECRET, first.env.ADMIN_ALTCHA_SECRET);
console.log('admin secret bootstrap tests passed');
