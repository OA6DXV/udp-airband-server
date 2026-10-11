const streamData = JSON.parse(document.getElementById('streamData').textContent);
const configuredBasePath = document.querySelector('base')?.getAttribute('href') || '/';
const appBasePath = new URL(configuredBasePath, location.origin).pathname.replace(/\/?$/, '/');
function appPath(path) {
  return `${appBasePath}${String(path).replace(/^\/+/, '')}`;
}
function appWebSocketUrl(path) {
  return `${wsProtocol()}://${location.host}${appPath(path)}`;
}
const allStreams = streamData.streams || [];
const selectedNames = new URLSearchParams(location.search).get('streams');
const selectedSet = new Set(String(selectedNames || '').split(',').map((item) => item.trim()).filter(Boolean));
const selectedStreams = allStreams.filter((stream) => selectedSet.has(stream.name));
const streams = selectedStreams.length ? selectedStreams : allStreams.slice(0, 1);

const container = document.getElementById('multiStreams');
const activeUsersEl = document.getElementById('activeUsers');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const totalBandwidthEl = document.getElementById('totalBandwidth');
const localTimeEl = document.getElementById('localTime');
const utcTimeEl = document.getElementById('utcTime');
const titleStatusDot = document.getElementById('titleStatusDot');
const languageToggle = document.getElementById('languageToggle');
const languageCode = document.getElementById('languageCode');
const languageMenu = document.getElementById('languageMenu');
const languageOptions = Array.from(document.querySelectorAll('.language-option'));
const multiStartOverlay = document.getElementById('multiStartOverlay');
const multiStartButton = document.getElementById('multiStartButton');
const multiNoticeTitle = document.getElementById('multiNoticeTitle');
const multiNoticeBody = document.getElementById('multiNoticeBody');
const modeButtons = Array.from(document.querySelectorAll('.multi-mode-button'));

const translations = {
  en: {
    users: 'Users', localTime: 'Local Time', disconnected: 'Disconnected', waitingUdp: 'Waiting for UDP',
    connected: 'Connected', idle: 'Push to Reconnect', pushDisconnect: 'Push to disconnect', stopStream: 'Stop stream', lastHeard: 'Last Heard',
    mode: 'Mode', audio: 'Audio', startAudio: 'Start', mute: 'Mute', unmute: 'Unmute', compressed: 'Compressed',
    uncompressed: 'Uncompressed', streamName: 'Stream', level: 'Level', never: 'never', now: 'Now',
    realTimeMode: 'RAW Audio', compatibleMode: 'Normal Mode', accept: 'Accept',
    realTimeNoticeTitle: 'RAW Audio',
    realTimeNoticeBody: 'This mode uses realtime per-stream audio with the lowest latency. It cannot keep playing in the background, so keep this page open and the device active.',
    realTimeDesktopNoticeBody: 'This mode uses realtime per-stream audio with the lowest latency. Normal Mode is designed for smartphones.',
    compatibleNoticeTitle: 'Normal Mode',
    compatibleNoticeBody: 'This mode uses one mixed AAC stream. It can keep playing with the phone locked or in the background, but delay is variable and usually around 5 to 10 seconds.',
    serverDisconnected: 'Connection to the server was lost. Reconnecting...',
    serverRestarted: 'The server restarted. This page reconnected; refresh if audio does not resume.',
    streamsUnavailableTitle: 'Streams updated',
    streamsUnavailableBody: 'One or more selected streams are no longer available with their previous configuration. Return to the home page to choose from the updated stream list.',
    returnToHome: 'Return to home',
    reload: 'Reload',
  },
  es: {
    users: 'Usuarios', localTime: 'Hora local', disconnected: 'Desconectado', waitingUdp: 'Esperando UDP',
    connected: 'Conectado', idle: 'Presiona para reconectar', pushDisconnect: 'Presiona para desconectar', stopStream: 'Detener stream', lastHeard: 'Ultima transmision',
    mode: 'Modo', audio: 'Audio', startAudio: 'Iniciar', mute: 'Silenciar', unmute: 'Activar', compressed: 'Comprimido',
    uncompressed: 'Sin comprimir', streamName: 'Stream', level: 'Nivel', never: 'nunca', now: 'Ahora',
    realTimeMode: 'RAW Audio', compatibleMode: 'Normal Mode', accept: 'Aceptar',
    realTimeNoticeTitle: 'RAW Audio',
    realTimeNoticeBody: 'Este modo usa audio por stream en tiempo real con la menor latencia. No puede seguir sonando en segundo plano, asi que manten esta pagina abierta y el dispositivo activo.',
    realTimeDesktopNoticeBody: 'Este modo usa audio por stream en tiempo real con la menor latencia. Normal Mode esta disenado para smartphones.',
    compatibleNoticeTitle: 'Normal Mode',
    compatibleNoticeBody: 'Este modo usa un stream AAC mezclado. Puede seguir sonando con el telefono bloqueado o en segundo plano, pero el delay es variable y suele rondar los 5 a 10 segundos.',
    serverDisconnected: 'Se perdio la conexion con el servidor. Reconectando...',
    serverRestarted: 'El servidor se reinicio. Esta pagina se reconecto; actualiza si el audio no vuelve.',
    streamsUnavailableTitle: 'Streams actualizados',
    streamsUnavailableBody: 'Uno o mas streams seleccionados ya no estan disponibles con su configuracion anterior. Regresa a la pagina principal para elegir desde la lista actualizada.',
    returnToHome: 'Volver al inicio',
    reload: 'Actualizar',
  },
};

let language = localStorage.getItem('udp-airband-language') || 'en';
if (!translations[language]) language = 'en';
const acceptedNoticeStoragePrefix = 'udp-airband-multi-notice-accepted:';
let audioContext;
let globalPaused = false;
let statusHovering = false;
let players = [];
let multiPlaybackRequested = false;
let globalMode = 'opus';
let workletModulePromise;
let opusModulePromise;
let pendingNoticeMode = globalMode;
let serverInstanceId = '';
let serverNoticeEl;
let serverNoticeKind = '';
let streamsUnavailable = false;

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

statusEl.addEventListener('click', () => {
  if (globalPaused) {
    globalPaused = false;
    players.forEach((player) => player.resume());
  } else if (players.some((player) => player.confirmed)) {
    globalPaused = true;
    players.forEach((player) => player.pause());
  }
  updateHeader();
});
statusEl.addEventListener('mouseenter', () => {
  statusHovering = true;
  updateHeader();
});
statusEl.addEventListener('mouseleave', () => {
  statusHovering = false;
  updateHeader();
});

if (multiStartButton) {
  multiStartButton.addEventListener('click', () => {
    if (streamsUnavailable) {
      location.href = appPath('');
      return;
    }
    if (pendingNoticeMode) rememberNoticeAccepted(modeNoticeKeyForMode(pendingNoticeMode));
    startMultiPlayback();
  });
}

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    showModeNotice(button.dataset.mode);
  });
});

async function recoverPlayback() {
  if (!multiPlaybackRequested || globalPaused || streamsUnavailable) return;
  try {
    const context = ensureAudioContext();
    if (context.state !== 'running') await context.resume();
    await Promise.all(players.map((player) => player.startIfReady()));
  } catch (error) {
    console.warn('Multistream recovery requires user interaction:', error.message);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') recoverPlayback();
});
window.addEventListener('pageshow', recoverPlayback);
window.addEventListener('focus', recoverPlayback);

function renderPlayers() {
  container.textContent = '';
  for (const player of players) {
    const card = document.createElement('article');
    card.className = 'multi-stream-card';
    card.dataset.stream = player.stream.name;
    card.classList.add('expanded');
    card.innerHTML = `
      <section class="meters multi-meters">
        <div class="meter stream-name-meter"><span data-i18n="streamName">Stream</span><strong data-role="name"></strong></div>
        <div class="meter"><span data-i18n="lastHeard">Last Heard</span><strong data-role="last">never</strong></div>
        <div class="meter"><span data-i18n="mode">Mode</span><button class="mode-button" data-role="mode" type="button">Uncompressed</button></div>
        <div class="meter"><span data-i18n="audio">Audio</span><button data-role="start" type="button">Start</button></div>
      </section>
      <div class="compact-stream-header">
        <button class="compact-stream-toggle" data-role="compact-toggle" type="button" aria-expanded="false">
          <span class="compact-stream-title" data-role="compact-name"></span>
          <span class="compact-chevron" aria-hidden="true"></span>
        </button>
      </div>
      <div class="level gain-level">
        <span class="level-label" data-i18n="level">Level</span>
        <div class="level-track gain-level-track">
          <div class="level-mask" data-role="level-mask"></div>
          <span class="gain-value" data-role="gain-value">100%</span>
          <input data-role="gain" type="range" min="0" max="1.5" step="0.01" value="1" aria-label="gain">
        </div>
        <span data-role="level-db">-\u221e dB</span>
      </div>
    `;
    container.appendChild(card);
    player.bind(card);
  }
}

function connectPlayers() {
  players.forEach((player) => player.connectControl());
}

function ensureAudioContext() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch { /* Not every browser exposes the audio session API. */ }
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!audioContext) audioContext = new AudioContextConstructor();
  return audioContext;
}

async function startMultiPlayback() {
  try {
    multiPlaybackRequested = true;
    if (pendingNoticeMode) setGlobalMode(pendingNoticeMode, { deferStart: true });
    if (multiStartOverlay) multiStartOverlay.hidden = true;
    await startSelectedGlobalMode();
  } catch {
    multiPlaybackRequested = false;
    if (multiStartOverlay) multiStartOverlay.hidden = false;
  }
}

async function startSelectedGlobalMode() {
  if (globalPaused || streamsUnavailable) return;
  const context = ensureAudioContext();
  if (context.state !== 'running') await context.resume();
  if (context.state !== 'running') throw new Error('AudioContext is not running');
  updateMediaSessionMetadata();
  await Promise.all(players.map((player) => player.startIfReady()));
}

async function loadWorkletModule() {
  const context = ensureAudioContext();
  if (!window.isSecureContext || !context.audioWorklet) {
    throw new Error('AudioWorklet requires HTTPS and browser support');
  }
  if (!workletModulePromise) {
    workletModulePromise = context.audioWorklet.addModule(appPath('assets/audio-worklet.mjs'))
      .catch((error) => { workletModulePromise = null; throw error; });
  }
  return workletModulePromise;
}

function loadOpusModule() {
  if (!opusModulePromise) {
    opusModulePromise = import(appPath('assets/opus-webcodecs.mjs'))
      .catch((error) => { opusModulePromise = null; throw error; });
  }
  return opusModulePromise;
}

function updateMediaSessionMetadata() {
  if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: 'Multi Stream',
    artist: streams.map((stream) => stream.label).join(', '),
    album: 'UDP Airband Server',
  });
  try {
    navigator.mediaSession.setActionHandler('pause', () => {
      globalPaused = true;
      players.forEach((player) => player.pause());
      updateHeader();
    });
    navigator.mediaSession.setActionHandler('play', () => {
      globalPaused = false;
      players.forEach((player) => player.resume());
      updateHeader();
    });
  } catch { /* Media Session actions are optional. */ }
}

function setGlobalMode(mode, options = {}) {
  if (!['raw', 'opus'].includes(mode)) return;
  const changed = globalMode !== mode;
  globalMode = mode;
  players.forEach((player) => {
    if (changed) {
      player.stopRealtimeAudio();
      player.started = false;
    }
    player.mode = mode;
    player.updateLabels();
  });
  updateModeControls();
  if (changed && multiPlaybackRequested && !options.deferStart) {
    startSelectedGlobalMode().catch((error) => console.warn(error));
  }
}

function showModeNotice(mode) {
  if (!['raw', 'opus'].includes(mode)) return;
  pendingNoticeMode = mode;
  setGlobalMode(mode, { deferStart: true });
  if (hasAcceptedNotice(modeNoticeKeyForMode(mode))) {
    if (multiPlaybackRequested) startSelectedGlobalMode().catch(() => {});
    return;
  }
  if (multiNoticeTitle) multiNoticeTitle.textContent = t(mode === 'opus' ? 'compatibleNoticeTitle' : 'realTimeNoticeTitle');
  if (multiNoticeBody) multiNoticeBody.textContent = t(noticeBodyKey(mode));
  if (multiStartButton) multiStartButton.textContent = t('accept');
  if (multiStartOverlay) multiStartOverlay.hidden = false;
}

function updateModeNotice() {
  if (!pendingNoticeMode) return;
  if (multiNoticeTitle) multiNoticeTitle.textContent = t(pendingNoticeMode === 'opus' ? 'compatibleNoticeTitle' : 'realTimeNoticeTitle');
  if (multiNoticeBody) multiNoticeBody.textContent = t(noticeBodyKey(pendingNoticeMode));
  if (multiStartButton) multiStartButton.textContent = t('accept');
}

function noticeBodyKey(mode) {
  if (mode === 'opus') return 'compatibleNoticeBody';
  return isMobileDevice() ? 'realTimeNoticeBody' : 'realTimeDesktopNoticeBody';
}

function modeNoticeKeyForMode(mode) {
  return mode === 'opus' ? 'multi-opus-worklet-v1' : 'multi-raw-worklet-v1';
}

function hasAcceptedNotice(key) {
  return sessionStorage.getItem(`${acceptedNoticeStoragePrefix}${key}`) === 'true';
}

function rememberNoticeAccepted(key) {
  sessionStorage.setItem(`${acceptedNoticeStoragePrefix}${key}`, 'true');
}

function updateModeControls() {
  modeButtons.forEach((button) => {
    button.textContent = t(button.dataset.mode === 'opus' ? 'compatibleMode' : 'realTimeMode');
    button.classList.toggle('active', button.dataset.mode === globalMode);
  });
}

function updateHeader() {
  activeUsersEl.textContent = String(players.reduce((max, player) => Math.max(max, player.activeListeners || 0), 0));
  const totalBps = players.reduce((total, player) => total + player.bandwidth, 0);
  totalBandwidthEl.textContent = globalPaused || totalBps <= 0 ? 'Idle' : formatBandwidth(totalBps);
  if (globalPaused) {
    setHeaderStatus('idle', 'idle');
    return;
  }
  if (players.every((player) => player.controlOpen) && players.some((player) => player.confirmed)) {
    setHeaderStatus('live', 'connected');
  } else if (players.some((player) => player.controlOpen)) {
    setHeaderStatus('ready', 'waitingUdp');
  } else {
    setHeaderStatus('', 'disconnected');
  }
}

function setHeaderStatus(state, key) {
  statusEl.className = `status ${state}`;
  titleStatusDot.className = 'title-status-dot';
  if (key === 'connected') {
    titleStatusDot.classList.add('live');
    statusText.textContent = t('pushDisconnect');
    return;
  }
  if (key === 'idle') {
    titleStatusDot.classList.add('idle');
    statusText.textContent = t('idle');
    return;
  }
  statusText.textContent = t(key);
}

function updateServerInstance(nextServerInstanceId) {
  if (!nextServerInstanceId) {
    hideServerNotice();
    return;
  }
  if (serverInstanceId && serverInstanceId !== nextServerInstanceId) {
    serverInstanceId = nextServerInstanceId;
    showServerNotice('restarted');
    return;
  }
  serverInstanceId = nextServerInstanceId;
  if (serverNoticeKind !== 'restarted') hideServerNotice();
}

function showServerNotice(kind) {
  const notice = ensureServerNotice();
  serverNoticeKind = kind;
  const textEl = notice.querySelector('[data-role="server-notice-text"]');
  const reloadButton = notice.querySelector('[data-role="server-notice-reload"]');
  if (textEl) textEl.textContent = t(kind === 'restarted' ? 'serverRestarted' : 'serverDisconnected');
  if (reloadButton) reloadButton.textContent = t('reload');
  notice.hidden = false;
}

function hideServerNotice() {
  serverNoticeKind = '';
  if (serverNoticeEl) serverNoticeEl.hidden = true;
}

function ensureServerNotice() {
  if (serverNoticeEl) return serverNoticeEl;
  serverNoticeEl = document.createElement('div');
  serverNoticeEl.className = 'server-notice';
  serverNoticeEl.hidden = true;
  serverNoticeEl.innerHTML = '<span data-role="server-notice-text"></span><button type="button" data-role="server-notice-reload"></button>';
  const button = serverNoticeEl.querySelector('[data-role="server-notice-reload"]');
  if (button) button.addEventListener('click', () => location.reload());
  document.body.appendChild(serverNoticeEl);
  return serverNoticeEl;
}

function showStreamsUnavailable() {
  if (!streamsUnavailable) {
    streamsUnavailable = true;
    globalPaused = true;
    players.forEach((player) => player.pause());
    hideServerNotice();
  }
  if (!multiStartOverlay) {
    location.href = appPath('');
    return;
  }
  if (multiNoticeTitle) multiNoticeTitle.textContent = t('streamsUnavailableTitle');
  if (multiNoticeBody) multiNoticeBody.textContent = t('streamsUnavailableBody');
  if (multiStartButton) multiStartButton.textContent = t('returnToHome');
  multiStartOverlay.hidden = false;
}

function updateMeters() {
  players.forEach((player) => player.updateMeter());
  updateHeader();
}

function updateClocks() {
  const now = new Date();
  localTimeEl.textContent = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now);
  utcTimeEl.textContent = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC',
  }).format(now);
}

function applyLanguage() {
  document.documentElement.lang = language;
  languageCode.textContent = language.toUpperCase();
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  languageOptions.forEach((option) => option.classList.toggle('active', option.dataset.lang === language));
  players.forEach((player) => player.updateLabels());
  updateModeControls();
  updateModeNotice();
  if (serverNoticeEl && !serverNoticeEl.hidden) {
    const textEl = serverNoticeEl.querySelector('[data-role="server-notice-text"]');
    const reloadButton = serverNoticeEl.querySelector('[data-role="server-notice-reload"]');
    if (textEl) textEl.textContent = t(serverNoticeKind === 'restarted' ? 'serverRestarted' : 'serverDisconnected');
    if (reloadButton) reloadButton.textContent = t('reload');
  }
  if (streamsUnavailable) showStreamsUnavailable();
  updateHeader();
}

class MultiStreamPlayer {
  constructor(stream) {
    this.stream = stream;
    this.config = { ...stream };
    this.clientId = getClientId(stream.name);
    this.mode = globalMode;
    this.currentMode = '';
    this.controlOpen = false;
    this.confirmed = false;
    this.activeListeners = 0;
    this.lastHeardLabel = 'never';
    this.lastHeardAt = 0;
    this.started = false;
    this.muted = false;
    this.paused = false;
    this.configReady = false;
    this.gain = 1;
    this.peak = 0;
    this.lastAudioAt = 0;
    this.bandwidth = 0;
    this.receivedBytes = 0;
    this.lastBandwidthBytes = 0;
    this.lastBandwidthAt = Date.now();
    this.socketGeneration = 0;
    this.starting = false;
    this.audioWs = null;
    this.reconnectTimer = null;
    this.worklet = null;
    this.workletConfiguration = '';
    this.workletDiagnostics = null;
    this.decoder = null;
    this.playbackError = '';
    this.deliveredFrames = 0;

  }

  bind(card) {
    this.card = card;
    this.nameEl = card.querySelector('[data-role="name"]');
    this.compactToggle = card.querySelector('[data-role="compact-toggle"]');
    this.compactNameEl = card.querySelector('[data-role="compact-name"]');
    this.lastEl = card.querySelector('[data-role="last"]');
    this.modeButton = card.querySelector('[data-role="mode"]');
    this.startButton = card.querySelector('[data-role="start"]');
    this.gainInput = card.querySelector('[data-role="gain"]');
    this.gainValue = card.querySelector('[data-role="gain-value"]');
    this.levelDb = card.querySelector('[data-role="level-db"]');
    this.levelMask = card.querySelector('[data-role="level-mask"]');
    this.nameEl.textContent = this.stream.label;
    this.updateCompactLabel();
    this.compactToggle.addEventListener('click', () => {
      this.card.classList.toggle('expanded');
      this.compactToggle.setAttribute('aria-expanded', String(this.card.classList.contains('expanded')));
    });
    this.modeButton.addEventListener('click', () => {
      this.mode = this.mode === 'raw' ? 'opus' : 'raw';
      if (multiPlaybackRequested && !this.paused && !globalPaused) this.startAudio().catch((error) => this.handlePlaybackError(error));
      this.updateLabels();
    });
    this.startButton.addEventListener('click', async () => {
      if (!this.started) {
        multiPlaybackRequested = true;
        try { await this.startAudio(); } catch (error) { this.handlePlaybackError(error); }
      } else {
        this.muted = !this.muted;
        this.applyGain();
      }
      this.updateLabels();
    });
    this.gainInput.addEventListener('input', () => {
      this.gain = Number(this.gainInput.value);
      this.gainValue.textContent = `${Math.round(this.gain * 100)}%`;
      this.applyGain();
      this.showGainValue();
    });
    this.gainInput.addEventListener('pointerdown', () => this.showGainValue());
    this.gainInput.addEventListener('pointerup', () => this.hideGainValueLater());
    this.gainInput.addEventListener('pointercancel', () => this.hideGainValueLater());
    this.gainInput.addEventListener('focus', () => this.showGainValue());
    this.gainInput.addEventListener('blur', () => this.hideGainValueLater());
    this.gainInput.addEventListener('mouseenter', () => this.showGainValue());
    this.gainInput.addEventListener('mouseleave', () => this.hideGainValueLater());
    this.updateLabels();
    this.updateCardModeState();
  }

  showGainValue() {
    clearTimeout(this.gainValueTimer);
    this.card.classList.add('show-gain-value');
  }

  hideGainValueLater() {
    clearTimeout(this.gainValueTimer);
    this.gainValueTimer = setTimeout(() => {
      this.card.classList.remove('show-gain-value');
    }, 2000);
  }

  connectControl() {
    if (this.controlWs && this.controlWs.readyState <= 1) return;
    this.controlWs = new WebSocket(`${appWebSocketUrl(`${encodeURIComponent(this.stream.name)}/control`)}?clientId=${encodeURIComponent(this.clientId)}`);
    this.controlWs.addEventListener('open', () => {
      this.controlOpen = true;
      updateHeader();
    });
    this.controlWs.addEventListener('close', () => {
      this.controlOpen = false;
      if (!streamsUnavailable) {
        showServerNotice('disconnected');
        setTimeout(() => this.connectControl(), 1000);
      }
      updateHeader();
    });
    this.controlWs.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'config') {
        this.config = { ...this.config, ...message };
        this.configReady = true;
        updateServerInstance(message.serverInstanceId);
        this.startIfReady();
      } else if (message.type === 'streamUpdated') {
        this.applyStreamUpdate(message.stream);
      } else if (message.type === 'streamUnavailable') {
        showStreamsUnavailable();
      } else if (message.type === 'stats') {
        this.activeListeners = message.activeListeners || 0;
        this.bandwidth = message.listenerBitsPerSecond || this.bandwidth || 0;
        this.lastHeardAt = message.lastHeardAt || 0;
        this.lastHeardLabel = message.lastHeardLabel || 'never';
        if (message.hasUdp) this.confirmed = true;
      }
      this.updateLabels();
      updateHeader();
    });
  }

  applyStreamUpdate(stream) {
    if (!stream || stream.name !== this.stream.name) return;
    this.stream = { ...this.stream, ...stream };
    this.config = { ...this.config, ...stream };
    if (this.nameEl) this.nameEl.textContent = this.stream.label;
    this.updateLabels();
    updateMediaSessionMetadata();
  }

  async startAudio() {
    this.stopRealtimeAudio();
    this.started = false;
    this.starting = true;
    this.playbackError = '';
    const generation = this.socketGeneration;
    try {
      const context = ensureAudioContext();
      if (context.state !== 'running') await context.resume();
      await loadWorkletModule();
      let module;
      if (this.mode === 'opus') {
        module = await loadOpusModule();
        if (!this.config.opusRealtimeAvailable || !await module.supportsOpusAudioDecoder(window.AudioDecoder)) {
          throw new Error('Opus unavailable for this stream or browser; select RAW Audio');
        }
      }
      if (generation !== this.socketGeneration || globalPaused || streamsUnavailable) return;
      if (!this.gainNode) {
        this.gainNode = context.createGain();
        this.gainNode.connect(context.destination);
      }
      this.worklet = new AudioWorkletNode(context, 'opus-pcm', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      });
      this.worklet.port.onmessage = ({ data }) => {
        if (generation !== this.socketGeneration) return;
        if (data?.type === 'worklet-diagnostics') this.workletDiagnostics = data;
        if (data?.type === 'worklet-error') this.handlePlaybackError(new Error(data.message));
      };
      this.worklet.addEventListener('processorerror', () => {
        if (generation === this.socketGeneration) this.handlePlaybackError(new Error('AudioWorklet processor failed'));
      });
      this.worklet.connect(this.gainNode);
      this.currentMode = this.mode;
      this.started = true;
      this.paused = false;
      if (module) {
        this.decoder = new module.OpusWebCodecsDecoder({
          onPcm: (samples, frames, rate, channels) => {
            if (generation === this.socketGeneration) this.deliverPcm(samples, frames, rate, channels);
          },
          onError: (error) => {
            if (generation === this.socketGeneration) this.handlePlaybackError(error);
          },
        });
      }
      this.applyGain();
      const endpoint = this.mode === 'opus' ? 'opus-live' : 'audio';
      const socket = new WebSocket(`${appWebSocketUrl(`${encodeURIComponent(this.stream.name)}/${endpoint}`)}?clientId=${encodeURIComponent(this.clientId)}`);
      this.audioWs = socket;
      socket.binaryType = 'arraybuffer';
      socket.addEventListener('message', (event) => {
        if (generation !== this.socketGeneration || !(event.data instanceof ArrayBuffer)) return;
        this.receivedBytes += event.data.byteLength;
        this.confirmed = true;
        if (this.currentMode === 'opus') {
          this.decoder?.push(event.data).catch(() => {});
        } else {
          const samples = new Float32Array(event.data);
          const frames = samples.length / this.config.channels;
          if (Number.isInteger(frames) && frames > 0) this.deliverPcm(samples, frames, this.config.sampleRate, this.config.channels);
        }
      });
      socket.addEventListener('close', () => {
        if (generation !== this.socketGeneration || !this.started || this.paused || globalPaused || streamsUnavailable) return;
        this.stopRealtimeAudio();
        this.started = false;
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.startIfReady();
        }, 1000);
      });
      this.updateLabels();
    } catch (error) {
      if (generation === this.socketGeneration) this.handlePlaybackError(error);
      throw error;
    } finally {
      if (generation === this.socketGeneration) this.starting = false;
    }
  }

  async startIfReady() {
    if (!multiPlaybackRequested || globalPaused || this.paused || this.started || this.starting || !this.configReady || streamsUnavailable) return;
    try { await this.startAudio(); } catch { /* The error is shown on this stream's controls. */ }
  }

  deliverPcm(samples, frames, rate, channels) {
    if (!this.worklet || !this.started || this.paused) return;
    const targetLatencyMs = Number(this.config.opusWorkletTargetLatencyMs) || 100;
    const highWaterMs = Math.max(targetLatencyMs + 40, targetLatencyMs * 3.2);
    const key = `${rate}:${channels}:${targetLatencyMs}`;
    if (key !== this.workletConfiguration) {
      this.worklet.port.postMessage({
        type: 'configure', inputSampleRate: rate, channels, targetLatencyMs,
        highWaterMs, capacitySeconds: 2, maxDrift: 0.004,
      });
      this.workletConfiguration = key;
    }
    this.peak = Math.max(this.peak * 0.55, peakOf(samples));
    this.lastAudioAt = Date.now();
    this.worklet.port.postMessage({ type: 'samples', buffer: samples.buffer, frames, channels }, [samples.buffer]);
    this.deliveredFrames += frames;
  }

  handlePlaybackError(error) {
    this.stopRealtimeAudio();
    this.started = false;
    this.playbackError = error?.message || String(error);
    console.warn(`Multistream ${this.stream.name}:`, this.playbackError);
    this.updateLabels();
  }

  pause() {
    this.paused = true;
    this.stopRealtimeAudio();
    this.started = false;
    this.updateLabels();
  }

  resume() {
    this.paused = false;
    this.startIfReady();
  }

  stopRealtimeAudio() {
    this.socketGeneration += 1;
    this.starting = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.audioWs) this.audioWs.close();
    this.audioWs = null;
    if (this.decoder) this.decoder.close();
    this.decoder = null;
    if (this.worklet) {
      this.worklet.disconnect();
      this.worklet.port.close();
    }
    this.worklet = null;
    this.workletConfiguration = '';
    this.workletDiagnostics = null;
    this.bandwidth = 0;
    this.peak = 0;
    this.lastAudioAt = 0;
  }

  applyGain() {
    if (this.gainNode) this.gainNode.gain.value = this.muted ? 0 : this.gain;
  }

  updateMeter() {
    const now = Date.now();
    const elapsed = Math.max(0.001, (now - this.lastBandwidthAt) / 1000);
    this.bandwidth = this.paused ? 0 : Math.max(0, (this.receivedBytes - this.lastBandwidthBytes) * 8 / elapsed);
    this.lastBandwidthBytes = this.receivedBytes;
    this.lastBandwidthAt = now;
    if (!this.lastAudioAt || now - this.lastAudioAt > 400 || globalPaused) {
      this.peak = 0;
    } else {
      this.peak *= 0.985;
    }
    const db = this.peak * this.gain > 0 ? 20 * Math.log10(this.peak * this.gain) : -60;
    const percent = (Math.max(-60, Math.min(0, db)) + 60) / 60 * 100;
    this.levelMask.style.width = `${100 - percent}%`;
    this.levelDb.textContent = db <= -60 ? '-\u221e dB' : `${db.toFixed(1)} dB`;
  }

  updateLabels() {
    this.lastEl.textContent = localizeLastHeard(this.lastHeardLabel);
    this.updateCompactLabel();
    this.modeButton.textContent = this.mode === 'opus' ? t('compatibleMode') : t('realTimeMode');
    this.startButton.textContent = this.started ? (this.muted ? t('unmute') : t('mute')) : t('startAudio');
    this.startButton.title = this.playbackError;
    this.startButton.textContent = this.playbackError ? this.playbackError : this.startButton.textContent;
    this.updateCardModeState();
  }

  updateCompactLabel() {
    if (!this.compactNameEl) return;
    this.compactNameEl.textContent = `${this.stream.label} | ${localizeLastHeard(this.lastHeardLabel)}`;
  }

  updateCardModeState() {
    if (!this.card) return;
    this.card.dataset.audioMode = this.mode;
    if (this.compactToggle) {
      this.compactToggle.disabled = false;
      this.compactToggle.setAttribute('aria-expanded', String(this.card.classList.contains('expanded')));
    }
  }
}

function peakOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
}

function localizeLastHeard(label) {
  if (!label || label === 'never') return t('never');
  if (label === 'Now') return t('now');
  if (language === 'es') {
    const seconds = label.match(/^(\d+)s ago$/);
    if (seconds) return `hace ${seconds[1]} s`;
  }
  return label;
}

function formatBandwidth(bitsPerSecond) {
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbps`;
  if (bitsPerSecond >= 1_000) return `${(bitsPerSecond / 1_000).toFixed(1)} kbps`;
  return `${Math.round(bitsPerSecond)} bps`;
}

function getClientId() {
  const key = 'udp-airband-multi-client-id';
  let value = localStorage.getItem(key);
  if (!value) {
    value = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, value);
  }
  return value;
}

function wsProtocol() {
  return location.protocol === 'https:' ? 'wss' : 'ws';
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function t(key) {
  return translations[language][key] || translations.en[key] || key;
}

function init() {
  players = streams.map((stream) => new MultiStreamPlayer(stream));
  renderPlayers();
  applyLanguage();
  updateModeControls();
  connectPlayers();
  updateHeader();
  updateClocks();
  showModeNotice(globalMode);
  setInterval(updateClocks, 1000);
  setInterval(updateMeters, 250);
}

init();

window.getMultiAudioDiagnostics = () => ({
  mode: globalMode, audioContextState: audioContext?.state || 'not-created',
  streams: players.map((player) => ({
    name: player.stream.name, mode: player.currentMode, started: player.started,
    gain: player.gain, muted: player.muted, error: player.playbackError,
    deliveredFrames: player.deliveredFrames,
    decoder: player.decoder?.diagnostics() || null,
    playback: player.workletDiagnostics,
  })),
});
