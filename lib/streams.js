'use strict';

const { normalizeSections } = require('./stream-layout-store');

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
  return loadStreamConfig(options).streams;
}

function loadStreamConfig(options) {
  const { configPath, defaultUdpHost, fs, path } = options;
  const configFile = path.resolve(configPath);
  const parsed = fs.existsSync(configFile)
    ? JSON.parse(fs.readFileSync(configFile, 'utf8'))
    : { streams: DEFAULT_STREAMS };

  return {
    sections: normalizeSections(parsed.sections === undefined ? [] : parsed.sections),
    streams: loadStreamsFromConfig(parsed, { configPath, defaultUdpHost }),
  };
}

function loadStreamsFromConfig(parsed, options) {
  const { configPath = 'streams.json', defaultUdpHost } = options;
  if (!Array.isArray(parsed.streams) || parsed.streams.length === 0) {
    throw new Error(`${configPath} must contain a non-empty "streams" array`);
  }
  const sections = normalizeSections(parsed.sections === undefined ? [] : parsed.sections);
  const sectionIds = new Set(sections.map((section) => section.id));
  return parsed.streams.map((stream) => {
    const normalized = normalizeStream(stream, { defaultUdpHost });
    if (normalized.sectionId && !sectionIds.has(normalized.sectionId)) {
      throw new Error(`Unknown section ID "${normalized.sectionId}".`);
    }
    return normalized;
  });
}

function normalizeStream(raw, options) {
  const { defaultUdpHost } = options;
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
    sectionId: String(raw.sectionId || '').trim(),
    udpHost,
    udpPort,
    sampleRate,
    channels,
    controlClients: new Map(),
    monitorClients: new Set(),
    rawClients: new Map(),
    opusClients: new Set(),
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
    levelPeak: 0,
    levelPeakAt: 0,
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
  const basePath = options.basePath || '/';
  const sections = Array.isArray(options.sections) ? options.sections : [];
  const multiCard = streams.length > 1 ? `
    <button id="multiCard" class="stream multi-card" type="button">
      <span class="stream-main">
        <strong data-multi-title>Multi Stream</strong>
        <span class="stream-meta" data-multi-description>Listen multiple frequencies at the same time.</span>
      </span>
      <span class="stream-last multi-count" data-multi-count></span>
    </button>
  ` : '';
  const cards = new Map(sections.map((section) => [section.id, []]));
  const unsectioned = [];
  for (const stream of streams) {
    if (cards.has(stream.sectionId)) cards.get(stream.sectionId).push(stream);
    else unsectioned.push(stream);
  }
  const renderCard = (stream) => `
    <a class="stream" href="${basePath}${escapeHtml(stream.name)}" data-stream="${escapeHtml(stream.name)}">
      <span class="stream-main">
        <strong data-stream-label>${escapeHtml(stream.label)}</strong>
        <span class="stream-meta" data-stream-meta>/${escapeHtml(stream.name)} &middot; ${stream.channels === 1 ? 'mono' : 'stereo'} ${stream.sampleRate} Hz</span>
      </span>
      <span class="stream-last"><span data-label="lastTransmission">Last Transmission</span>: <strong data-last="${escapeHtml(stream.name)}">never</strong></span>
    </a>
  `;
  const groupedItems = sections.map((section) => {
    const sectionStreams = cards.get(section.id);
    if (!sectionStreams || !sectionStreams.length) return '';
    const sectionStreamNames = escapeHtml(JSON.stringify(sectionStreams.map((stream) => stream.name)));
    return `
      <fieldset class="stream-section">
        <legend><button class="section-multistream" type="button" data-section-name="${escapeHtml(section.name)}" data-section-streams="${sectionStreamNames}" aria-label="${escapeHtml(section.name)}: Start multistream"><span>${escapeHtml(section.name)}</span><svg class="section-play-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M7 5.25v13.5L18 12 7 5.25Z"></path></svg></button></legend>
        ${sectionStreams.map(renderCard).join('')}
      </fieldset>
    `;
  }).join('');
  const items = `${groupedItems}${unsectioned.map(renderCard).join('')}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Real-Time Airband Audio</title>
  <base href="${basePath}">
  <link rel="icon" href="assets/favicon.ico" sizes="any">
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
    button.stream { width: 100%; font: inherit; text-align: left; cursor: pointer; }
    .stream:hover { border-color: #4fb477; }
    .stream.selecting { animation: selectPulse 3s ease-in-out infinite; }
    .stream.selected { border-color: #ff3d12; background: #ff3d12; color: #140603; }
    .stream.selected .stream-meta, .stream.selected .stream-last, .stream.selected .stream-last strong { color: #140603; }
    .multi-card { grid-template-columns: 1fr; border-color: #ff3d12; padding: 12px 16px; text-align: center; }
    .multi-card .stream-main { justify-items: center; }
    .multi-card.selecting, .multi-card.ready { border-color: #394451; padding: 16px; }
    .multi-card.selecting { text-align: center; grid-template-columns: 1fr; }
    .multi-card.selecting .stream-main { justify-items: center; }
    .multi-card.selecting.ready { grid-template-columns: minmax(0, 1fr) auto; text-align: left; }
    .multi-card.ready .stream-main { justify-items: start; }
    .multi-card.ready { animation: readyPulse 2s ease-in-out infinite; }
    .multi-card.ready .stream-last { animation: readyPulseText 2s ease-in-out infinite; }
    .multi-card.ready .multi-count { text-align: right; white-space: nowrap; }
    @keyframes selectPulse { 0%, 100% { border-color: #394451; } 50% { border-color: rgb(255 61 18 / 70%); } }
    @keyframes readyPulse { 0%, 100% { border-color: #394451; background: #1b2028; color: inherit; } 50% { border-color: #4fb477; background: #4fb477; color: #07110c; } }
    @keyframes readyPulseText { 0%, 100% { color: #9aa7b3; } 50% { color: #07110c; } }
    .stream-main { display: grid; gap: 6px; min-width: 0; }
    .stream-meta, .stream-last { color: #9aa7b3; font-size: 14px; }
    .stream-last { white-space: nowrap; text-align: right; }
    .stream-last strong { color: #eef2f6; font-variant-numeric: tabular-nums; }
    .stream-section { min-width: 0; margin: 18px 0 14px; padding: 10px 12px 0; border: 1px solid #394451; border-radius: 10px; }
    .stream-section legend { margin-left: 8px; padding: 0 8px; color: #eef2f6; font-size: 17px; font-weight: 700; }
    .section-multistream { display: inline-flex; align-items: center; gap: .45em; border: 0; padding: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
    .section-multistream:hover { color: #4fb477; }
    .section-multistream:focus-visible { outline: 2px solid #4fb477; outline-offset: 3px; border-radius: 3px; }
    .section-play-icon { width: 1em; height: 1em; flex: 0 0 auto; fill: currentColor; opacity: .72; }
    .section-multistream:hover .section-play-icon { opacity: 1; }
    .project-footer { margin-top: 28px; text-align: center; color: #9aa7b3; font-size: 13px; }
    .project-footer a { color: inherit; text-decoration: none; }
    .project-footer a:hover { color: #4fb477; }
    @media (max-width: 700px) {
      header { display: grid; align-items: stretch; }
      .header-tools { display: grid; grid-template-columns: 1fr auto; }
      .stream { grid-template-columns: 1fr; }
      .stream-last { text-align: left; white-space: normal; }
      .multi-card.ready { grid-template-columns: minmax(0, 1fr) auto; }
      .multi-card.ready .stream-last { text-align: right; white-space: nowrap; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Real-Time Airband Audio</h1>
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
    ${multiCard}
    ${items}
    <footer class="project-footer">
      <a href="https://github.com/OA6DXV/udp-airband-server" rel="noopener noreferrer">UDP Airband Server${softwareVersion ? ` ${escapeHtml(softwareVersion)}` : ''}</a>
    </footer>
  </main>
  <script>
    const translations = {
      en: { users: 'Users', lastTransmission: 'Last Transmission', never: 'never', now: 'Now', multiTitle: 'Multi Stream', multiDescription: 'Listen multiple frequencies at the same time.', selectStreams: 'Select streams', startMulti: 'Start Multi Stream', startSectionMulti: 'Start multistream with all streams in this section' },
      es: { users: 'Usuarios', lastTransmission: 'Ultima transmision', never: 'nunca', now: 'Ahora', multiTitle: 'Multi Stream', multiDescription: 'escucha multiples frecuencias al mismo tiempo.', selectStreams: 'Selecciona streams', startMulti: 'Iniciar Multi Stream', startSectionMulti: 'Iniciar multistream con todos los streams de esta sección' },
    };
    let language = localStorage.getItem('udp-airband-language') || 'en';
    if (!translations[language]) language = 'en';
    const languageToggle = document.getElementById('languageToggle');
    const languageCode = document.getElementById('languageCode');
    const languageMenu = document.getElementById('languageMenu');
    const languageOptions = Array.from(document.querySelectorAll('.language-option'));
    const activeUsersEl = document.getElementById('activeUsers');
    const multiCard = document.getElementById('multiCard');
    const streamCards = Array.from(document.querySelectorAll('[data-stream]'));
    const sectionMultiButtons = Array.from(document.querySelectorAll('.section-multistream'));
    const lastHeardLabels = new Map(streamCards.map((card) => [card.dataset.stream, 'never']));
    const activeUserCounts = new Map(streamCards.map((card) => [card.dataset.stream, 0]));
    const hubClientId = getHubClientId();
    const selectedStreams = new Set();
    let selectingMulti = false;

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
      });
    });
    document.addEventListener('click', (event) => {
      if (!languageMenu.hidden && !event.target.closest('.language-switch')) {
        languageMenu.hidden = true;
        languageToggle.setAttribute('aria-expanded', 'false');
      }
    });
    sectionMultiButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const names = JSON.parse(button.dataset.sectionStreams);
        if (!Array.isArray(names) || names.length === 0) return;
        const query = names.map(encodeURIComponent).join(',');
        location.href = new URL('multi?streams=' + query, document.baseURI).href;
      });
    });
    if (multiCard) {
      multiCard.addEventListener('click', () => {
        if (!selectingMulti) {
          selectingMulti = true;
          updateMultiSelection();
          return;
        }
        if (selectedStreams.size === 0) {
          selectingMulti = false;
          updateMultiSelection();
          return;
        }
        if (selectedStreams.size >= 2) {
          location.href = new URL('multi?streams=' + Array.from(selectedStreams).map(encodeURIComponent).join(','), document.baseURI).href;
        }
      });
      streamCards.forEach((card) => {
        card.addEventListener('click', (event) => {
          if (!selectingMulti) return;
          event.preventDefault();
          const name = card.dataset.stream;
          if (selectedStreams.has(name)) selectedStreams.delete(name);
          else selectedStreams.add(name);
          updateMultiSelection();
        });
      });
    }

    function applyLanguage() {
      document.documentElement.lang = language;
      languageCode.textContent = language.toUpperCase();
      document.querySelectorAll('[data-label]').forEach((element) => {
        element.textContent = t(element.dataset.label);
      });
      updateLastHeardLabels();
      languageOptions.forEach((option) => option.classList.toggle('active', option.dataset.lang === language));
      sectionMultiButtons.forEach((button) => {
        button.setAttribute('aria-label', button.dataset.sectionName + ': ' + t('startSectionMulti'));
      });
      updateMultiSelection();
    }

    function updateMultiSelection() {
      if (!multiCard) return;
      const title = multiCard.querySelector('[data-multi-title]');
      const description = multiCard.querySelector('[data-multi-description]');
      const count = multiCard.querySelector('[data-multi-count]');
      multiCard.classList.toggle('ready', selectedStreams.size >= 2);
      streamCards.forEach((card) => {
        card.classList.toggle('selecting', selectingMulti);
        card.classList.toggle('selected', selectedStreams.has(card.dataset.stream));
      });
      if (!selectingMulti) {
        title.textContent = t('multiTitle');
        description.textContent = t('multiDescription');
        count.textContent = '';
      } else if (selectedStreams.size === 0) {
        title.textContent = t('selectStreams');
        description.textContent = '';
        count.textContent = '';
      } else if (selectedStreams.size === 1) {
        title.textContent = t('selectStreams');
        description.textContent = '';
        count.textContent = selectedStreams.size + '/' + streamCards.length;
      } else {
        title.textContent = t('startMulti');
        description.textContent = '';
        count.textContent = selectedStreams.size + '/' + streamCards.length;
      }
    }

    function localizeLastHeard(label) {
      if (!label || label === 'never') return t('never');
      if (label === 'Now') return t('now');
      if (language === 'es') {
        const seconds = label.match(/^(\\d+)s ago$/);
        if (seconds) return 'hace ' + seconds[1] + ' s';
        const hours = label.match(/^(\\d+)h ago$/);
        if (hours) return 'hace ' + hours[1] + ' h';
        const days = label.match(/^(\\d+)d ago$/);
        if (days) return 'hace ' + days[1] + ' d';
      }
      return label;
    }

    function connectHubStatus(streamName) {
      const socket = new WebSocket(wsProtocol() + '://' + location.host + '${basePath}' + encodeURIComponent(streamName) + '/control?monitor=1&clientId=' + encodeURIComponent(hubClientId));
      socket.addEventListener('close', () => {
        setTimeout(() => connectHubStatus(streamName), 1000);
      });
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'stats') {
          lastHeardLabels.set(streamName, message.lastHeardLabel || 'never');
          activeUserCounts.set(streamName, message.activeListeners || 0);
          updateLastHeardLabel(streamName);
          updateActiveUsers();
        } else if (message.type === 'streamUpdated') {
          updateStreamCard(message.stream);
        } else if (message.type === 'streamCatalogChanged') {
          location.reload();
        }
      });
    }

    function updateStreamCard(stream) {
      if (!stream || stream.name === undefined) return;
      const card = document.querySelector('[data-stream="' + cssEscape(stream.name) + '"]');
      if (!card) return;
      const label = card.querySelector('[data-stream-label]');
      const meta = card.querySelector('[data-stream-meta]');
      if (label) label.textContent = stream.label || stream.name;
      if (meta) meta.textContent = '/' + stream.name + ' \u00b7 ' + (stream.channels === 1 ? 'mono' : 'stereo') + ' ' + stream.sampleRate + ' Hz';
    }

    function updateLastHeardLabels() {
      for (const streamName of lastHeardLabels.keys()) updateLastHeardLabel(streamName);
    }

    function updateLastHeardLabel(streamName) {
      const element = document.querySelector('[data-last="' + cssEscape(streamName) + '"]');
      if (element) element.textContent = localizeLastHeard(lastHeardLabels.get(streamName));
    }

    function updateActiveUsers() {
      activeUsersEl.textContent = String(Math.max(0, ...activeUserCounts.values()));
    }

    function wsProtocol() {
      return location.protocol === 'https:' ? 'wss' : 'ws';
    }

    function getHubClientId() {
      const key = 'udp-airband-hub-client-id';
      let value = localStorage.getItem(key);
      if (!value) {
        value = 'hub-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        localStorage.setItem(key, value);
      }
      return value;
    }

    function cssEscape(value) {
      if (window.CSS && CSS.escape) return CSS.escape(value);
      return String(value).replace(/["\\\\]/g, '\\\\$&');
    }

    function t(key) {
      return translations[language][key] || translations.en[key] || key;
    }

    applyLanguage();
    streamCards.forEach((card) => connectHubStatus(card.dataset.stream));
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

function escapeScriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function renderMultiStreamPage(streams, options = {}) {
  const softwareVersion = options.softwareVersion || '';
  const basePath = options.basePath || '/';
  const safeStreams = streams.map((stream) => ({
    name: stream.name,
    label: stream.label,
    sampleRate: stream.sampleRate,
    channels: stream.channels,
  }));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base href="${basePath}">
  <title>Multi Stream - UDP Airband Monitor</title>
  <link rel="icon" href="assets/favicon.ico" sizes="any">
  <link rel="stylesheet" href="assets/style.css">
</head>
<body class="multi-page">
  <main>
    <header>
      <h1><a id="title" class="stream-title-link" href="./" title="Click to return home">Multi Stream</a><span id="titleStatusDot" class="title-status-dot" aria-hidden="true"></span></h1>
      <div class="header-status">
        <div class="active-users total-bandwidth"><strong id="totalBandwidth">Idle</strong></div>
        <div class="active-users"><span data-i18n="users">Users</span><strong id="activeUsers">0</strong></div>
        <button id="status" class="status" type="button"><span class="dot"></span><span id="statusText">Disconnected</span></button>
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
    <section id="multiModeControls" class="multi-mode-controls" aria-labelledby="multiGlobalModeTitle">
      <h2 id="multiGlobalModeTitle" data-i18n="globalModeTitle">Change mode for all streams:</h2>
      <div class="multi-mode-actions">
        <button id="multiRawMode" class="multi-mode-button" type="button" data-mode="raw">RAW</button>
        <button id="multiAdpcmMode" class="multi-mode-button" type="button" data-mode="adpcm">Normal</button>
        <button id="multiCompressedMode" class="multi-mode-button" type="button" data-mode="opus">Low Data</button>
      </div>
    </section>
    <section id="multiStreams" class="multi-streams" aria-label="selected streams"></section>
    <footer class="time-footer" aria-label="current time">
      <div class="time-box"><span data-i18n="localTime">Local Time</span><strong id="localTime">--:--:--</strong></div>
      <div class="time-box"><span>UTC</span><strong id="utcTime">--:--:--</strong></div>
    </footer>
    <footer class="project-footer">
      <a href="https://github.com/OA6DXV/udp-airband-server" rel="noopener noreferrer">UDP Airband Server${softwareVersion ? ` ${escapeHtml(softwareVersion)}` : ''}</a>
    </footer>
  </main>
  <div id="multiStartOverlay" class="multi-start-overlay">
    <section class="multi-mode-notice" role="dialog" aria-modal="true" aria-labelledby="multiNoticeTitle">
      <h2 id="multiNoticeTitle">Welcome to multistream mode</h2>
      <p id="multiNoticeBody">Normal is used by default. Change modes globally or independently for each stream. Press Start Audio to begin playback.</p>
      <button id="multiStartButton" class="multi-start-button" type="button">Start Audio</button>
    </section>
  </div>
  <script id="streamData" type="application/json">${escapeScriptJson({ streams: safeStreams, softwareVersion })}</script>
  <script src="assets/multi.js"></script>
</body>
</html>`;
}

module.exports = {
  DEFAULT_STREAMS,
  loadStreams,
  loadStreamConfig,
  loadStreamsFromConfig,
  renderMultiStreamPage,
  renderStreamList,
  validateStreams,
};
