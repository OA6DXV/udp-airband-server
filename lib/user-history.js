'use strict';

function createUserHistory(options) {
  const {
    filePath,
    fs,
    logger,
    path,
    retentionMs = 12 * 60 * 60 * 1000,
    sampleMs = 60 * 1000,
  } = options;

  let points = load();
  let flushTimer = null;

  function load() {
    try {
      if (!fs.existsSync(filePath)) return [];
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      const cutoff = Date.now() - retentionMs;
      return parsed
        .filter((point) => point && Number.isFinite(point.at) && Number.isFinite(point.count) && point.at >= cutoff)
        .map((point) => ({ at: Math.floor(point.at), count: Math.max(0, Math.floor(point.count)) }))
        .sort((a, b) => a.at - b.at);
    } catch (err) {
      if (logger) logger.warn('user_history_load_failed', { path: filePath, error: err.message });
      return [];
    }
  }

  function record(count, at = Date.now()) {
    const point = { at: Math.floor(at), count: Math.max(0, Math.floor(Number(count) || 0)) };
    const last = points[points.length - 1];
    if (last && point.at - last.at < sampleMs) {
      last.at = point.at;
      last.count = point.count;
    } else {
      points.push(point);
    }
    prune(point.at);
    scheduleFlush();
  }

  function snapshot(since = Date.now() - 12 * 60 * 60 * 1000) {
    return points.filter((point) => point.at >= since).map((point) => ({ ...point }));
  }

  function prune(now = Date.now()) {
    const cutoff = now - retentionMs;
    const firstValid = points.findIndex((point) => point.at >= cutoff);
    if (firstValid > 0) points = points.slice(firstValid);
    if (firstValid === -1 && points.length) points = [];
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 1000);
    if (typeof flushTimer.unref === 'function') flushTimer.unref();
  }

  function flush() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify(points)}\n`, { mode: 0o600 });
      fs.renameSync(temporaryPath, filePath);
    } catch (err) {
      if (logger) logger.warn('user_history_save_failed', { path: filePath, error: err.message });
    }
  }

  return {
    flush,
    record,
    snapshot,
  };
}

module.exports = {
  createUserHistory,
};
