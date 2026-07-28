'use strict';

const { classifyAddress } = require('./ip-privacy');
const { lookupIpwhois } = require('./ipwhois');

function createGeoService({
  cache,
  enabled = false,
  logger,
  lookup = lookupIpwhois,
  now = Date.now,
  timeoutMs = 1500,
  ttlMs = 30 * 24 * 60 * 60 * 1000,
}) {
  const inflight = new Map();
  const retryAfter = new Map();
  let rateLimitedUntil = 0;

  function safeAddress(address) {
    return classifyAddress(address).anonymized;
  }

  function observe(address) {
    const classified = classifyAddress(address);
    if (!classified.normalized || !classified.anonymized) return Promise.resolve(null);
    const cached = cache.get(classified.anonymized);
    if (!enabled) return Promise.resolve(cached);

    if (classified.isLocal) {
      if (cached && cached.source === 'local') return Promise.resolve(cached);
      const local = {
        anonymizedIp: classified.anonymized,
        country: 'Local IP',
        city: 'Local IP',
        lookedUpAt: now(),
        source: 'local',
      };
      cache.set(local);
      return Promise.resolve(local);
    }

    if (cached && now() - cached.lookedUpAt < ttlMs) return Promise.resolve(cached);
    if (inflight.has(classified.anonymized)) return inflight.get(classified.anonymized);
    if (now() < rateLimitedUntil) return Promise.resolve(cached);
    if (now() < (retryAfter.get(classified.anonymized) || 0)) return Promise.resolve(cached);

    const pending = lookup(classified.normalized, { timeoutMs })
      .then((location) => {
        const record = {
          anonymizedIp: classified.anonymized,
          country: location.country,
          city: location.city,
          lookedUpAt: now(),
          source: 'ipwhois',
        };
        cache.set(record);
        retryAfter.delete(classified.anonymized);
        logger.debug('geo_cache_updated', {
          remote: classified.anonymized,
          country: record.country,
          city: record.city,
        });
        return record;
      })
      .catch((err) => {
        if (err && err.statusCode === 429) {
          rateLimitedUntil = now() + 15 * 60 * 1000;
          logger.warn('geo_rate_limited', { provider: 'ipwhois', retryAfterSec: 900 });
        } else {
          retryAfter.set(classified.anonymized, now() + 5 * 60 * 1000);
          logger.debug('geo_lookup_failed', {
            remote: classified.anonymized,
            provider: 'ipwhois',
            status: Number(err && err.statusCode) || undefined,
            reason: err && err.code ? String(err.code) : 'request_failed',
          });
        }
        return cached || {
          anonymizedIp: classified.anonymized,
          country: 'Unknown',
          city: 'Unknown',
          lookedUpAt: now(),
          source: 'unknown',
        };
      })
      .finally(() => inflight.delete(classified.anonymized));
    inflight.set(classified.anonymized, pending);
    return pending;
  }

  return {
    observe,
    safeAddress,
  };
}

module.exports = {
  createGeoService,
};
