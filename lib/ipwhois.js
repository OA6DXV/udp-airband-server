'use strict';

const https = require('https');

function lookupIpwhois(address, { timeoutMs = 1500 } = {}) {
  const fields = 'success,message,country,country_code,city';
  const requestPath = `/${encodeURIComponent(address)}?fields=${encodeURIComponent(fields)}`;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'ipwho.is',
      method: 'GET',
      path: requestPath,
      headers: {
        accept: 'application/json',
        'user-agent': 'udp-airband-server',
      },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 64 * 1024) {
          req.destroy(new Error('ipwhois response exceeded 64 KiB'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          reject(createLookupError('ipwhois returned invalid JSON', res.statusCode));
          return;
        }
        if (res.statusCode === 429) {
          reject(createLookupError('ipwhois rate limit reached', 429));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300 || body.success !== true) {
          reject(createLookupError(body.message || `ipwhois HTTP ${res.statusCode}`, res.statusCode));
          return;
        }
        const countryCode = String(body.country_code || '').trim().toUpperCase();
        const country = String(body.country || '').trim();
        const city = String(body.city || '').trim();
        if (!country || !city) {
          reject(createLookupError('ipwhois response is missing country or city', res.statusCode));
          return;
        }
        resolve({ countryCode, country, city });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(createLookupError('ipwhois request timed out', 408)));
    req.on('error', reject);
    req.end();
  });
}

function createLookupError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  lookupIpwhois,
};
