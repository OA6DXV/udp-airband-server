'use strict';

function ensureListenerStats(stream, clientId) {
  if (!stream.listenerStats.has(clientId)) {
    stream.listenerStats.set(clientId, {
      bytes: 0,
      lastBytes: 0,
      rawBytes: 0,
      adpcmBytes: 0,
      opusBytes: 0,
      aacBytes: 0,
      opusInputBytes: 0,
      modes: new Set(),
      connectedAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  }
  return stream.listenerStats.get(clientId);
}

function addListenerMode(stream, clientId, mode) {
  const stats = ensureListenerStats(stream, clientId);
  stats.modes.add(mode);
  stats.lastSeenAt = Date.now();
}

function removeListenerMode(stream, clientId, mode) {
  const stats = stream.listenerStats.get(clientId);
  if (!stats) return;
  stats.modes.delete(mode);
  stats.lastSeenAt = Date.now();
  if (stats.modes.size === 0) {
    stream.listenerStats.delete(clientId);
  }
}

function addListenerBytes(stream, clientId, mode, bytes) {
  const stats = ensureListenerStats(stream, clientId);
  stats.bytes += bytes;
  stats.lastSeenAt = Date.now();
  if (mode === 'raw') stats.rawBytes += bytes;
  if (mode === 'adpcm') stats.adpcmBytes += bytes;
  if (mode === 'opus') stats.opusBytes += bytes;
  if (mode === 'aac' || mode === 'hls') stats.aacBytes += bytes;
}

function getActiveListeners(stream) {
  const listeners = [];
  for (const [clientId, stats] of stream.listenerStats) {
    if (!stats.modes.size) continue;
    listeners.push({
      clientId,
      modes: Array.from(stats.modes).sort(),
      connectedAt: stats.connectedAt,
      lastSeenAt: stats.lastSeenAt,
      bytes: stats.bytes,
      rawBytes: stats.rawBytes,
      adpcmBytes: stats.adpcmBytes,
      opusBytes: stats.opusBytes,
      aacBytes: stats.aacBytes,
      opusInputBytes: stats.opusInputBytes,
    });
  }
  return listeners.sort((a, b) => a.connectedAt - b.connectedAt);
}

function pruneInactiveListeners(stream, now) {
  for (const [clientId, stats] of stream.listenerStats) {
    if (stats.modes.size === 0 || now - stats.lastSeenAt > 5 * 60 * 1000) {
      stream.listenerStats.delete(clientId);
    }
  }
}

function removeWsClient(stream, socket) {
  const controlClientId = stream.controlClients.get(socket);
  const rawClientId = stream.rawClients.get(socket);
  stream.controlClients.delete(socket);
  stream.rawClients.delete(socket);
  if (controlClientId) removeListenerMode(stream, controlClientId, 'control');
  if (rawClientId) removeListenerMode(stream, rawClientId, 'raw');
}

function getLastHeard(stream, now) {
  if (!stream.lastUdpAt) {
    return { at: 0, label: 'never', secondsSince: null };
  }

  const secondsSince = Math.max(0, Math.floor((now - stream.lastUdpAt) / 1000));
  if (secondsSince < 3) {
    return { at: stream.lastUdpAt, label: 'Now', secondsSince };
  }
  if (secondsSince < 10) {
    return { at: stream.lastUdpAt, label: `${secondsSince}s ago`, secondsSince };
  }

  return {
    at: stream.lastUdpAt,
    label: formatServerTime(stream.lastUdpAt),
    secondsSince,
  };
}

function formatServerTime(timestamp) {
  const date = new Date(timestamp);
  return [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join(':');
}

module.exports = {
  addListenerBytes,
  addListenerMode,
  ensureListenerStats,
  getActiveListeners,
  getLastHeard,
  pruneInactiveListeners,
  removeListenerMode,
  removeWsClient,
};
