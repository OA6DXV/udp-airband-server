'use strict';

function normalizeClientId(value, crypto) {
  const id = String(value || '').trim();
  if (/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return id;
  return crypto.randomBytes(12).toString('hex');
}

function isInternalAudioRelay(req, socket, clientId, url) {
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(socket.remoteAddress);
  const headers = req.headers || {};
  const proxied = ['forwarded', 'x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'x-forwarded-host', 'x-forwarded-proto']
    .some(header => headers[header] !== undefined);
  // Legacy mirrors already use this prefix. New local relays can opt in
  // explicitly. Requests arriving through the public proxy remain listeners.
  return loopback && !proxied && (url.searchParams.get('internal') === '1' || clientId.startsWith('opus-mirror-'));
}

module.exports = {
  normalizeClientId,
  isInternalAudioRelay,
};
