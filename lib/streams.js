'use strict';

const DEFAULT_STREAMS = [
  {
    name: 'test',
    label: 'Testing UDP Input',
    udpPort: 8690,
    sampleRate: 8000,
    channels: 1,
  },
];

function loadStreams(options) {
  const { configPath, defaultUdpHost, fs, opusKeepaliveMs, path } = options;
  const configFile = path.resolve(configPath);
  const parsed = fs.existsSync(configFile)
    ? JSON.parse(fs.readFileSync(configFile, 'utf8'))
    : { streams: DEFAULT_STREAMS };

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
    adpcmState: null,
    adpcmFilterState: null,
    adpcmLastInputAt: 0,
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

function renderStreamList(streams, options = {}) {
  const softwareVersion = options.softwareVersion || '';
  const items = streams.map((stream) => `
    <a class="stream" href="/${escapeHtml(stream.name)}" data-stream="${escapeHtml(stream.name)}">
      <span class="stream-main">
        <strong>${escapeHtml(stream.label)}</strong>
        <span class="stream-meta">/${escapeHtml(stream.name)} &middot; ${stream.channels === 1 ? 'mono' : 'stereo'} ${stream.sampleRate} Hz</span>
      </span>
      <span class="stream-last"><span data-label="lastTransmission">Last Transmission</span>: <strong data-last="${escapeHtml(stream.name)}">never</strong></span>
    </a>
  `).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Real-time Airband audio streams</title>
  <link rel="icon" href="/assets/favicon.ico" sizes="any">
  <style>
    body { margin: 0; min-height: 100vh; background: #111318; color: #eef2f6; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(860px, calc(100vw - 32px)); margin: 0 auto; padding: 36px 0; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: 32px; letter-spacing: 0; }
    .header-tools { display: inline-flex; align-items: center; gap: 10px; }
    .active-users, .language-button { height: 36px; border: 1px solid #394451; border-radius: 8px; background: #1b2028; color: #9aa7b3; }
    .active-users { min-width: 78px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; font-size: 14px; }
    .active-users strong { color: #eef2f6; font-size: 15px; line-height: 1; }
    .language-switch { position: relative; }
    .language-button { min-width: 66px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 10px; font: inherit; font-size: 14px; font-weight: 650; cursor: pointer; }
    .caret { width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid #9aa7b3; }
    .language-menu { position: absolute; top: calc(100% + 8px); right: 0; z-index: 5; width: 190px; border: 1px solid #394451; border-radius: 8px; background: #f8fafc; color: #1f2933; box-shadow: 0 14px 28px rgb(0 0 0 / 32%); overflow: visible; }
    .language-menu::before { content: ""; position: absolute; top: -7px; right: 18px; width: 12px; height: 12px; background: #f8fafc; border-left: 1px solid #394451; border-top: 1px solid #394451; transform: rotate(45deg); }
    .language-option { width: 100%; height: 48px; display: flex; align-items: center; gap: 12px; border: 0; background: transparent; color: inherit; padding: 0 16px; font: inherit; font-weight: 600; text-align: left; cursor: pointer; }
    .language-option + .language-option { border-top: 1px solid #e2e8f0; }
    .language-radio { width: 18px; height: 18px; border: 2px solid #b7c0cc; border-radius: 50%; flex: 0 0 auto; }
    .language-option.active .language-radio { border-color: #4fb477; box-shadow: inset 0 0 0 4px #f8fafc; background: #4fb477; }
    .stream { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 16px; padding: 16px; margin-bottom: 12px; color: inherit; text-decoration: none; border: 1px solid #394451; border-radius: 8px; background: #1b2028; }
    .stream:hover { border-color: #4fb477; }
    .stream-main { display: grid; gap: 6px; min-width: 0; }
    .stream-meta, .stream-last { color: #9aa7b3; font-size: 14px; }
    .stream-last { white-space: nowrap; text-align: right; }
    .stream-last strong { color: #eef2f6; font-variant-numeric: tabular-nums; }
    .project-footer { margin-top: 28px; text-align: center; color: #9aa7b3; font-size: 13px; }
    .project-footer a { color: inherit; text-decoration: none; }
    .project-footer a:hover { color: #4fb477; }
    @media (max-width: 700px) {
      header { display: grid; align-items: stretch; }
      .header-tools { display: grid; grid-template-columns: 1fr auto; }
      .stream { grid-template-columns: 1fr; }
      .stream-last { text-align: left; white-space: normal; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1 data-label="title">Real-time Airband audio streams</h1>
      <div class="header-tools">
        <div class="active-users"><span data-label="users">Users</span><strong id="activeUsers">0</strong></div>
        <div class="language-switch">
          <button id="languageToggle" class="language-button" type="button" aria-haspopup="true" aria-expanded="false">
            <span id="languageCode">EN</span><span class="caret"></span>
          </button>
          <div id="languageMenu" class="language-menu" hidden>
            <button class="language-option" type="button" data-lang="en"><span class="language-radio"></span><span>English - EN</span></button>
            <button class="language-option" type="button" data-lang="es"><span class="language-radio"></span><span>Espanol - ES</span></button>
          </div>
        </div>
      </div>
    </header>
    ${items}
    <footer class="project-footer">
      <a href="https://github.com/OA6DXV/udp-airband-server" rel="noopener noreferrer">UDP Airband Server${softwareVersion ? ` ${escapeHtml(softwareVersion)}` : ''}</a>
    </footer>
  </main>
  <script>
    const translations = {
      en: { title: 'Real-time Airband audio streams', users: 'Users', lastTransmission: 'Last Transmission', never: 'never', now: 'Now' },
      es: { title: 'Streams de audio Airband en tiempo real', users: 'Usuarios', lastTransmission: 'Ultima transmision', never: 'nunca', now: 'Ahora' },
    };
    let language = localStorage.getItem('udp-airband-language') || 'en';
    if (!translations[language]) language = 'en';
    const activeUsersEl = document.getElementById('activeUsers');
    const languageToggle = document.getElementById('languageToggle');
    const languageCode = document.getElementById('languageCode');
    const languageMenu = document.getElementById('languageMenu');
    const languageOptions = Array.from(document.querySelectorAll('.language-option'));

    languageToggle.addEventListener('click', () => {
      const open = languageMenu.hidden;
      languageMenu.hidden = !open;
      languageToggle.setAttribute('aria-expanded', String(open));
    });
    languageOptions.forEach((option) => {
      option.addEventListener('click', () => {
        language = option.dataset.lang;
        localStorage.setItem('udp-airband-language', language);
        languageMenu.hidden = true;
        languageToggle.setAttribute('aria-expanded', 'false');
        applyLanguage();
        refreshStatus();
      });
    });
    document.addEventListener('click', (event) => {
      if (!languageMenu.hidden && !event.target.closest('.language-switch')) {
        languageMenu.hidden = true;
        languageToggle.setAttribute('aria-expanded', 'false');
      }
    });

    function applyLanguage() {
      document.documentElement.lang = language;
      languageCode.textContent = language.toUpperCase();
      document.querySelectorAll('[data-label]').forEach((element) => {
        element.textContent = t(element.dataset.label);
      });
      languageOptions.forEach((option) => option.classList.toggle('active', option.dataset.lang === language));
    }

    async function refreshStatus() {
      try {
        const response = await fetch('/status', { cache: 'no-store' });
        const streams = await response.json();
        activeUsersEl.textContent = String(streams.reduce((total, stream) => total + (stream.activeListeners || 0), 0));
        for (const stream of streams) {
          const lastEl = document.querySelector('[data-last="' + stream.name + '"]');
          if (lastEl) lastEl.textContent = localizeLastHeard(stream.lastHeardLabel || 'never');
        }
      } catch {
        activeUsersEl.textContent = '0';
      }
    }

    function localizeLastHeard(label) {
      if (!label || label === 'never') return t('never');
      if (label === 'Now') return t('now');
      if (language === 'es') {
        const seconds = label.match(/^(\\d+)s ago$/);
        if (seconds) return 'hace ' + seconds[1] + ' s';
      }
      return label;
    }

    function t(key) {
      return translations[language][key] || translations.en[key] || key;
    }

    applyLanguage();
    refreshStatus();
    setInterval(refreshStatus, 1000);
  </script>
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
  DEFAULT_STREAMS,
  loadStreams,
  renderStreamList,
  validateStreams,
};
