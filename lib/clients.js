'use strict';

function normalizeClientId(value, crypto) {
  const id = String(value || '').trim();
  if (/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return id;
  return crypto.randomBytes(12).toString('hex');
}

module.exports = {
  normalizeClientId,
};
