'use strict';

function createLastHeardStore({ filePath, fs, path, logger, debounceMs = 1000 }) {
  const values = loadValues();
  let dirty = false;
  let timer = null;

  function loadValues() {
    try {
      if (!fs.existsSync(filePath)) return {};
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const result = {};
      for (const [name, value] of Object.entries(parsed)) {
        const timestamp = Number(value);
        if (name && Number.isFinite(timestamp) && timestamp > 0) result[name] = timestamp;
      }
      return result;
    } catch (err) {
      logger.warn('last_heard_store_read_failed', { path: filePath, error: err.message });
      return {};
    }
  }

  function apply(streams) {
    let restored = 0;
    for (const stream of streams) {
      const timestamp = Number(values[stream.name]);
      if (Number.isFinite(timestamp) && timestamp > 0) {
        stream.lastUdpAt = timestamp;
        restored += 1;
      }
    }
    if (restored > 0) logger.info('last_heard_store_loaded', { path: filePath, streams: restored });
  }

  function record(streamName, timestamp) {
    values[streamName] = timestamp;
    dirty = true;
    scheduleFlush();
  }

  function scheduleFlush() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, debounceMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function flush() {
    if (!dirty) return true;
    dirty = false;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.tmp`;
      fs.writeFileSync(tempPath, `${JSON.stringify(values, null, 2)}\n`);
      fs.renameSync(tempPath, filePath);
      return true;
    } catch (err) {
      dirty = true;
      logger.warn('last_heard_store_write_failed', { path: filePath, error: err.message });
      return false;
    }
  }

  return { apply, flush, record };
}

module.exports = { createLastHeardStore };
