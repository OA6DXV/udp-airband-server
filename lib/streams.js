'use strict';

function loadStreams(options) {
  const { configPath, defaultUdpHost, fs, opusKeepaliveMs, path } = options;
  const configFile = path.resolve(configPath);
  if (!fs.existsSync(configFile)) {
    throw new Error(`Streams config not found: ${configPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (!Array.isArray(parsed.streams) || parsed.streams.length === 0) {
    throw new Error(`${configPath} must contain a non-empty "streams" array`);
  }
  return parsed.streams.map((stream) => normalizeStream(stream, { defaultUdpHost, opusKeepaliveMs }));
}

function normalizeStream(raw, options) {
  const { defaultUdpHost, opusKeepaliveMs } = options;
  const name = String(raw.name || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    throw new Error(`Invalid stream name "${name}". Use letters, numbers, underscores, or hyphens.`);
  }

  const udpHost = raw.udpHost || defaultUdpHost;
  const udpPort = Number(raw.udpPort);
  const sampleRate = Number(raw.sampleRate);
  const channels = Number(raw.channels);

  if (!Number.isInteger(udpPort) || udpPort < 1 || udpPort > 65535) {
    throw new Error(`Stream "${name}" has invalid udpPort`);
  }
  if (![1, 2].includes(channels)) {
    throw new Error(`Stream "${name}" channels must be 1 or 2`);
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 1000) {
    throw new Error(`Stream "${name}" sampleRate must be a positive integer`);
  }

  return {
    name,
    label: String(raw.label || name),
    udpHost,
    udpPort,
    sampleRate,
    channels,
    silenceBuffer: Buffer.alloc(Math.round(sampleRate * channels * 4 * opusKeepaliveMs / 1000)),
    controlClients: new Map(),
    rawClients: new Map(),
    opusClients: new Set(),
    hlsClients: new Map(),
    listenerStats: new Map(),
    adpcmSequence: 0,
    packetCount: 0,
    byteCount: 0,
    lastStatsByteCount: 0,
    lastStatsAt: Date.now(),
    lastUdpAt: 0,
    udpServer: null,
  };
}

function validateStreams(items) {
  const names = new Set();
  const udpInputs = new Set();

  for (const stream of items) {
    if (names.has(stream.name)) {
      throw new Error(`Duplicate stream name "${stream.name}"`);
    }
    names.add(stream.name);

    const udpInput = `${stream.udpHost}:${stream.udpPort}`;
    if (udpInputs.has(udpInput)) {
      throw new Error(`Duplicate UDP input ${udpInput}`);
    }
    udpInputs.add(udpInput);
  }
}

function renderStreamList(streams) {
  const items = streams.map((stream) => `
    <a class="stream" href="/${escapeHtml(stream.name)}">
      <strong>${escapeHtml(stream.label)}</strong>
      <span>/${escapeHtml(stream.name)} &middot; UDP ${escapeHtml(String(stream.udpPort))} &middot; ${stream.channels === 1 ? 'mono' : 'stereo'} ${stream.sampleRate} Hz</span>
    </a>
  `).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>UDP Airband Streams</title>
  <style>
    body { margin: 0; min-height: 100vh; background: #111318; color: #eef2f6; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(760px, calc(100vw - 32px)); margin: 0 auto; padding: 36px 0; }
    h1 { margin: 0 0 20px; font-size: 32px; letter-spacing: 0; }
    .stream { display: grid; gap: 6px; padding: 16px; margin-bottom: 12px; color: inherit; text-decoration: none; border: 1px solid #394451; border-radius: 8px; background: #1b2028; }
    .stream:hover { border-color: #4fb477; }
    .stream span { color: #9aa7b3; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>UDP Airband Streams</h1>
    ${items}
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

module.exports = {
  loadStreams,
  renderStreamList,
  validateStreams,
};
