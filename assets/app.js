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
const titleLink = document.getElementById('title');
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
    users: 'Users', gain: 'Gain', startAudio: 'Start Audio', mute: 'Mute', unmute: 'Unmute', buffered: 'Buffered', bandwidth: 'Bandwidth', lastHeardTime: 'Last Heard Time', mode: 'Mode', level: 'Level', localTime: 'Local Time', disconnected: 'Disconnected', waitingUdp: 'Waiting for UDP', connected: 'Connected', idle: 'Push to Reconnect', stopStream: 'Stop stream', returnHome: 'Click to return home', opusUnavailable: 'Compressed unavailable', compressed: 'Compressed', uncompressed: 'Uncompressed', switchMode: 'Switch compressed/uncompressed audio', opusNeedsFfmpeg: 'Compressed mode is unavailable on the server', never: 'never', now: 'Now',
  },
  es: {
    users: 'Usuarios', gain: 'Ganancia', startAudio: 'Iniciar audio', mute: 'Silenciar', unmute: 'Activar audio', buffered: 'Buffer', bandwidth: 'Ancho de banda', lastHeardTime: 'Ultima transmision', mode: 'Modo', level: 'Nivel', localTime: 'Hora local', disconnected: 'Desconectado', waitingUdp: 'Esperando UDP', connected: 'Conectado', idle: 'Presiona para reconectar', stopStream: 'Detener stream', returnHome: 'Click para volver a la pagina principal', opusUnavailable: 'Comprimido no disponible', compressed: 'Comprimido', uncompressed: 'Sin comprimir', switchMode: 'Cambiar audio comprimido/sin comprimir', opusNeedsFfmpeg: 'El modo comprimido no esta disponible en el servidor', never: 'nunca', now: 'Ahora',
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
let adpcmWs;
let suppressAdpcmReconnect = false;
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
let activeCompressedKind = null;
let usingNativeHls = false;
let currentMode = 'raw';
let preferredMode = isMobileDevice() ? 'opus' : 'raw';
let opusAvailable = false;
let compressedAvailable = false;
let audioStarted = false;
let muted = false;
let streamPaused = false;
let pausedMode = null;
let statusHovering = false;
let receivedBytes = 0;
let lastBandwidthBytes = 0;
let lastBandwidthAt = Date.now();
const maxOpusLiveBufferSeconds = 1.25;
const targetOpusLiveBufferSeconds = 0.35;
const waveformBarWidth = 6;
const waveformBarGap = 6;
const waveformMinBarHeight = 4;
const waveformVisualGain = 3;
const adpcmIndexTable = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
const adpcmStepTable = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
  19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
  130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
  337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
  876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
  2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
  5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
  15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
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

statusEl.addEventListener('click', () => {
  if (streamPaused) {
    resumeStream();
    return;
  }
  if (streamConfirmed && controlWs && controlWs.readyState === WebSocket.OPEN) {
    pauseStream();
  }
});
statusEl.addEventListener('mouseenter', () => {
  statusHovering = true;
  updateStatusLabel();
});
statusEl.addEventListener('mouseleave', () => {
  statusHovering = false;
  updateStatusLabel();
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
  streamPaused = false;
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
        compressedAvailable = Boolean(message.compressedAvailable);
        compressedTransport = getCompressedTransport();
        document.title = `${message.label} - UDP Airband Monitor`;
        titleLink.textContent = message.label;
        titleLink.title = t('returnHome');
        if (audioContext && preferredMode === 'opus' && isCompressedAvailable() && currentMode !== 'opus') {
          startSelectedMode();
        }
        updateModeButton();
        updateConnectionState();
      } else if (message.type === 'stats') {
        if (!streamPaused) {
          browserBandwidthEl.textContent = formatBandwidth(message.listenerBitsPerSecond || 0);
        }
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
  if (streamPaused) {
    setStatus('idle', 'idle');
    return;
  }
  if (!controlWs || controlWs.readyState !== WebSocket.OPEN) {
    setStatus('', 'disconnected');
    return;
  }
  setStatus(streamConfirmed ? 'live' : 'ready', streamConfirmed ? 'connected' : 'waitingUdp');
}

function startSelectedMode(mode = preferredMode) {
  if (streamPaused) return;
  if (mode === 'opus' && isCompressedAvailable()) {
    startOpus();
  } else {
    startRaw();
  }
  updateModeButton();
}

function pauseStream() {
  pausedMode = currentMode;
  streamPaused = true;
  stopRaw();
  stopOpus();
  queuedFrames = 0;
  latestWave = new Float32Array(0);
  lastPeak = 0;
  updateConnectionState();
  updateBuffered();
}

function resumeStream() {
  streamPaused = false;
  if (audioContext) {
    nextPlayTime = audioContext.currentTime + targetLatencySeconds;
  }
  if (audioStarted) {
    startSelectedMode(pausedMode || currentMode || preferredMode);
  }
  pausedMode = null;
  updateConnectionState();
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
  currentMode = 'opus';
  stopRaw();
  stopOpus();

  const transport = getCompressedTransport();
  if (!transport) {
    currentMode = 'raw';
    startRaw();
    return;
  }

  if (transport.adpcm) {
    startAdpcmCompressed();
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
  activeCompressedKind = 'media';
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

function startAdpcmCompressed() {
  currentMode = 'opus';
  activeCompressedKind = 'adpcm';
  if (audioContext) {
    nextPlayTime = audioContext.currentTime + targetLatencySeconds;
  }

  adpcmWs = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/${encodeURIComponent(streamName)}/adpcm?clientId=${encodeURIComponent(clientId)}`);
  adpcmWs.binaryType = 'arraybuffer';
  adpcmWs.addEventListener('message', (event) => {
    receivedBytes += event.data.byteLength || 0;
    const decoded = decodeAdpcmFrame(event.data);
    if (!decoded) return;

    config.sampleRate = decoded.sampleRate;
    config.channels = decoded.channels;
    streamConfirmed = true;
    scheduleAudio(decoded.samples, decoded.frames);
    latestWave = decoded.samples;
    lastPeak = Math.max(lastPeak * 0.92, peakOf(decoded.samples));
    lastAudioAt = Date.now();
    updateConnectionState();
  });
  adpcmWs.addEventListener('close', () => {
    if (suppressAdpcmReconnect) {
      suppressAdpcmReconnect = false;
      return;
    }
    if (currentMode === 'opus' && activeCompressedKind === 'adpcm' && audioStarted) {
      setTimeout(startOpus, 1000);
    }
  });
  adpcmWs.addEventListener('error', () => setStatus('', 'opusUnavailable'));
}

function startHttpOpus() {
  if (!opusAudio) {
    ensureOpusAudio();
  }
  activeCompressedKind = 'http';
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
  usingNativeHls = true;
  activeCompressedKind = 'hls';
  latestWave = new Float32Array(0);
  lastPeak = 0;
  applyOutputGain();
  opusAudio.src = `/${encodeURIComponent(streamName)}/hls/${encodeURIComponent(clientId)}/playlist.m3u8?t=${Date.now()}`;
  opusAudio.load();
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
  if (usingNativeHls || !audioContext || !gainNode || !opusAudio || opusSourceNode) return;
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
  if (usingNativeHls) return;
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
  usingNativeHls = false;
  activeCompressedKind = null;
  if (adpcmWs) {
    suppressAdpcmReconnect = true;
    adpcmWs.close();
    adpcmWs = null;
  }
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

function decodeAdpcmFrame(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 24
    || view.getUint8(0) !== 0x41
    || view.getUint8(1) !== 0x44
    || view.getUint8(2) !== 0x50
    || view.getUint8(3) !== 0x31) {
    return null;
  }

  const channels = view.getUint8(4);
  const headerBytes = view.getUint16(6, true);
  const sampleRate = view.getUint32(8, true);
  const frames = view.getUint16(16, true);
  const payloadBytes = view.getUint16(18, true);
  if (![1, 2].includes(channels) || headerBytes !== 20 + channels * 4 || frames < 1 || view.byteLength < headerBytes + payloadBytes) {
    return null;
  }

  const states = [];
  const samples = new Float32Array(frames * channels);
  for (let channel = 0; channel < channels; channel += 1) {
    const stateOffset = 20 + channel * 4;
    const predictor = view.getInt16(stateOffset, true);
    const index = view.getUint8(stateOffset + 2);
    states.push({ predictor, index });
    samples[channel] = predictor / 32768;
  }

  let nibbleIndex = 0;
  for (let frame = 1; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const byteValue = view.getUint8(headerBytes + Math.floor(nibbleIndex / 2));
      const code = nibbleIndex % 2 === 0 ? byteValue & 0x0f : byteValue >> 4;
      const sample = decodeAdpcmNibble(code, states[channel]);
      samples[frame * channels + channel] = sample / 32768;
      nibbleIndex += 1;
    }
  }

  return { samples, frames, channels, sampleRate };
}

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
  const outputPeak = lastPeak * gain;
  const db = outputPeak > 0 ? 20 * Math.log10(outputPeak) : -60;
  const clamped = Math.max(-60, Math.min(0, db));
  const percent = (clamped + 60) / 60 * 100;
  levelMaskEl.style.width = `${100 - percent}%`;
  levelValueEl.textContent = db <= -60 ? '-\u221e dB' : `${db.toFixed(1)} dB`;
}

function setStatus(state, textKey) {
  statusEl.className = `status ${state}`;
  currentStatusKey = textKey;
  updateStatusLabel();
}

function updateStatusLabel() {
  if (currentStatusKey === 'connected' && statusHovering && !streamPaused) {
    statusText.textContent = t('stopStream');
    return;
  }
  statusText.textContent = t(currentStatusKey);
}

function draw() {
  if (currentMode === 'opus' && activeCompressedKind === 'media' && opusAnalyser && opusAnalyserBuffer) {
    opusAnalyser.getFloatTimeDomainData(opusAnalyserBuffer);
    latestWave = opusAnalyserBuffer;
    lastPeak = Math.max(lastPeak * 0.92, peakOf(opusAnalyserBuffer));
  } else if ((currentMode === 'raw' || activeCompressedKind === 'adpcm') && lastAudioAt && Date.now() - lastAudioAt > 350) {
    latestWave = new Float32Array(0);
    lastPeak = 0;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBarWaveform();

  lastPeak *= 0.985;
  updateLevelMeter();
  requestAnimationFrame(draw);
}

function drawBarWaveform() {
  const centerY = canvas.height / 2;
  const barStride = waveformBarWidth + waveformBarGap;
  const barCount = Math.max(1, Math.floor((canvas.width + waveformBarGap) / barStride));
  const channels = currentMode === 'opus' && activeCompressedKind === 'media' ? 1 : config.channels;
  const frames = channels ? Math.floor(latestWave.length / channels) : 0;
  const totalWidth = barCount * waveformBarWidth + (barCount - 1) * waveformBarGap;
  let x = Math.max(0, (canvas.width - totalWidth) / 2);

  ctx.fillStyle = '#1f2933';
  roundRect(ctx, 0, centerY - 1, canvas.width, 2, 1);
  ctx.fill();

  ctx.fillStyle = frames > 0 ? '#ff3d12' : '#394451';
  for (let bar = 0; bar < barCount; bar += 1) {
    const peak = frames > 0 ? waveformPeakForBar(bar, barCount, frames, channels) : 0;
    const scaledPeak = Math.max(0, Math.min(1, peak * waveformVisualGain));
    const height = Math.max(waveformMinBarHeight, scaledPeak * canvas.height * 0.88);
    roundRect(ctx, x, centerY - height / 2, waveformBarWidth, height, waveformBarWidth / 2);
    ctx.fill();
    x += barStride;
  }
}

function waveformPeakForBar(bar, barCount, frames, channels) {
  const startFrame = Math.floor(bar * frames / barCount);
  const endFrame = Math.max(startFrame + 1, Math.floor((bar + 1) * frames / barCount));
  let peak = 0;
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = Math.abs(latestWave[frame * channels + channel] || 0);
      if (value > peak) peak = value;
    }
  }
  return peak;
}

function roundRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}
draw();
setInterval(updateBuffered, 500);
setInterval(updateLastHeard, 500);
updateClocks();
setInterval(updateClocks, 1000);

function updateBuffered() {
  if (streamPaused) {
    bufferedEl.textContent = 'Idle';
    browserBandwidthEl.textContent = 'Idle';
    return;
  }
  updateBrowserBandwidth();
  if (currentMode === 'opus' && activeCompressedKind !== 'adpcm') {
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
  if (streamPaused) {
    browserBandwidthEl.textContent = 'Idle';
    return;
  }
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
  titleLink.title = t('returnHome');
  updateStatusLabel();
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
  if (!compressedAvailable) return null;

  const codec = config.compressedCodec || 'adpcm';
  if (codec === 'adpcm') {
    return { endpoint: 'adpcm', adpcm: true };
  }

  const supportsAac = isMediaSourceTypeSupported(aacMimeType);
  const supportsOpus = isMediaSourceTypeSupported(opusMimeType);

  if (codec === 'hls' && isAppleMobileDevice()) {
    return { hls: true };
  }
  if (codec === 'opus' && supportsOpus) {
    return { endpoint: 'opus', mimeType: opusMimeType };
  }
  if (codec === 'aac' && supportsAac) {
    return { endpoint: 'aac', mimeType: aacMimeType };
  }
  if (codec === 'opus' && !isAppleMobileDevice() && opusAvailable) {
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
