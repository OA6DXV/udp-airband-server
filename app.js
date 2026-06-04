const startButton = document.getElementById('start');
const gainInput = document.getElementById('gain');
const gainLabel = document.getElementById('gainLabel');
const gainValue = document.getElementById('gainValue');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const bufferedEl = document.getElementById('buffered');
const browserBandwidthEl = document.getElementById('browserBandwidth');
const lastHeardEl = document.getElementById('lastHeard');
const activeUsersEl = document.getElementById('activeUsers');
const modeButton = document.getElementById('mode');
const levelMaskEl = document.getElementById('levelMask');
const levelValueEl = document.getElementById('levelValue');
const localTimeEl = document.getElementById('localTime');
const utcTimeEl = document.getElementById('utcTime');
const languageToggle = document.getElementById('languageToggle');
const languageCode = document.getElementById('languageCode');
const languageMenu = document.getElementById('languageMenu');
const languageOptions = Array.from(document.querySelectorAll('.language-option'));
const canvas = document.getElementById('scope');
const ctx = canvas.getContext('2d');

const translations = {
  en: {
    users: 'Users', gain: 'Gain', startAudio: 'Start Audio', mute: 'Mute', unmute: 'Unmute', buffered: 'Buffered', bandwidth: 'Bandwidth', lastHeardTime: 'Last Heard Time', mode: 'Mode', level: 'Level', localTime: 'Local Time', disconnected: 'Disconnected', waitingUdp: 'Waiting for UDP', connected: 'Connected', opusUnavailable: 'Compressed unavailable', compressed: 'Compressed', uncompressed: 'Uncompressed', switchMode: 'Switch compressed/uncompressed audio', opusNeedsFfmpeg: 'Compressed mode needs ffmpeg on the server', never: 'never', now: 'Now',
  },
  es: {
    users: 'Usuarios', gain: 'Ganancia', startAudio: 'Iniciar audio', mute: 'Silenciar', unmute: 'Activar audio', buffered: 'Buffer', bandwidth: 'Ancho de banda', lastHeardTime: 'Ultima transmision', mode: 'Modo', level: 'Nivel', localTime: 'Hora local', disconnected: 'Desconectado', waitingUdp: 'Esperando UDP', connected: 'Conectado', opusUnavailable: 'Comprimido no disponible', compressed: 'Comprimido', uncompressed: 'Sin comprimir', switchMode: 'Cambiar audio comprimido/sin comprimir', opusNeedsFfmpeg: 'El modo comprimido necesita ffmpeg en el servidor', never: 'nunca', now: 'Ahora',
  },
};

let language = localStorage.getItem('udp-airband-language') || 'en';
if (!translations[language]) language = 'en';
let currentStatusKey = 'disconnected';
let lastHeardLabel = 'never';

let audioContext;
let gainNode;
let config = { sampleRate: 8000, channels: 1 };
let queuedFrames = 0;
const targetLatencySeconds = 0.25;
let nextPlayTime = 0;
let gain = Number(gainInput.value);
let lastPeak = 0;
let latestWave = new Float32Array(0);
let lastUdpAt = 0;
let lastAudioAt = 0;
let streamConfirmed = false;
let wsGeneration = 0;
let controlWs;
let rawWs;
let suppressRawReconnect = false;
let opusAudio;
let opusSourceNode;
let opusAnalyser;
let opusAnalyserBuffer;
let opusWs;
let suppressOpusReconnect = false;
let opusMediaSource;
let opusSourceBuffer;
let opusObjectUrl;
let opusQueue = [];
const opusMimeType = 'audio/webm; codecs="opus"';
const aacMimeType = 'audio/mp4; codecs="mp4a.40.2"';
let compressedTransport = null;
let currentMode = 'raw';
let preferredMode = isMobileDevice() ? 'opus' : 'raw';
let opusAvailable = false;
let audioStarted = false;
let muted = false;
let receivedBytes = 0;
let lastBandwidthBytes = 0;
let lastBandwidthAt = Date.now();
const maxOpusLiveBufferSeconds = 1.25;
const targetOpusLiveBufferSeconds = 0.35;
const clientId = getClientId();
const streamName = location.pathname.replace(/^\/+|\/+$/g, '');
applyLanguage();
connectControlWebSocket();

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

gainInput.addEventListener('input', () => {
  gain = Number(gainInput.value);
  gainValue.value = `${Math.round(gain * 100)}%`;
  applyOutputGain();
});

modeButton.addEventListener('click', () => {
  preferredMode = preferredMode === 'raw' ? 'opus' : 'raw';
  if (audioStarted && audioContext) startSelectedMode();
  updateModeButton();
});

startButton.addEventListener('click', async () => {
  if (audioStarted) {
    muted = !muted;
    applyOutputGain();
    updateAudioButton();
    updateGainControl();
    return;
  }

  if (!audioContext) {
    audioContext = new AudioContext();
    gainNode = audioContext.createGain();
    applyOutputGain();
    gainNode.connect(audioContext.destination);
    nextPlayTime = audioContext.currentTime + targetLatencySeconds;
  }

  await audioContext.resume();
  connectControlWebSocket();
  startSelectedMode();
  audioStarted = true;
  updateAudioButton();
  updateGainControl();
  updateConnectionState();
});

function applyOutputGain() {
  if (gainNode) gainNode.gain.value = muted ? 0 : gain;
  if (opusAudio) opusAudio.muted = muted && !opusSourceNode;
}

function updateAudioButton() {
  startButton.textContent = audioStarted ? (muted ? t('unmute') : t('mute')) : t('startAudio');
  startButton.disabled = false;
}

function updateGainControl() {
  gainInput.disabled = muted;
  gainLabel.classList.toggle('gain-muted', muted);
}

function connectControlWebSocket() {
  if (controlWs && controlWs.readyState <= 1) return;

  const generation = ++wsGeneration;
  controlWs = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/${encodeURIComponent(streamName)}/control?clientId=${encodeURIComponent(clientId)}`);

  controlWs.addEventListener('open', () => {
    if (generation === wsGeneration) updateConnectionState();
  });
  controlWs.addEventListener('close', () => {
    if (generation === wsGeneration) {
      setStatus('', 'disconnected');
      setTimeout(connectControlWebSocket, 1000);
    }
  });
  controlWs.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      const message = JSON.parse(event.data);
      if (message.type === 'config') {
        config = message;
        opusAvailable = Boolean(message.opusAvailable);
        compressedTransport = getCompressedTransport();
        document.title = `${message.label} - UDP Airband Monitor`;
        document.getElementById('title').textContent = message.label;
        if (audioContext && preferredMode === 'opus' && isCompressedAvailable() && currentMode !== 'opus') {
          startSelectedMode();
        }
        updateModeButton();
        updateConnectionState();
      } else if (message.type === 'stats') {
        browserBandwidthEl.textContent = formatBandwidth(message.listenerBitsPerSecond || 0);
        activeUsersEl.textContent = String(message.activeListeners || message.clients || 0);
        lastUdpAt = message.lastHeardAt || message.lastUdpAt || 0;
        lastHeardLabel = message.lastHeardLabel || 'never';
        lastHeardEl.textContent = localizeLastHeard(lastHeardLabel);
        if (message.hasUdp || lastUdpAt || message.packetCount > 0) {
          streamConfirmed = true;
        }
        updateConnectionState();
      }
    }
  });
}

function updateConnectionState() {
  if (!controlWs || controlWs.readyState !== WebSocket.OPEN) {
    setStatus('', 'disconnected');
    return;
  }
  setStatus(streamConfirmed ? 'live' : 'ready', streamConfirmed ? 'connected' : 'waitingUdp');
}

function startSelectedMode() {
  if (preferredMode === 'opus' && isCompressedAvailable()) {
    startOpus();
  } else {
    startRaw();
  }
  updateModeButton();
}

function startRaw() {
  stopOpus();
  if (rawWs && rawWs.readyState <= 1) return;

  rawWs = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/${encodeURIComponent(streamName)}/audio?clientId=${encodeURIComponent(clientId)}`);
  rawWs.binaryType = 'arraybuffer';
  rawWs.addEventListener('close', () => {
    if (suppressRawReconnect) {
      suppressRawReconnect = false;
      return;
    }
    if (currentMode === 'raw') setTimeout(startRaw, 1000);
  });
  rawWs.addEventListener('message', (event) => {
    receivedBytes += event.data.byteLength || 0;
    const samples = new Float32Array(event.data);
    const frames = samples.length / config.channels;
    if (!Number.isInteger(frames)) return;

    streamConfirmed = true;
    scheduleAudio(samples, frames);
    latestWave = samples;
    lastPeak = Math.max(lastPeak * 0.92, peakOf(samples));
    lastAudioAt = Date.now();
    updateConnectionState();
  });
  currentMode = 'raw';
}

function startOpus() {
  stopRaw();
  stopOpus();

  const transport = getCompressedTransport();
  if (!transport) {
    startRaw();
    return;
  }

  if (transport.hls) {
    startHlsCompressed();
    return;
  }

  if (transport.httpFallback) {
    startHttpOpus();
    return;
  }

  ensureOpusAudio();
  setupOpusAudioGraph();
  opusQueue = [];
  const MediaSourceCtor = getMediaSourceConstructor();
  opusMediaSource = new MediaSourceCtor();
  opusObjectUrl = URL.createObjectURL(opusMediaSource);
  opusAudio.src = opusObjectUrl;
  opusAudio.play().catch(() => setStatus('', 'opusUnavailable'));
  currentMode = 'opus';

  opusMediaSource.addEventListener('sourceopen', () => {
    if (!opusMediaSource || opusMediaSource.readyState !== 'open') return;

    opusSourceBuffer = opusMediaSource.addSourceBuffer(transport.mimeType);
    opusSourceBuffer.mode = 'sequence';
    opusSourceBuffer.addEventListener('updateend', () => {
      trimOpusBuffer();
      drainOpusQueue();
    });

    opusWs = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/${encodeURIComponent(streamName)}/${transport.endpoint}?clientId=${encodeURIComponent(clientId)}`);
    opusWs.binaryType = 'arraybuffer';
    opusWs.addEventListener('message', (event) => {
      streamConfirmed = true;
      receivedBytes += event.data.byteLength || 0;
      enqueueOpusChunk(event.data);
      updateConnectionState();
    });
    opusWs.addEventListener('close', () => {
      if (suppressOpusReconnect) {
        suppressOpusReconnect = false;
        return;
      }
      if (currentMode === 'opus' && audioStarted) setTimeout(startOpus, 1000);
    });
    opusWs.addEventListener('error', () => setStatus('', 'opusUnavailable'));
  }, { once: true });
}

function startHttpOpus() {
  if (!opusAudio) {
    ensureOpusAudio();
  }
  setupOpusAudioGraph();
  applyOutputGain();
  opusAudio.src = `/${encodeURIComponent(streamName)}/opus?clientId=${encodeURIComponent(clientId)}&t=${Date.now()}`;
  opusAudio.play().catch(() => setStatus('', 'opusUnavailable'));
  currentMode = 'opus';
}

function startHlsCompressed() {
  if (!opusAudio) {
    ensureOpusAudio();
  }
  setupOpusAudioGraph();
  applyOutputGain();
  opusAudio.src = `/${encodeURIComponent(streamName)}/hls/${encodeURIComponent(clientId)}/playlist.m3u8?t=${Date.now()}`;
  opusAudio.play().catch(() => setStatus('', 'opusUnavailable'));
  currentMode = 'opus';
}

function ensureOpusAudio() {
  if (opusAudio) return;
  opusAudio = new Audio();
  opusAudio.preload = 'none';
  opusAudio.muted = muted;
  opusAudio.addEventListener('playing', updateConnectionState);
  opusAudio.addEventListener('waiting', updateConnectionState);
  opusAudio.addEventListener('error', () => setStatus('', 'opusUnavailable'));
}

function setupOpusAudioGraph() {
  if (!audioContext || !gainNode || !opusAudio || opusSourceNode) return;
  opusSourceNode = audioContext.createMediaElementSource(opusAudio);
  opusAnalyser = audioContext.createAnalyser();
  opusAnalyser.fftSize = 1024;
  opusAnalyserBuffer = new Float32Array(opusAnalyser.fftSize);
  opusSourceNode.connect(opusAnalyser);
  opusAnalyser.connect(gainNode);
  applyOutputGain();
}

function enqueueOpusChunk(chunk) {
  opusQueue.push(chunk);
  if (opusQueue.length > 120) {
    opusQueue.splice(1, opusQueue.length - 120);
  }
  drainOpusQueue();
}

function drainOpusQueue() {
  if (!opusSourceBuffer || opusSourceBuffer.updating || !opusQueue.length) return;
  try {
    opusSourceBuffer.appendBuffer(opusQueue.shift());
  } catch {
    setStatus('', 'opusUnavailable');
  }
}

function trimOpusBuffer() {
  if (!opusAudio || opusAudio.buffered.length === 0) return;

  syncOpusLivePlayback();
  if (!opusSourceBuffer || opusSourceBuffer.updating) return;

  const liveEdge = opusAudio.buffered.end(opusAudio.buffered.length - 1);
  const removeEnd = liveEdge - 4;
  if (removeEnd > 0 && opusAudio.buffered.start(0) < removeEnd) {
    try {
      opusSourceBuffer.remove(0, removeEnd);
    } catch {
      // Ignore transient MediaSource states while the browser is updating.
    }
  }
}

function syncOpusLivePlayback() {
  if (!opusAudio || opusAudio.buffered.length === 0) return;

  const liveEdge = opusAudio.buffered.end(opusAudio.buffered.length - 1);
  const bufferedSeconds = liveEdge - opusAudio.currentTime;
  if (bufferedSeconds > maxOpusLiveBufferSeconds) {
    opusAudio.currentTime = Math.max(0, liveEdge - targetOpusLiveBufferSeconds);
  }
}

function stopRaw() {
  if (rawWs) {
    suppressRawReconnect = true;
    rawWs.close();
    rawWs = null;
  }
}

function stopOpus() {
  if (opusWs) {
    suppressOpusReconnect = true;
    opusWs.close();
    opusWs = null;
  }
  opusQueue = [];
  if (opusAudio) {
    opusAudio.pause();
    opusAudio.removeAttribute('src');
    opusAudio.load();
  }
  opusSourceBuffer = null;
  if (opusMediaSource && opusMediaSource.readyState === 'open') {
    try {
      opusMediaSource.endOfStream();
    } catch {
      // The stream may already be closing.
    }
  }
  opusMediaSource = null;
  if (opusObjectUrl) {
    URL.revokeObjectURL(opusObjectUrl);
    opusObjectUrl = null;
  }
}

function updateModeButton() {
  const visibleMode = audioStarted ? currentMode : preferredMode;
  modeButton.textContent = visibleMode === 'opus' ? t('compressed') : t('uncompressed');
  modeButton.disabled = !isCompressedAvailable();
  modeButton.title = isCompressedAvailable() ? t('switchMode') : t('opusNeedsFfmpeg');
  if (!isCompressedAvailable() && visibleMode === 'raw') {
    modeButton.textContent = t('uncompressed');
  }
}

function scheduleAudio(samples, frames) {
  if (!audioContext || !gainNode) return;

  const now = audioContext.currentTime;
  if (nextPlayTime < now + 0.05 || nextPlayTime > now + 1.0) {
    nextPlayTime = now + targetLatencySeconds;
  }

  const buffer = audioContext.createBuffer(config.channels, frames, config.sampleRate);
  for (let channel = 0; channel < config.channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < frames; i += 1) {
      data[i] = samples[i * config.channels + channel];
    }
  }

  const source = audioContext.createBufferSource();
  const sourceGain = audioContext.createGain();
  source.buffer = buffer;
  source.connect(sourceGain);
  sourceGain.connect(gainNode);
  applyResumeFade(sourceGain, nextPlayTime);
  source.start(nextPlayTime);
  nextPlayTime += buffer.duration;
  queuedFrames = Math.max(0, Math.round((nextPlayTime - now) * config.sampleRate));
}

function applyResumeFade(sourceGain, startTime) {
  const idleMs = Date.now() - lastAudioAt;
  if (!lastAudioAt || idleMs < 900) {
    sourceGain.gain.setValueAtTime(1, startTime);
    return;
  }

  sourceGain.gain.setValueAtTime(0, startTime);
  sourceGain.gain.linearRampToValueAtTime(1, startTime + 0.08);
}

function peakOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.abs(samples[i]);
    if (value > peak) peak = value;
  }
  return peak;
}

function formatBandwidth(bitsPerSecond) {
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbps`;
  if (bitsPerSecond >= 1_000) return `${(bitsPerSecond / 1_000).toFixed(1)} kbps`;
  return `${Math.round(bitsPerSecond)} bps`;
}

function updateLastHeard() {
  if (!lastUdpAt) lastHeardEl.textContent = t('never');
}

function updateLevelMeter() {
  const db = lastPeak > 0 ? 20 * Math.log10(lastPeak) : -60;
  const clamped = Math.max(-60, Math.min(0, db));
  const percent = (clamped + 60) / 60 * 100;
  levelMaskEl.style.width = `${100 - percent}%`;
  levelValueEl.textContent = db <= -60 ? '-\u221e dB' : `${db.toFixed(1)} dB`;
}

function setStatus(state, textKey) {
  statusEl.className = `status ${state}`;
  currentStatusKey = textKey;
  statusText.textContent = t(textKey);
}

function draw() {
  if (currentMode === 'opus' && opusAnalyser && opusAnalyserBuffer) {
    opusAnalyser.getFloatTimeDomainData(opusAnalyserBuffer);
    latestWave = opusAnalyserBuffer;
    lastPeak = Math.max(lastPeak * 0.92, peakOf(opusAnalyserBuffer));
  } else if (currentMode === 'raw' && lastAudioAt && Date.now() - lastAudioAt > 350) {
    latestWave = new Float32Array(0);
    lastPeak = 0;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#394451';
  ctx.beginPath();
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();

  ctx.strokeStyle = '#4fb477';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const step = Math.max(1, Math.floor(latestWave.length / canvas.width));
  for (let x = 0; x < canvas.width; x += 1) {
    const sample = latestWave[x * step * config.channels] || 0;
    const y = canvas.height / 2 - Math.max(-1, Math.min(1, sample * gain)) * canvas.height * 0.45;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  lastPeak *= 0.985;
  updateLevelMeter();
  requestAnimationFrame(draw);
}
draw();
setInterval(updateBuffered, 500);
setInterval(updateLastHeard, 500);
updateClocks();
setInterval(updateClocks, 1000);

function updateBuffered() {
  updateBrowserBandwidth();
  if (currentMode === 'opus') {
    syncOpusLivePlayback();
    bufferedEl.textContent = `${getOpusBufferedMs()} ms`;
    return;
  }
  if (audioContext) {
    queuedFrames = Math.max(0, Math.round((nextPlayTime - audioContext.currentTime) * config.sampleRate));
  }
  const bufferedMs = config.sampleRate ? Math.round(queuedFrames / config.sampleRate * 1000) : 0;
  bufferedEl.textContent = `${bufferedMs} ms`;
}

function updateBrowserBandwidth() {
  const now = Date.now();
  const elapsedSeconds = Math.max(0.001, (now - lastBandwidthAt) / 1000);
  const bitsPerSecond = Math.max(0, (receivedBytes - lastBandwidthBytes) * 8 / elapsedSeconds);
  lastBandwidthBytes = receivedBytes;
  lastBandwidthAt = now;
  browserBandwidthEl.textContent = formatBandwidth(bitsPerSecond);
}

function getOpusBufferedMs() {
  if (!opusAudio || opusAudio.buffered.length === 0) return 0;
  const liveEdge = opusAudio.buffered.end(opusAudio.buffered.length - 1);
  return Math.max(0, Math.round((liveEdge - opusAudio.currentTime) * 1000));
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

function t(key) {
  return translations[language][key] || translations.en[key] || key;
}

function applyLanguage() {
  document.documentElement.lang = language;
  languageCode.textContent = language.toUpperCase();
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  languageOptions.forEach((option) => {
    option.classList.toggle('active', option.dataset.lang === language);
  });
  updateAudioButton();
  updateModeButton();
  statusText.textContent = t(currentStatusKey);
  lastHeardEl.textContent = localizeLastHeard(lastHeardLabel);
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

function isCompressedAvailable() {
  return Boolean(getCompressedTransport());
}

function getCompressedTransport() {
  if (!opusAvailable) return null;

  const supportsAac = isMediaSourceTypeSupported(aacMimeType);
  const supportsOpus = isMediaSourceTypeSupported(opusMimeType);

  if (isAppleMobileDevice()) {
    return { hls: true };
  }
  if (supportsOpus) {
    return { endpoint: 'opus', mimeType: opusMimeType };
  }
  if (supportsAac) {
    return { endpoint: 'aac', mimeType: aacMimeType };
  }
  if (!isAppleMobileDevice()) {
    return { endpoint: 'opus', httpFallback: true };
  }
  return null;
}

function getMediaSourceConstructor() {
  return window.MediaSource || window.ManagedMediaSource;
}

function isMediaSourceTypeSupported(mimeType) {
  const MediaSourceCtor = getMediaSourceConstructor();
  return Boolean(MediaSourceCtor && MediaSourceCtor.isTypeSupported(mimeType));
}

function isAppleMobileDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function getClientId() {
  const key = 'udp-airband-client-id';
  let value = localStorage.getItem(key);
  if (!value) {
    value = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, value);
  }
  return value;
}
