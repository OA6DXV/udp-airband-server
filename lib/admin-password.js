'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);
const DEFAULT_PARAMETERS = Object.freeze({
  N: 131072,
  r: 8,
  p: 1,
  keyLength: 32,
  saltLength: 16,
  maxmem: 192 * 1024 * 1024,
});
const MAX_PASSWORD_BYTES = 1024;

function createPasswordHasher(options = {}) {
  const parameters = {
    ...DEFAULT_PARAMETERS,
    ...options,
  };
  validateParameters(parameters);

  async function hash(password) {
    const value = validatePasswordInput(password);
    const salt = crypto.randomBytes(parameters.saltLength);
    const derivedKey = await derive(value, salt, parameters);
    return encodeHash(parameters, salt, derivedKey);
  }

  async function verify(password, encodedHash) {
    const value = validatePasswordInput(password);
    const parsed = parseHash(encodedHash);
    const derivedKey = await derive(value, parsed.salt, parsed);
    return parsed.derivedKey.length === derivedKey.length
      && crypto.timingSafeEqual(parsed.derivedKey, derivedKey);
  }

  return {
    hash,
    maxPasswordBytes: MAX_PASSWORD_BYTES,
    parameters: { ...parameters },
    verify,
  };
}

function validatePasswordInput(password) {
  if (typeof password !== 'string') {
    throw inputError('Password must be a string.');
  }
  const byteLength = Buffer.byteLength(password, 'utf8');
  if (byteLength < 1 || byteLength > MAX_PASSWORD_BYTES) {
    throw inputError(`Password must be between 1 and ${MAX_PASSWORD_BYTES} UTF-8 bytes.`);
  }
  return password;
}

function encodeHash(parameters, salt, derivedKey) {
  const ln = Math.log2(parameters.N);
  return [
    'scrypt',
    `ln=${ln},r=${parameters.r},p=${parameters.p}`,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

function parseHash(value) {
  const parts = String(value || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') {
    throw new Error('Unsupported administrator password hash.');
  }
  const parameterMap = Object.fromEntries(parts[1].split(',').map((entry) => entry.split('=')));
  const ln = Number(parameterMap.ln);
  const parsed = {
    N: 2 ** ln,
    r: Number(parameterMap.r),
    p: Number(parameterMap.p),
    keyLength: Buffer.from(parts[3], 'base64url').length,
    saltLength: Buffer.from(parts[2], 'base64url').length,
    maxmem: DEFAULT_PARAMETERS.maxmem,
    salt: Buffer.from(parts[2], 'base64url'),
    derivedKey: Buffer.from(parts[3], 'base64url'),
  };
  validateParameters(parsed);
  if (parsed.salt.length < 16 || parsed.derivedKey.length < 32) {
    throw new Error('Administrator password hash parameters are invalid.');
  }
  return parsed;
}

function derive(password, salt, parameters) {
  return scryptAsync(password, salt, parameters.keyLength, {
    N: parameters.N,
    r: parameters.r,
    p: parameters.p,
    maxmem: parameters.maxmem,
  });
}

function validateParameters(parameters) {
  if (!Number.isInteger(parameters.N) || parameters.N < 1024 || (parameters.N & (parameters.N - 1)) !== 0) {
    throw new Error('scrypt N must be a power of two and at least 1024.');
  }
  for (const key of ['r', 'p', 'keyLength', 'saltLength', 'maxmem']) {
    if (!Number.isInteger(parameters[key]) || parameters[key] < 1) {
      throw new Error(`scrypt ${key} must be a positive integer.`);
    }
  }
}

function inputError(message) {
  const error = new Error(message);
  error.code = 'INVALID_PASSWORD_INPUT';
  return error;
}

module.exports = {
  createPasswordHasher,
  MAX_PASSWORD_BYTES,
};
