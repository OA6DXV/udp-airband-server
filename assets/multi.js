const streamData = JSON.parse(document.getElementById('streamData').textContent);
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
const nativeMultiAudio = document.getElementById('nativeMultiAudio');
const modeButtons = Array.from(document.querySelectorAll('.multi-mode-button'));

const translations = {
  en: {
    users: 'Users', localTime: 'Local Time', disconnected: 'Disconnected', waitingUdp: 'Waiting for UDP',
    connected: 'Connected', idle: 'Push to Reconnect', pushDisconnect: 'Push to disconnect', stopStream: 'Stop stream', lastHeard: 'Last Heard',
    mode: 'Mode', audio: 'Audio', startAudio: 'Start', mute: 'Mute', unmute: 'Unmute', compressed: 'Compressed',
    uncompressed: 'Uncompressed', streamName: 'Stream', level: 'Level', never: 'never', now: 'Now',
    realTimeMode: 'RealTime Mode', compatibleMode: 'Compatible Mode', accept: 'Accept',
    realTimeNoticeTitle: 'RealTime Mode',
    realTimeNoticeBody: 'This mode uses realtime per-stream audio with the lowest latency. It cannot keep playing in the background, so keep this page open and the device active.',
    compatibleNoticeTitle: 'Compatible Mode',
    compatibleNoticeBody: 'This mode uses one mixed AAC stream. It can keep playing with the phone locked or in the background, but delay is variable and usually around 5 seconds.',
  },
  es: {
    users: 'Usuarios', localTime: 'Hora local', disconnected: 'Desconectado', waitingUdp: 'Esperando UDP',
    connected: 'Conectado', idle: 'Presiona para reconectar', pushDisconnect: 'Presiona para desconectar', stopStream: 'Detener stream', lastHeard: 'Ultima transmision',
    mode: 'Modo', audio: 'Audio', startAudio: 'Iniciar', mute: 'Silenciar', unmute: 'Activar', compressed: 'Comprimido',
    uncompressed: 'Sin comprimir', streamName: 'Stream', level: 'Nivel', never: 'nunca', now: 'Ahora',
    realTimeMode: 'Modo RealTime', compatibleMode: 'Modo Compatible', accept: 'Aceptar',
    realTimeNoticeTitle: 'Modo RealTime',
    realTimeNoticeBody: 'Este modo usa audio por stream en tiempo real con la menor latencia. No puede seguir sonando en segundo plano, asi que manten esta pagina abierta y el dispositivo activo.',
    compatibleNoticeTitle: 'Modo Compatible',
    compatibleNoticeBody: 'Este modo usa un stream AAC mezclado. Puede seguir sonando con el telefono bloqueado o en segundo plano, pero el delay es variable y suele rondar los 5 segundos.',
  },
};

let language = localStorage.getItem('udp-airband-language') || 'en';
if (!translations[language]) language = 'en';
let audioContext;
let globalPaused = false;
let statusHovering = false;
let players = [];
let multiPlaybackRequested = false;
let globalMode = isMobileDevice() ? 'opus' : 'raw';
let nativeAudioStarted = false;
let nativeStopExpected = false;
let nativePreloadActive = false;
let nativeStartPromise = null;
let nativeReconnectTimer = null;
let nativeReconnectInFlight = false;
let pendingNoticeMode = globalMode;

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
    if (globalMode === 'opus') startNativeMultiAudio().catch(() => {});
    else players.forEach((player) => player.resume());
  } else if (players.some((player) => player.confirmed)) {
    globalPaused = true;
    if (globalMode === 'opus') stopNativeMultiAudio();
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
    startMultiPlayback();
  });
}

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    showModeNotice(button.dataset.mode);
  });
});

if (nativeMultiAudio) {
  ['abort', 'emptied', 'ended', 'error', 'pause', 'stalled'].forEach((eventName) => {
    nativeMultiAudio.addEventListener(eventName, () => handleNativePlaybackInterrupted(eventName));
  });
  nativeMultiAudio.addEventListener('playing', () => {
    nativeAudioStarted = true;
    nativeStopExpected = false;
    if (multiStartOverlay) multiStartOverlay.hidden = true;
    updateHeader();
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    players.forEach((player) => player.resetNativeLevelSync());
    updateMeters();
    return;
  }
  players.forEach((player) => player.resetNativeLevelSync());
  if (nativeNeedsReconnect()) {
    scheduleNativeReconnect(0);
  }
});

window.addEventListener('pageshow', () => {
  if (nativeNeedsReconnect()) {
    scheduleNativeReconnect(0);
  }
});

window.addEventListener('focus', () => {
  if (nativeNeedsReconnect()) {
    scheduleNativeReconnect(0);
  }
});

function renderPlayers() {
  container.textContent = '';
  for (const player of players) {
    const card = document.createElement('article');
    card.className = 'multi-stream-card';
    card.dataset.stream = player.stream.name;
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
      <button class="native-mute-button" data-role="native-mute" type="button" aria-label="Mute">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9v6h4l5 4V5L8 9H4z"></path>
          <path class="speaker-wave" d="M16 9.5c.9 1.4.9 3.6 0 5"></path>
          <path class="speaker-wave" d="M18.5 7c1.9 2.8 1.9 7.2 0 10"></path>
          <path class="mute-slash" d="M4 4l16 16"></path>
        </svg>
      </button>
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
  if (globalMode === 'opus') {
    players.forEach((player) => player.stopRealtimeAudio());
    await startNativeMultiAudio();
    return;
  }
  stopNativeMultiAudio();
  const context = ensureAudioContext();
  if (context.state !== 'running') await context.resume();
  if (context.state !== 'running') throw new Error('AudioContext is not running');
  await Promise.all(players.map((player) => player.startIfReady()));
}

async function startNativeMultiAudio() {
  if (nativeStartPromise) return nativeStartPromise;
  nativeStartPromise = startNativeMultiAudioOnce().finally(() => {
    nativeStartPromise = null;
  });
  return nativeStartPromise;
}

async function startNativeMultiAudioOnce() {
  if (!nativeMultiAudio) throw new Error('native audio element missing');
  nativeStopExpected = true;
  if (!nativePreloadActive || !nativeMultiAudio.getAttribute('src')) {
    nativeMultiAudio.preload = 'auto';
    nativeMultiAudio.src = buildNativeMultiAudioUrl();
    nativeMultiAudio.load();
  }
  updateMediaSessionMetadata();
  try {
    await nativeMultiAudio.play();
  } catch (err) {
    nativeStopExpected = false;
    throw err;
  }
  nativeAudioStarted = true;
  nativeStopExpected = false;
  nativePreloadActive = false;
  players.forEach((player) => {
    player.started = true;
    player.paused = false;
    player.resetNativeLevelSync();
  });
  players.forEach((player) => player.sendNativeGain({ immediate: true }));
  updateHeader();
}

function preloadNativeMultiAudio() {
  if (!nativeMultiAudio || multiPlaybackRequested || nativePreloadActive) return;
  nativeStopExpected = true;
  nativeMultiAudio.preload = 'auto';
  nativeMultiAudio.src = buildNativeMultiAudioUrl();
  nativeMultiAudio.load();
  updateMediaSessionMetadata();
  nativePreloadActive = true;
  nativeStopExpected = false;
}

function buildNativeMultiAudioUrl() {
  const query = new URLSearchParams({
    streams: streams.map((stream) => stream.name).join(','),
    clientId: getClientId(),
    t: String(Date.now()),
  });
  return `/multi/native.aac?${query.toString()}`;
}

function updateMediaSessionMetadata() {
  if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: 'Multi Stream',
    artist: streams.map((stream) => stream.label).join(', '),
    album: 'UDP Airband Server',
  });
}

function stopNativeMultiAudio() {
  if (!nativeMultiAudio) return;
  nativeStopExpected = true;
  clearTimeout(nativeReconnectTimer);
  nativeMultiAudio.pause();
  nativeMultiAudio.removeAttribute('src');
  nativeMultiAudio.load();
  nativeAudioStarted = false;
  nativePreloadActive = false;
  nativeStartPromise = null;
  players.forEach((player) => player.resetNativeLevelSync());
}

function setGlobalMode(mode, options = {}) {
  if (!['raw', 'opus'].includes(mode)) return;
  const changed = globalMode !== mode;
  globalMode = mode;
  players.forEach((player) => {
    if (changed) player.started = false;
    player.resetNativeLevelSync();
    player.updateLabels();
  });
  updateModeControls();
  if (changed && multiPlaybackRequested && !options.deferStart) {
    startSelectedGlobalMode().catch(() => {});
  }
}

function showModeNotice(mode) {
  if (!['raw', 'opus'].includes(mode)) return;
  pendingNoticeMode = mode;
  setGlobalMode(mode, { deferStart: true });
  if (multiNoticeTitle) multiNoticeTitle.textContent = t(mode === 'opus' ? 'compatibleNoticeTitle' : 'realTimeNoticeTitle');
  if (multiNoticeBody) multiNoticeBody.textContent = t(mode === 'opus' ? 'compatibleNoticeBody' : 'realTimeNoticeBody');
  if (multiStartButton) multiStartButton.textContent = t('accept');
  if (multiStartOverlay) multiStartOverlay.hidden = false;
  if (mode === 'opus') preloadNativeMultiAudio();
  else stopNativeMultiAudio();
}

function updateModeNotice() {
  if (!pendingNoticeMode) return;
  if (multiNoticeTitle) multiNoticeTitle.textContent = t(pendingNoticeMode === 'opus' ? 'compatibleNoticeTitle' : 'realTimeNoticeTitle');
  if (multiNoticeBody) multiNoticeBody.textContent = t(pendingNoticeMode === 'opus' ? 'compatibleNoticeBody' : 'realTimeNoticeBody');
  if (multiStartButton) multiStartButton.textContent = t('accept');
}

function shouldRecoverNativeAudio() {
  return globalMode === 'opus' && multiPlaybackRequested && !globalPaused;
}

function nativeNeedsReconnect() {
  return shouldRecoverNativeAudio()
    && nativeMultiAudio
    && !nativeStartPromise
    && (!nativeAudioStarted || nativeMultiAudio.paused || nativeMultiAudio.error);
}

function handleNativePlaybackInterrupted(eventName) {
  if (nativeStopExpected || !shouldRecoverNativeAudio()) return;
  if (nativeStartPromise) return;
  if (eventName === 'stalled' && nativeMultiAudio && !nativeMultiAudio.paused && !nativeMultiAudio.error) return;
  nativeAudioStarted = false;
  players.forEach((player) => player.resetNativeLevelSync());
  updateHeader();
  if (document.visibilityState === 'visible') {
    scheduleNativeReconnect(500);
  }
}

function scheduleNativeReconnect(delayMs) {
  if (!shouldRecoverNativeAudio() || document.visibilityState === 'hidden') return;
  clearTimeout(nativeReconnectTimer);
  nativeReconnectTimer = setTimeout(() => {
    recoverNativeAudio().catch(() => {});
  }, delayMs);
}

async function recoverNativeAudio() {
  if (!shouldRecoverNativeAudio() || nativeReconnectInFlight) return;
  nativeReconnectInFlight = true;
  try {
    await startNativeMultiAudio();
    if (multiStartOverlay) multiStartOverlay.hidden = true;
  } catch {
    nativeAudioStarted = false;
    if (multiStartOverlay) multiStartOverlay.hidden = false;
  } finally {
    nativeReconnectInFlight = false;
  }
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
  updateHeader();
}

class MultiStreamPlayer {
  constructor(stream) {
    this.stream = stream;
    this.config = { ...stream, compressedCodec: 'adpcm', compressedAvailable: false };
    this.clientId = getClientId(stream.name);
    this.mode = 'raw';
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
    this.nextPlayTime = 0;
    this.socketGeneration = 0;
    this.scheduledSources = new Set();
    this.nativeGainTimer = null;
  }

  bind(card) {
    this.card = card;
    this.nameEl = card.querySelector('[data-role="name"]');
    this.compactToggle = card.querySelector('[data-role="compact-toggle"]');
    this.compactNameEl = card.querySelector('[data-role="compact-name"]');
    this.lastEl = card.querySelector('[data-role="last"]');
    this.modeButton = card.querySelector('[data-role="mode"]');
    this.startButton = card.querySelector('[data-role="start"]');
    this.nativeMuteButton = card.querySelector('[data-role="native-mute"]');
    this.gainInput = card.querySelector('[data-role="gain"]');
    this.gainValue = card.querySelector('[data-role="gain-value"]');
    this.levelDb = card.querySelector('[data-role="level-db"]');
    this.levelMask = card.querySelector('[data-role="level-mask"]');
    this.nameEl.textContent = this.stream.label;
    this.updateCompactLabel();
    this.compactToggle.addEventListener('click', () => {
      if (globalMode !== 'raw') return;
      this.card.classList.toggle('expanded');
      this.compactToggle.setAttribute('aria-expanded', String(this.card.classList.contains('expanded')));
    });
    this.modeButton.addEventListener('click', () => {
      this.mode = this.mode === 'raw' ? 'opus' : 'raw';
      if (this.started && !this.paused) this.startAudio();
      this.updateLabels();
    });
    this.startButton.addEventListener('click', async () => {
      if (!this.started) {
        await this.startAudio();
      } else {
        this.muted = !this.muted;
        this.applyGain();
      }
      this.updateLabels();
    });
    this.nativeMuteButton.addEventListener('click', () => {
      this.muted = !this.muted;
      this.applyGain();
      this.sendNativeGain({ immediate: true });
      this.updateLabels();
    });
    this.gainInput.addEventListener('input', () => {
      this.gain = Number(this.gainInput.value);
      this.gainValue.textContent = `${Math.round(this.gain * 100)}%`;
      this.applyGain();
      this.sendNativeGain();
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
    this.controlWs = new WebSocket(`${wsProtocol()}://${location.host}/${encodeURIComponent(this.stream.name)}/control?clientId=${encodeURIComponent(this.clientId)}`);
    this.controlWs.addEventListener('open', () => {
      this.controlOpen = true;
      updateHeader();
    });
    this.controlWs.addEventListener('close', () => {
      this.controlOpen = false;
      setTimeout(() => this.connectControl(), 1000);
      updateHeader();
    });
    this.controlWs.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'config') {
        this.config = { ...this.config, ...message };
        this.configReady = true;
        this.startIfReady();
      } else if (message.type === 'stats') {
        this.activeListeners = message.activeListeners || 0;
        this.bandwidth = message.listenerBitsPerSecond || this.bandwidth || 0;
        if (globalMode === 'opus') {
          this.peak = Number(message.levelPeak) || 0;
          this.lastAudioAt = this.peak > 0 ? Date.now() : 0;
        }
        this.lastHeardAt = message.lastHeardAt || 0;
        this.lastHeardLabel = message.lastHeardLabel || 'never';
        if (message.hasUdp || this.lastHeardAt) this.confirmed = true;
      }
      this.updateLabels();
      updateHeader();
    });
  }

  async startAudio() {
    const context = ensureAudioContext();
    if (context.state !== 'running') await context.resume();
    if (!this.gainNode) {
      this.gainNode = context.createGain();
      this.gainNode.connect(context.destination);
    }
    this.nextPlayTime = context.currentTime + 0.25;
    this.started = true;
    this.paused = false;
    this.stopAudioSockets();
    if (this.mode === 'opus' && this.config.compressedAvailable && this.config.compressedCodec === 'adpcm') {
      this.startAdpcm();
    } else {
      this.startRaw();
    }
    this.applyGain();
    this.updateLabels();
  }

  async startIfReady() {
    if (globalMode !== 'raw' || !multiPlaybackRequested || this.started || !this.configReady) return;
    try {
      await this.startAudio();
    } catch {
      this.started = false;
      this.updateLabels();
    }
  }

  startRaw() {
    const generation = this.socketGeneration;
    this.currentMode = 'raw';
    this.rawWs = new WebSocket(`${wsProtocol()}://${location.host}/${encodeURIComponent(this.stream.name)}/audio?clientId=${encodeURIComponent(this.clientId)}`);
    this.rawWs.binaryType = 'arraybuffer';
    this.rawWs.addEventListener('message', (event) => {
      if (generation !== this.socketGeneration) return;
      const samples = new Float32Array(event.data);
      const frames = samples.length / this.config.channels;
      if (!Number.isInteger(frames)) return;
      this.receivedBytes += event.data.byteLength || 0;
      this.confirmed = true;
      this.lastAudioAt = Date.now();
      this.peak = Math.max(this.peak * 0.55, peakOf(samples));
      this.schedule(samples, frames);
    });
    this.rawWs.addEventListener('close', () => {
      if (generation === this.socketGeneration && this.started && !this.paused && this.currentMode === 'raw') setTimeout(() => this.startRaw(), 1000);
    });
  }

  startAdpcm() {
    const generation = this.socketGeneration;
    this.currentMode = 'opus';
    this.adpcmWs = new WebSocket(`${wsProtocol()}://${location.host}/${encodeURIComponent(this.stream.name)}/adpcm?clientId=${encodeURIComponent(this.clientId)}`);
    this.adpcmWs.binaryType = 'arraybuffer';
    this.adpcmWs.addEventListener('message', (event) => {
      if (generation !== this.socketGeneration) return;
      const decoded = decodeAdpcmFrame(event.data);
      if (!decoded) return;
      this.config.sampleRate = decoded.sampleRate;
      this.config.channels = decoded.channels;
      this.receivedBytes += event.data.byteLength || 0;
      this.confirmed = true;
      this.lastAudioAt = Date.now();
      this.peak = Math.max(this.peak * 0.55, peakOf(decoded.samples));
      this.schedule(decoded.samples, decoded.frames);
    });
    this.adpcmWs.addEventListener('close', () => {
      if (generation === this.socketGeneration && this.started && !this.paused && this.currentMode === 'opus') setTimeout(() => this.startAdpcm(), 1000);
    });
  }

  schedule(samples, frames) {
    const context = ensureAudioContext();
    const now = context.currentTime;
    if (this.nextPlayTime < now + 0.05 || this.nextPlayTime > now + 1.0) this.nextPlayTime = now + 0.25;
    const buffer = context.createBuffer(this.config.channels, frames, this.config.sampleRate);
    for (let channel = 0; channel < this.config.channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < frames; i += 1) data[i] = samples[i * this.config.channels + channel];
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);
    this.scheduledSources.add(source);
    source.addEventListener('ended', () => this.scheduledSources.delete(source));
    source.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;
  }

  pause() {
    this.paused = true;
    this.stopRealtimeAudio();
    this.updateLabels();
  }

  resume() {
    this.paused = false;
    if (this.started) this.startAudio();
  }

  stopAudioSockets() {
    this.socketGeneration += 1;
    if (this.rawWs) this.rawWs.close();
    if (this.adpcmWs) this.adpcmWs.close();
    this.rawWs = null;
    this.adpcmWs = null;
  }

  stopRealtimeAudio() {
    this.stopAudioSockets();
    this.stopScheduledSources();
    this.bandwidth = 0;
    this.peak = 0;
    this.resetNativeLevelSync();
    this.lastAudioAt = 0;
  }

  stopScheduledSources() {
    for (const source of this.scheduledSources) {
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
    }
    this.scheduledSources.clear();
    this.nextPlayTime = 0;
  }

  applyGain() {
    if (this.gainNode) this.gainNode.gain.value = this.muted ? 0 : this.gain;
  }

  resetNativeLevelSync() {
    this.peak = 0;
    this.lastAudioAt = 0;
  }

  updateMeter() {
    const now = Date.now();
    const elapsed = Math.max(0.001, (now - this.lastBandwidthAt) / 1000);
    if (globalMode !== 'opus') {
      this.bandwidth = this.paused ? 0 : Math.max(0, (this.receivedBytes - this.lastBandwidthBytes) * 8 / elapsed);
    }
    this.lastBandwidthBytes = this.receivedBytes;
    this.lastBandwidthAt = now;
    if (!this.lastAudioAt || now - this.lastAudioAt > 400 || globalPaused) {
      this.peak = 0;
    } else if (globalMode !== 'opus') {
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
    this.modeButton.textContent = this.mode === 'opus' ? t('compressed') : t('uncompressed');
    this.startButton.textContent = this.started ? (this.muted ? t('unmute') : t('mute')) : t('startAudio');
    this.nativeMuteButton.classList.toggle('muted', this.muted);
    this.nativeMuteButton.setAttribute('aria-label', this.muted ? t('unmute') : t('mute'));
    this.updateCardModeState();
  }

  updateCompactLabel() {
    if (!this.compactNameEl) return;
    this.compactNameEl.textContent = `${this.stream.label} | ${localizeLastHeard(this.lastHeardLabel)}`;
  }

  updateCardModeState() {
    if (!this.card) return;
    const isRaw = globalMode === 'raw';
    this.card.classList.toggle('raw-mode', isRaw);
    this.card.classList.toggle('compressed-mode', !isRaw);
    if (!isRaw) this.card.classList.remove('expanded');
    if (this.compactToggle) {
      this.compactToggle.disabled = !isRaw;
      this.compactToggle.setAttribute('aria-expanded', String(isRaw && this.card.classList.contains('expanded')));
    }
  }

  sendNativeGain(options = {}) {
    if (globalMode !== 'opus' || !multiPlaybackRequested) return;
    const send = () => {
      const query = new URLSearchParams({
        clientId: getClientId(),
        stream: this.stream.name,
        gain: String(this.muted ? 0 : this.gain),
      });
      fetch(`/multi/native-gain?${query.toString()}`).catch(() => {});
    };
    if (options.immediate) {
      clearTimeout(this.nativeGainTimer);
      this.nativeGainTimer = null;
      send();
      return;
    }
    if (this.nativeGainTimer) return;
    this.nativeGainTimer = setTimeout(() => {
      this.nativeGainTimer = null;
      send();
    }, 500);
  }
}

function decodeAdpcmFrame(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 24 || view.getUint8(0) !== 0x41 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x50 || view.getUint8(3) !== 0x31) return null;
  const channels = view.getUint8(4);
  const headerBytes = view.getUint16(6, true);
  const sampleRate = view.getUint32(8, true);
  const frames = view.getUint16(16, true);
  const payloadBytes = view.getUint16(18, true);
  if (![1, 2].includes(channels) || headerBytes !== 20 + channels * 4 || frames < 1 || view.byteLength < headerBytes + payloadBytes) return null;
  const states = [];
  const samples = new Float32Array(frames * channels);
  for (let channel = 0; channel < channels; channel += 1) {
    const offset = 20 + channel * 4;
    states.push({ predictor: view.getInt16(offset, true), index: view.getUint8(offset + 2) });
    samples[channel] = states[channel].predictor / 32768;
  }
  let nibbleIndex = 0;
  for (let frame = 1; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const byteValue = view.getUint8(headerBytes + Math.floor(nibbleIndex / 2));
      const code = nibbleIndex % 2 === 0 ? byteValue & 0x0f : byteValue >> 4;
      samples[frame * channels + channel] = decodeAdpcmNibble(code, states[channel]) / 32768;
      nibbleIndex += 1;
    }
  }
  return { samples, frames, channels, sampleRate };
}

const adpcmIndexTable = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
const adpcmStepTable = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];

function decodeAdpcmNibble(code, state) {
  const step = adpcmStepTable[state.index] || 7;
  let delta = step >> 3;
  if (code & 4) delta += step;
  if (code & 2) delta += step >> 1;
  if (code & 1) delta += step >> 2;
  state.predictor = clamp(state.predictor + ((code & 8) ? -delta : delta), -32768, 32767);
  state.index = clamp(state.index + adpcmIndexTable[code], 0, adpcmStepTable.length - 1);
  return state.predictor;
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
