'use strict';

function createJsonGeoCache({ filePath, fs, logger, path }) {
  const records = loadRecords();
  let dirty = false;

  function loadRecords() {
    try {
      if (!fs.existsSync(filePath)) return new Map();
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
      return new Map(Object.entries(parsed)
        .map(([key, value]) => [key, normalizeGeoRecord(value, key)])
        .filter((entry) => entry[1]));
    } catch (err) {
      logger.warn('geo_cache_read_failed', { path: filePath, error: err.message });
      return new Map();
    }
  }

  function get(anonymizedIp) {
    const record = records.get(anonymizedIp);
    return record ? { ...record } : null;
  }

  function set(record) {
    const normalized = normalizeGeoRecord(record, record && record.anonymizedIp);
    if (!normalized) return false;
    records.set(normalized.anonymizedIp, normalized);
    dirty = true;
    return flush();
  }

  function entries() {
    return Array.from(records.values(), (record) => ({ ...record }));
  }

  function flush() {
    if (!dirty) return true;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const output = Object.fromEntries(Array.from(records, ([key, value]) => [key, value]));
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporaryPath, filePath);
      dirty = false;
      return true;
    } catch (err) {
      logger.warn('geo_cache_write_failed', { path: filePath, error: err.message });
      return false;
    }
  }

  return { entries, flush, get, set };
}

function normalizeGeoRecord(record, fallbackIp = '') {
  if (!record || typeof record !== 'object') return null;
  const anonymizedIp = String(record.anonymizedIp || fallbackIp || '').trim();
  const countryCode = String(record.countryCode || '').trim().toUpperCase();
  const country = String(record.country || '').trim();
  const city = String(record.city || '').trim();
  const lookedUpAt = Math.floor(Number(record.lookedUpAt));
  const source = String(record.source || '').trim();
  if (!anonymizedIp || !country || !city || !Number.isFinite(lookedUpAt) || lookedUpAt <= 0 || !source) {
    return null;
  }
  return { anonymizedIp, countryCode, country, city, lookedUpAt, source };
}

module.exports = {
  createJsonGeoCache,
  normalizeGeoRecord,
};
