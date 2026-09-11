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
const modeMenu = document.getElementById('modeMenu');
const modeOptions = Array.from(document.querySelectorAll('[data-mode-option]'));
const titleLink = document.getElementById('title');
const titleStatusDot = document.getElementById('titleStatusDot');
const levelMaskEl = document.getElementById('levelMask');
const levelValueEl = document.getElementById('levelValue');
const localTimeEl = document.getElementById('localTime');
const utcTimeEl = document.getElementById('utcTime');
const languageToggle = document.getElementById('languageToggle');
const languageCode = document.getElementById('languageCode');
const languageMenu = document.getElementById('languageMenu');
const languageOptions = Array.from(document.querySelectorAll('.language-option'));
const modeNoticeOverlay = document.getElementById('modeNoticeOverlay');
const modeNoticeTitle = document.getElementById('modeNoticeTitle');
const modeNoticeBody = document.getElementById('modeNoticeBody');
const modeNoticeAccept = document.getElementById('modeNoticeAccept');
const canvas = document.getElementById('scope');
const ctx = canvas.getContext('2d');

const translations = {
  en: {
    users: 'Users', gain: 'Gain', startAudio: 'Start Audio', mute: 'Mute', unmute: 'Unmute', buffered: 'Buffered', bandwidth: 'Bandwidth', lastHeardTime: 'Last Heard Time', mode: 'Mode', level: 'Level', localTime: 'Local Time', disconnected: 'Disconnected', waitingUdp: 'Waiting for UDP', connected: 'Connected', idle: 'Push to Reconnect', pushDisconnect: 'Push to disconnect', stopStream: 'Stop stream', returnHome: 'Click to return home', opusUnavailable: 'Compressed unavailable', compressed: 'Compressed', uncompressed: 'Uncompressed', switchMode: 'Switch audio mode', opusNeedsFfmpeg: 'Compressed mode is unavailable on the server', never: 'never', now: 'Now',
    compatible: 'Compatible', compatibleUnavailable: 'Compatible unavailable', modeUnavailable: 'Mode unavailable',
    compatibleNoticeTitle: 'Compatible Mode',
    compatibleNoticeBody: 'Compatible Mode uses native AAC for broader mobile and background compatibility. Results depend on the device, and it may add a variable delay of about 5 to 10 seconds.',
    uncompressedNoticeTitle: 'Uncompressed Realtime Mode',
    uncompressedNoticeBody: 'This mode uses raw realtime audio with persistent low-latency playback when AudioWorklet is supported. Background behavior still depends on the browser and device.',
    compressedNoticeTitle: 'Compressed Realtime Mode',
    compressedNoticeBody: 'This mode uses realtime compressed audio and persistent low-latency playback when AudioWorklet is supported. Background behavior still depends on the browser and device.',
    mobileStartupNoticeTitle: 'Compressed realtime mode',
    mobileStartupNoticeBody: 'This stream starts in low-delay compressed realtime mode. Its persistent audio path may continue in the background on supported devices; Compatible Mode remains available with more delay.',
    serverDisconnected: 'Connection to the server was lost. Reconnecting...',
    serverRestarted: 'The server restarted. This page reconnected; refresh if audio does not resume.',
    streamUnavailableTitle: 'Stream updated',
    streamUnavailableBody: 'This stream is no longer available with its previous configuration. Return to the home page to see the updated stream list.',
    returnToHome: 'Return to home',
    reload: 'Reload',
    accept: 'Accept',
    workletFallback: 'AudioWorklet unavailable; using the compatibility scheduler.',
  },
  es: {
    users: 'Usuarios', gain: 'Ganancia', startAudio: 'Iniciar audio', mute: 'Silenciar', unmute: 'Activar audio', buffered: 'Buffer', bandwidth: 'Ancho de banda', lastHeardTime: 'Ultima transmision', mode: 'Modo', level: 'Nivel', localTime: 'Hora local', disconnected: 'Desconectado', waitingUdp: 'Esperando UDP', connected: 'Conectado', idle: 'Presiona para reconectar', pushDisconnect: 'Presiona para desconectar', stopStream: 'Detener stream', returnHome: 'Click para volver a la pagina principal', opusUnavailable: 'Comprimido no disponible', compressed: 'Comprimido', uncompressed: 'Sin comprimir', switchMode: 'Cambiar modo de audio', opusNeedsFfmpeg: 'El modo comprimido no esta disponible en el servidor', never: 'nunca', now: 'Ahora',
    compatible: 'Compatible', compatibleUnavailable: 'Compatible no disponible', modeUnavailable: 'Modo no disponible',
    compatibleNoticeTitle: 'Modo Compatible',
    compatibleNoticeBody: 'El Modo Compatible usa AAC nativo para mayor compatibilidad movil y en segundo plano. El resultado depende del dispositivo y puede agregar un delay variable de unos 5 a 10 segundos.',
    uncompressedNoticeTitle: 'Modo Realtime sin comprimir',
    uncompressedNoticeBody: 'Este modo usa audio realtime crudo con reproduccion persistente de baja latencia cuando AudioWorklet esta disponible. El comportamiento en background depende del navegador y dispositivo.',
    compressedNoticeTitle: 'Modo Realtime comprimido',
    compressedNoticeBody: 'Este modo usa audio realtime comprimido y reproduccion persistente de baja latencia cuando AudioWorklet esta disponible. El comportamiento en background depende del navegador y dispositivo.',
    mobileStartupNoticeTitle: 'Modo comprimido realtime',
    mobileStartupNoticeBody: 'Este stream inicia en modo comprimido de baja latencia. Su ruta persistente puede continuar en background en dispositivos compatibles; el Modo Compatible sigue disponible con mayor delay.',
    serverDisconnected: 'Se perdio la conexion con el servidor. Reconectando...',
    serverRestarted: 'El servidor se reinicio. Esta pagina se reconecto; actualiza si el audio no vuelve.',
    streamUnavailableTitle: 'Stream actualizado',
    streamUnavailableBody: 'Este stream ya no esta disponible con su configuracion anterior. Regresa a la pagina principal para ver la lista actualizada.',
    returnToHome: 'Volver al inicio',
    reload: 'Actualizar',
    accept: 'Aceptar',
    workletFallback: 'AudioWorklet no disponible; usando el scheduler de compatibilidad.',
  },
};

let language = localStorage.getItem('udp-airband-language') || 'en';
if (!translations[language]) language = 'en';
const acceptedNoticeStoragePrefix = 'udp-airband-single-notice-accepted:';
let currentStatusKey = 'disconnected';
let lastHeardLabel = 'never';

let audioContext;
let gainNode;
let config = { sampleRate: 8000, channels: 1 };
let queuedFrames = 0;
const targetLatencySeconds = 0.05;
const defaultWorkletTargetLatencyMs = 80;
const defaultWorkletHighWaterMs = 200;
const workletCapacitySeconds = 4;
const workletMaxDrift = 0.004;
const maxPcmPacketSeconds = 1;
const maxToleratedAdpcmSequenceGap = 10;
let nextPlayTime = 0;
let gain = Number(gainInput.value);
let lastPeak = 0;
let latestWave = new Float32Array(0);
let latestWaveChannels = 1;
let audioWorkletNode;
let audioWorkletLoadPromise;
let audioWorkletConfiguration = '';
let audioWorkletFailed = false;
let audioWorkletFailure = '';
let audioWorkletNeedsReset = false;
let audioWorkletDiagnostics = null;
let audioWorkletSuspendedDrops = 0;
let pendingAudioWorkletPcm = [];
let pendingAudioWorkletFrames = 0;
let lastUdpAt = 0;
let lastAudioAt = 0;
let streamConfirmed = false;
let wsGeneration = 0;
let controlWs;
let controlReconnectTimer;
let serverInstanceId = '';
let serverNoticeEl;
let serverNoticeKind = '';
let streamUnavailable = false;
let rawWs;
let rawReconnectTimer;
let suppressRawReconnect = false;
let adpcmWs;
let adpcmReconnectTimer;
let suppressAdpcmReconnect = false;
let lastAdpcmSequence = null;
let adpcmSequenceGaps = 0;
let adpcmMissingFrames = 0;
let opusAudio;
let opusSourceNode;
let opusAnalyser;
let opusAnalyserBuffer;
let opusWs;
let opusReconnectTimer;
let suppressOpusReconnect = false;
let compatibleAudio;
let compatibleSourceNode;
let compatibleAnalyser;
let compatibleAnalyserBuffer;
let compatibleAudioReady = false;
let compatibleBandwidthReady = false;
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
let mobileStartupNoticeShown = false;
let resumeAfterPageShow = false;
let resumeAfterOnline = false;
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
  if (modeMenu && !modeMenu.hidden && !event.target.closest('.mode-meter')) {
    closeModeMenu();
  }
});

gainInput.addEventListener('input', () => {
  gain = Number(gainInput.value);
  gainValue.value = `${Math.round(gain * 100)}%`;
  applyOutputGain();
});

modeButton.addEventListener('click', () => {
  if (!modeMenu) return;
  const open = modeMenu.hidden;
  modeMenu.hidden = !open;
  modeButton.setAttribute('aria-expanded', String(open));
});

modeOptions.forEach((option) => {
  option.addEventListener('click', () => {
    selectMode(option.dataset.modeOption);
  });
});

if (modeNoticeAccept) {
  modeNoticeAccept.addEventListener('click', () => {
    if (modeNoticeOverlay?.dataset.notice === 'stream-unavailable') {
      location.href = '/';
      return;
    }
    if (modeNoticeOverlay?.dataset.notice === 'mobile-startup') {
      rememberNoticeAccepted('mobile-startup');
      delete modeNoticeOverlay.dataset.notice;
      if (modeNoticeOverlay) modeNoticeOverlay.hidden = true;
      startAudioPlayback().catch(() => {});
      return;
    }
    if (modeNoticeOverlay?.dataset.notice === 'startup-mode') {
      const startupMode = modeNoticeOverlay.dataset.mode || preferredMode;
      rememberNoticeAccepted(modeNoticeKeyForMode(startupMode));
      applySelectedMode(startupMode);
      delete modeNoticeOverlay.dataset.notice;
      if (modeNoticeOverlay) modeNoticeOverlay.hidden = true;
      startAudioPlayback().catch(() => {});
      return;
    }
    const mode = modeNoticeOverlay ? modeNoticeOverlay.dataset.mode : '';
    if (mode) {
      rememberNoticeAccepted(modeNoticeKeyForMode(mode));
      applySelectedMode(mode);
    }
    if (modeNoticeOverlay) modeNoticeOverlay.hidden = true;
  });
}

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

startButton.addEventListener('click', () => {
  startAudioPlayback().catch(() => {});
});

async function startAudioPlayback() {
  if (audioStarted) {
    muted = !muted;
    applyOutputGain();
    updateAudioButton();
    updateGainControl();
    return;
  }

  requestPlaybackAudioSession();
  if (!audioContext) {
    audioContext = new AudioContext({ latencyHint: 'interactive' });
    gainNode = audioContext.createGain();
    applyOutputGain();
    gainNode.connect(audioContext.destination);
    nextPlayTime = audioContext.currentTime + targetLatencySeconds;
    audioContext.addEventListener('statechange', handleAudioContextStateChange);
  }

  const resumed = audioContext.resume();
  const workletReady = ensureAudioWorklet();
  await resumed;
  connectControlWebSocket();
  streamPaused = false;
  audioStarted = true;
  startSelectedMode();
  await workletReady;
  updateAudioButton();
  updateGainControl();
  updateConnectionState();
}

function requestPlaybackAudioSession() {
  if (!('audioSession' in navigator)) return;
  try {
    navigator.audioSession.type = 'playback';
  } catch {
    // This API is optional and differs between browser versions.
  }
}

function handleAudioContextStateChange() {
  if (!audioContext) return;
  if (audioContext.state === 'running') {
    if (audioWorkletNeedsReset) resetAudioWorklet();
    audioWorkletNeedsReset = false;
    return;
  }
  audioWorkletNeedsReset = true;
}

function isAudioWorkletRequested() {
  return config.audioWorkletStreaming !== false;
}

async function ensureAudioWorklet() {
  if (!isAudioWorkletRequested() || audioWorkletFailed || audioWorkletNode) return Boolean(audioWorkletNode);
  if (audioWorkletLoadPromise) return audioWorkletLoadPromise;
  if (!window.isSecureContext || !audioContext?.audioWorklet || typeof window.AudioWorkletNode !== 'function') {
    disableAudioWorklet('unsupported or insecure browser context');
    return false;
  }

  const version = encodeURIComponent(config.softwareVersion || 'current');
  audioWorkletLoadPromise = audioContext.audioWorklet.addModule(`/assets/audio-worklet.js?v=${version}`)
    .then(() => {
      if (!isAudioWorkletRequested()) {
        audioWorkletLoadPromise = null;
        return false;
      }
      const node = new AudioWorkletNode(audioContext, 'airband-pcm', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      node.connect(gainNode);
      node.port.onmessage = ({ data }) => handleAudioWorkletMessage(data);
      node.addEventListener('processorerror', () => disableAudioWorklet('processor error'));
      audioWorkletNode = node;
      audioWorkletFailed = false;
      audioWorkletFailure = '';
      audioWorkletConfiguration = '';
      configureAudioWorklet(config.sampleRate, config.channels);
      bufferedEl.dataset.delivery = 'worklet';
      bufferedEl.title = '';
      flushPendingAudioWorkletPcm();
      return true;
    })
    .catch((error) => {
      clearPendingAudioWorkletPcm();
      disableAudioWorklet(error?.message || 'module load failed');
      return false;
    });
  return audioWorkletLoadPromise;
}

function configureAudioWorklet(inputSampleRate, channels) {
  if (!audioWorkletNode) return false;
  const targetLatencyMs = Number(config.workletTargetLatencyMs) || defaultWorkletTargetLatencyMs;
  const highWaterMs = Number(config.workletHighWaterMs) || defaultWorkletHighWaterMs;
  const key = `${inputSampleRate}:${channels}:${targetLatencyMs}:${highWaterMs}`;
  if (key === audioWorkletConfiguration) return true;
  audioWorkletNode.port.postMessage({
    type: 'configure',
    inputSampleRate,
    channels,
    targetLatencyMs,
    highWaterMs,
    capacitySeconds: workletCapacitySeconds,
    maxDrift: workletMaxDrift,
  });
  audioWorkletConfiguration = key;
  audioWorkletDiagnostics = null;
  return true;
}

function resetAudioWorklet() {
  clearPendingAudioWorkletPcm();
  if (!audioWorkletNode) return;
  audioWorkletNode.port.postMessage({ type: 'reset' });
  audioWorkletDiagnostics = null;
}

function disableAudioWorklet(reason) {
  if (audioWorkletNode) {
    try {
      audioWorkletNode.disconnect();
    } catch {
      // The node may already be disconnected after a processor failure.
    }
    audioWorkletNode.port.onmessage = null;
  }
  audioWorkletNode = null;
  audioWorkletLoadPromise = null;
  audioWorkletConfiguration = '';
  audioWorkletFailed = true;
  audioWorkletFailure = reason;
  nextPlayTime = audioContext ? audioContext.currentTime + targetLatencySeconds : 0;
  bufferedEl.dataset.delivery = 'scheduler';
  bufferedEl.title = t('workletFallback');
  console.warn(`AudioWorklet fallback: ${reason}`);
}

function handleAudioWorkletMessage(message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'worklet-diagnostics') {
    audioWorkletDiagnostics = message;
  } else if (message.type === 'worklet-error') {
    audioWorkletDiagnostics = { ...(audioWorkletDiagnostics || {}), invalidMessages: message.invalidMessages };
    console.warn(`AudioWorklet rejected audio data: ${message.message}`);
  }
}

function applyAudioWorkletPreference() {
  if (isAudioWorkletRequested()) {
    if (audioStarted && !audioWorkletNode && !audioWorkletFailed) ensureAudioWorklet();
    return;
  }
  clearPendingAudioWorkletPcm();
  if (audioWorkletNode) {
    audioWorkletNode.port.postMessage({ type: 'reset' });
    audioWorkletNode.disconnect();
    audioWorkletNode.port.onmessage = null;
  }
  audioWorkletNode = null;
  audioWorkletLoadPromise = null;
  audioWorkletConfiguration = '';
  audioWorkletDiagnostics = null;
  audioWorkletFailed = false;
  audioWorkletFailure = '';
  bufferedEl.dataset.delivery = 'scheduler';
  bufferedEl.title = '';
}

function deliverPcm(samples, frames, inputSampleRate, channels) {
  latestWave = waveformPreview(samples, frames, channels);
  latestWaveChannels = 1;
  lastPeak = Math.max(lastPeak * 0.92, peakOf(samples));
  lastAudioAt = Date.now();

  if (postPcmToAudioWorklet(samples, frames, inputSampleRate, channels)) return;
  if (isAudioWorkletRequested() && audioWorkletLoadPromise && !audioWorkletFailed) {
    queuePendingAudioWorkletPcm(samples, frames, inputSampleRate, channels);
    return;
  }
  scheduleAudio(samples, frames, channels, inputSampleRate);
}

function queuePendingAudioWorkletPcm(samples, frames, inputSampleRate, channels) {
  pendingAudioWorkletPcm.push({ samples, frames, inputSampleRate, channels });
  pendingAudioWorkletFrames += frames;
  const highWaterMs = Number(config.workletHighWaterMs) || defaultWorkletHighWaterMs;
  const maximumFrames = Math.max(1, Math.round(inputSampleRate * highWaterMs / 1000));
  while (pendingAudioWorkletFrames > maximumFrames && pendingAudioWorkletPcm.length > 1) {
    const dropped = pendingAudioWorkletPcm.shift();
    pendingAudioWorkletFrames -= dropped.frames;
  }
}

function flushPendingAudioWorkletPcm() {
  const pending = pendingAudioWorkletPcm;
  pendingAudioWorkletPcm = [];
  pendingAudioWorkletFrames = 0;
  for (const item of pending) {
    if (!postPcmToAudioWorklet(item.samples, item.frames, item.inputSampleRate, item.channels)) {
      scheduleAudio(item.samples, item.frames, item.channels, item.inputSampleRate);
    }
  }
}

function clearPendingAudioWorkletPcm() {
  pendingAudioWorkletPcm = [];
  pendingAudioWorkletFrames = 0;
}

function postPcmToAudioWorklet(samples, frames, inputSampleRate, channels) {
  if (!isAudioWorkletRequested() || !audioWorkletNode || audioWorkletFailed) return false;
  if (audioContext?.state !== 'running') {
    audioWorkletSuspendedDrops += frames;
    audioWorkletNeedsReset = true;
    return true;
  }
  try {
    configureAudioWorklet(inputSampleRate, channels);
    if (samples.byteOffset !== 0 || samples.byteLength !== samples.buffer.byteLength) return false;
    audioWorkletNode.port.postMessage({ type: 'samples', buffer: samples.buffer, frames }, [samples.buffer]);
    return true;
  } catch (error) {
    disableAudioWorklet(error?.message || 'sample transfer failed');
    return false;
  }
}

function waveformPreview(samples, frames, channels, maximumFrames = 512) {
  const previewFrames = Math.min(frames, maximumFrames);
  const preview = new Float32Array(previewFrames);
  for (let index = 0; index < previewFrames; index += 1) {
    const frame = Math.min(frames - 1, Math.floor(index * frames / previewFrames));
    let sample = samples[frame * channels] || 0;
    if (channels === 2) sample = (sample + (samples[frame * channels + 1] || 0)) * 0.5;
    preview[index] = sample;
  }
  return preview;
}

window.getAudioWorkletDiagnostics = () => ({
  enabled: isAudioWorkletRequested(),
  active: Boolean(audioWorkletNode),
  failure: audioWorkletFailure,
  contextState: audioContext?.state || 'not-created',
  transport: currentMode === 'raw' ? 'raw' : activeCompressedKind || currentMode,
  lastFrameAt: lastAudioAt,
  suspendedDroppedFrames: audioWorkletSuspendedDrops,
  adpcmSequenceGaps,
  adpcmMissingFrames,
  ...(audioWorkletDiagnostics || {}),
});

function applyOutputGain() {
  if (gainNode) gainNode.gain.value = muted ? 0 : gain;
  if (opusAudio) opusAudio.muted = muted && !opusSourceNode;
  if (compatibleAudio) {
    compatibleAudio.muted = muted && !compatibleSourceNode;
    compatibleAudio.volume = compatibleSourceNode ? 1 : clamp(gain, 0, 1);
  }
}

function updateAudioButton() {
  startButton.textContent = audioStarted ? (muted ? t('unmute') : t('mute')) : t('startAudio');
  startButton.classList.toggle('audio-muted', audioStarted && muted);
  startButton.classList.toggle('audio-start-prompt', !audioStarted);
  startButton.disabled = false;
}

function updateGainControl() {
  gainInput.disabled = muted;
  gainLabel.classList.toggle('gain-muted', muted);
}

function connectControlWebSocket() {
  if (controlWs && controlWs.readyState <= 1) return;
  clearTimeout(controlReconnectTimer);
  controlReconnectTimer = null;

  const generation = ++wsGeneration;
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/${encodeURIComponent(streamName)}/control?clientId=${encodeURIComponent(clientId)}`);
  controlWs = socket;

  controlWs.addEventListener('open', () => {
    if (generation === wsGeneration) updateConnectionState();
  });
  controlWs.addEventListener('close', () => {
    if (controlWs === socket) controlWs = null;
    if (generation === wsGeneration) {
      setStatus('', 'disconnected');
      if (!streamUnavailable) {
        showServerNotice('disconnected');
        scheduleControlReconnect();
      }
    }
  });
  controlWs.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      const message = JSON.parse(event.data);
      if (message.type === 'config') {
        config = message;
        applyAudioWorkletPreference();
        if (audioWorkletNode) configureAudioWorklet(config.sampleRate, config.channels);
        opusAvailable = Boolean(message.opusAvailable);
        compressedAvailable = Boolean(message.compressedAvailable);
        compressedTransport = getCompressedTransport();
        updateServerInstance(message.serverInstanceId);
        if (!getAvailableModes().includes(preferredMode)) setPreferredMode(isCompatibleAvailable() && isMobileDevice() ? 'compatible' : 'raw');
        document.title = `${message.label} - UDP Airband Monitor`;
        titleLink.textContent = message.label;
        titleLink.title = t('returnHome');
        if (audioStarted && getAvailableModes().includes(preferredMode) && currentMode !== preferredMode) {
          startSelectedMode();
        }
        updateModeButton();
        showStartupNoticeIfNeeded();
        updateConnectionState();
      } else if (message.type === 'streamUpdated') {
        applyStreamUpdate(message.stream);
      } else if (message.type === 'streamUnavailable') {
        showStreamUnavailable();
      } else if (message.type === 'stats') {
        if (!streamPaused) {
          updateServerMeasuredBandwidth(message.listenerBitsPerSecond || 0);
        }
        activeUsersEl.textContent = String(message.activeListeners || message.clients || 0);
        lastUdpAt = message.lastHeardAt || message.lastUdpAt || 0;
        lastHeardLabel = message.lastHeardLabel || 'never';
        lastHeardEl.textContent = localizeLastHeard(lastHeardLabel);
        if (message.hasUdp || message.packetCount > 0) {
          streamConfirmed = true;
        }
        updateConnectionState();
      }
    }
  });
}

function scheduleControlReconnect() {
  if (controlReconnectTimer || streamUnavailable) return;
  controlReconnectTimer = setTimeout(() => {
    controlReconnectTimer = null;
    connectControlWebSocket();
  }, 1000);
}

function applyStreamUpdate(stream) {
  if (!stream || stream.name !== streamName) return;
  config = { ...config, ...stream };
  document.title = `${stream.label} - UDP Airband Monitor`;
  titleLink.textContent = stream.label;
  titleLink.title = t('returnHome');
  updateMediaSessionMetadata();
}

function showStreamUnavailable() {
  if (!streamUnavailable) {
    streamUnavailable = true;
    wsGeneration += 1;
    stopRaw();
    stopOpus();
    stopCompatible();
    hideServerNotice();
  }
  if (!modeNoticeOverlay) {
    location.href = '/';
    return;
  }
  delete modeNoticeOverlay.dataset.mode;
  modeNoticeOverlay.dataset.notice = 'stream-unavailable';
  if (modeNoticeTitle) modeNoticeTitle.textContent = t('streamUnavailableTitle');
  if (modeNoticeBody) modeNoticeBody.textContent = t('streamUnavailableBody');
  if (modeNoticeAccept) modeNoticeAccept.textContent = t('returnToHome');
  modeNoticeOverlay.hidden = false;
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

function startSelectedMode(mode = preferredMode) {
  if (streamPaused) return;
  if (mode === 'compatible' && isCompatibleAvailable()) {
    startCompatible();
    updateModeButton();
    return;
  }
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
  stopCompatible();
  resetAudioWorklet();
  queuedFrames = 0;
  latestWave = new Float32Array(0);
  latestWaveChannels = 1;
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
  stopCompatible();
  if (rawWs && rawWs.readyState <= 1) return;
  clearTimeout(rawReconnectTimer);
  rawReconnectTimer = null;

  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/${encodeURIComponent(streamName)}/audio?clientId=${encodeURIComponent(clientId)}`);
  rawWs = socket;
  rawWs.binaryType = 'arraybuffer';
  rawWs.addEventListener('close', () => {
    if (rawWs === socket) rawWs = null;
    resetAudioWorklet();
    if (suppressRawReconnect) {
      suppressRawReconnect = false;
      return;
    }
    scheduleRawReconnect();
  });
  rawWs.addEventListener('message', (event) => {
    receivedBytes += event.data.byteLength || 0;
    if (!(event.data instanceof ArrayBuffer) || event.data.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) return;
    const samples = new Float32Array(event.data);
    const frames = samples.length / config.channels;
    if (!Number.isInteger(frames) || frames < 1 || frames > config.sampleRate * maxPcmPacketSeconds) return;

    streamConfirmed = true;
    deliverPcm(samples, frames, config.sampleRate, config.channels);
    updateConnectionState();
  });
  currentMode = 'raw';
}

function scheduleRawReconnect() {
  if (rawReconnectTimer || currentMode !== 'raw' || !audioStarted || streamPaused) return;
  rawReconnectTimer = setTimeout(() => {
    rawReconnectTimer = null;
    if (currentMode === 'raw' && audioStarted && !streamPaused) startRaw();
  }, 1000);
}

function startOpus() {
  currentMode = 'opus';
  stopRaw();
  stopCompatible();
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
      scheduleOpusReconnect();
    });
    opusWs.addEventListener('error', () => setStatus('', 'opusUnavailable'));
  }, { once: true });
}

function startAdpcmCompressed() {
  if (adpcmWs && adpcmWs.readyState <= 1) return;
  currentMode = 'opus';
  activeCompressedKind = 'adpcm';
  lastAdpcmSequence = null;
  adpcmSequenceGaps = 0;
  adpcmMissingFrames = 0;
  if (audioContext) {
    nextPlayTime = audioContext.currentTime + targetLatencySeconds;
  }

  clearTimeout(adpcmReconnectTimer);
  adpcmReconnectTimer = null;

  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/${encodeURIComponent(streamName)}/adpcm?clientId=${encodeURIComponent(clientId)}`);
  adpcmWs = socket;
  adpcmWs.binaryType = 'arraybuffer';
  adpcmWs.addEventListener('message', (event) => {
    receivedBytes += event.data.byteLength || 0;
    const decoded = decodeAdpcmFrame(event.data);
    if (!decoded) return;

    if (lastAdpcmSequence !== null) {
      const expectedSequence = (lastAdpcmSequence + 1) >>> 0;
      const missingPackets = (decoded.sequence - expectedSequence) >>> 0;
      if (missingPackets > 0) {
        adpcmSequenceGaps += 1;
        if (missingPackets <= maxToleratedAdpcmSequenceGap) {
          adpcmMissingFrames += missingPackets * decoded.frames;
        } else {
          resetAudioWorklet();
        }
      }
    }
    lastAdpcmSequence = decoded.sequence;

    config.sampleRate = decoded.sampleRate;
    config.channels = decoded.channels;
    streamConfirmed = true;
    deliverPcm(decoded.samples, decoded.frames, decoded.sampleRate, decoded.channels);
    updateConnectionState();
  });
  adpcmWs.addEventListener('close', () => {
    if (adpcmWs === socket) adpcmWs = null;
    lastAdpcmSequence = null;
    resetAudioWorklet();
    if (suppressAdpcmReconnect) {
      suppressAdpcmReconnect = false;
      return;
    }
    scheduleAdpcmReconnect();
  });
  adpcmWs.addEventListener('error', () => setStatus('', 'opusUnavailable'));
}

function scheduleAdpcmReconnect() {
  if (adpcmReconnectTimer || currentMode !== 'opus' || activeCompressedKind !== 'adpcm' || !audioStarted || streamPaused) return;
  adpcmReconnectTimer = setTimeout(() => {
    adpcmReconnectTimer = null;
    if (currentMode === 'opus' && activeCompressedKind === 'adpcm' && audioStarted && !streamPaused) startAdpcmCompressed();
  }, 1000);
}

function scheduleOpusReconnect() {
  if (opusReconnectTimer || currentMode !== 'opus' || !audioStarted || streamPaused) return;
  opusReconnectTimer = setTimeout(() => {
    opusReconnectTimer = null;
    if (currentMode === 'opus' && audioStarted && !streamPaused) startOpus();
  }, 1000);
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
  latestWaveChannels = 1;
  lastPeak = 0;
  applyOutputGain();
  opusAudio.src = `/${encodeURIComponent(streamName)}/hls/${encodeURIComponent(clientId)}/playlist.m3u8?t=${Date.now()}`;
  opusAudio.load();
  opusAudio.play().catch(() => setStatus('', 'opusUnavailable'));
  currentMode = 'opus';
}

function startCompatible() {
  currentMode = 'compatible';
  compatibleAudioReady = false;
  compatibleBandwidthReady = false;
  browserBandwidthEl.textContent = 'Loading';
  stopRaw();
  stopOpus();
  ensureCompatibleAudio();
  setupCompatibleAudioGraph();
  compatibleAudio.src = `/multi/native.aac?streams=${encodeURIComponent(streamName)}&clientId=${encodeURIComponent(clientId)}&t=${Date.now()}`;
  compatibleAudio.load();
  const seekOnCanPlay = () => {
    jumpNativeAudioToLiveEdge(compatibleAudio);
  };
  compatibleAudio.addEventListener('canplay', seekOnCanPlay, { once: true });
  jumpNativeAudioToLiveEdge(compatibleAudio);
  const playPromise = compatibleAudio.play();
  if (playPromise && typeof playPromise.then === 'function') {
    playPromise
      .then(() => {
        setTimeout(() => {
          if (currentMode === 'compatible' && compatibleAudio?.src) jumpNativeAudioToLiveEdge(compatibleAudio);
        }, 100);
      })
      .catch(() => {
        compatibleAudio.removeEventListener('canplay', seekOnCanPlay);
        setStatus('', 'compatibleUnavailable');
      });
  }
  updateMediaSessionMetadata();
}

function jumpNativeAudioToLiveEdge(audio, targetBufferSeconds = 0.5) {
  const delay = getNativeBufferedDelay(audio);
  if (delay === null || delay <= targetBufferSeconds + 0.25) return false;

  try {
    const liveEdge = audio.buffered.end(audio.buffered.length - 1);
    const target = Math.max(0, liveEdge - targetBufferSeconds);
    if (!Number.isFinite(target) || target <= audio.currentTime) return false;
    audio.currentTime = target;
    return true;
  } catch {
    return false;
  }
}

function getNativeBufferedDelay(audio) {
  if (!audio || audio.buffered.length === 0) return null;

  try {
    const liveEdge = audio.buffered.end(audio.buffered.length - 1);
    const delay = liveEdge - audio.currentTime;
    return Number.isFinite(delay) ? delay : null;
  } catch {
    return null;
  }
}

function ensureCompatibleAudio() {
  if (compatibleAudio) return;
  compatibleAudio = new Audio();
  compatibleAudio.preload = 'auto';
  compatibleAudio.addEventListener('playing', () => {
    compatibleAudioReady = true;
    streamConfirmed = true;
    updateBrowserBandwidth();
    updateConnectionState();
  });
  compatibleAudio.addEventListener('canplay', () => {
    compatibleAudioReady = true;
    updateBrowserBandwidth();
  });
  compatibleAudio.addEventListener('waiting', updateConnectionState);
  compatibleAudio.addEventListener('error', () => setStatus('', 'compatibleUnavailable'));
}

function stopCompatible() {
  if (!compatibleAudio) return;
  compatibleAudio.pause();
  compatibleAudio.removeAttribute('src');
  compatibleAudio.load();
  compatibleAudioReady = false;
  compatibleBandwidthReady = false;
  latestWave = new Float32Array(0);
  latestWaveChannels = 1;
  lastPeak = 0;
}

function updateMediaSessionMetadata() {
  if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: document.title || titleLink.textContent || streamName,
    artist: titleLink.textContent || streamName,
    album: 'UDP Airband Server',
  });
}

function setupCompatibleAudioGraph() {
  if (!audioContext || !gainNode || !compatibleAudio || compatibleSourceNode) return;
  compatibleSourceNode = audioContext.createMediaElementSource(compatibleAudio);
  compatibleAnalyser = audioContext.createAnalyser();
  compatibleAnalyser.fftSize = 1024;
  compatibleAnalyserBuffer = new Float32Array(compatibleAnalyser.fftSize);
  compatibleSourceNode.connect(compatibleAnalyser);
  compatibleAnalyser.connect(gainNode);
  applyOutputGain();
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
  clearTimeout(rawReconnectTimer);
  rawReconnectTimer = null;
  if (rawWs) {
    resetAudioWorklet();
    suppressRawReconnect = true;
    rawWs.close();
    rawWs = null;
  }
}

function stopOpus() {
  clearTimeout(adpcmReconnectTimer);
  adpcmReconnectTimer = null;
  clearTimeout(opusReconnectTimer);
  opusReconnectTimer = null;
  usingNativeHls = false;
  if (adpcmWs) resetAudioWorklet();
  activeCompressedKind = null;
  if (adpcmWs) {
    lastAdpcmSequence = null;
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
  modeButton.textContent = modeLabel(visibleMode);
  modeButton.disabled = getAvailableModes().length <= 1;
  modeButton.title = getAvailableModes().length > 1 ? t('switchMode') : t('modeUnavailable');
  modeButton.classList.toggle('compatible-mode', visibleMode === 'compatible');
  updateModeMenu();
}

function scheduleAudio(samples, frames, channels = config.channels, inputSampleRate = config.sampleRate) {
  if (!audioContext || !gainNode) return;

  const now = audioContext.currentTime;
  if (nextPlayTime < now + 0.05 || nextPlayTime > now + 1.0) {
    nextPlayTime = now + targetLatencySeconds;
  }

  const buffer = audioContext.createBuffer(channels, frames, inputSampleRate);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < frames; i += 1) {
      data[i] = samples[i * channels + channel];
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
  queuedFrames = Math.max(0, Math.round((nextPlayTime - now) * inputSampleRate));
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
  const bitsPerSample = view.getUint8(5);
  const headerBytes = view.getUint16(6, true);
  const sampleRate = view.getUint32(8, true);
  const sequence = view.getUint32(12, true);
  const frames = view.getUint16(16, true);
  const payloadBytes = view.getUint16(18, true);
  const expectedPayloadBytes = Math.ceil(Math.max(0, frames - 1) * channels / 2);
  if (![1, 2].includes(channels)
    || bitsPerSample !== 4
    || !Number.isInteger(sampleRate)
    || sampleRate < 1000
    || sampleRate > 96000
    || headerBytes !== 20 + channels * 4
    || frames < 1
    || frames > sampleRate * maxPcmPacketSeconds
    || payloadBytes !== expectedPayloadBytes
    || view.byteLength !== headerBytes + payloadBytes) {
    return null;
  }

  const states = [];
  const samples = new Float32Array(frames * channels);
  for (let channel = 0; channel < channels; channel += 1) {
    const stateOffset = 20 + channel * 4;
    const predictor = view.getInt16(stateOffset, true);
    const index = view.getUint8(stateOffset + 2);
    if (index >= adpcmStepTable.length) return null;
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

  return { samples, frames, channels, sampleRate, sequence };
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
  titleStatusDot.className = 'title-status-dot';
  if (currentStatusKey === 'connected') {
    titleStatusDot.classList.add('live');
    statusText.textContent = t('pushDisconnect');
    return;
  }
  if (currentStatusKey === 'idle') {
    titleStatusDot.classList.add('idle');
    statusText.textContent = t('idle');
    return;
  }
  statusText.textContent = t(currentStatusKey);
}

function draw() {
  if (currentMode === 'opus' && activeCompressedKind === 'media' && opusAnalyser && opusAnalyserBuffer) {
    opusAnalyser.getFloatTimeDomainData(opusAnalyserBuffer);
    latestWave = opusAnalyserBuffer;
    latestWaveChannels = 1;
    lastPeak = Math.max(lastPeak * 0.92, peakOf(opusAnalyserBuffer));
  } else if (currentMode === 'compatible' && compatibleAnalyser && compatibleAnalyserBuffer) {
    compatibleAnalyser.getFloatTimeDomainData(compatibleAnalyserBuffer);
    latestWave = compatibleAnalyserBuffer;
    latestWaveChannels = 1;
    lastPeak = Math.max(lastPeak * 0.92, peakOf(compatibleAnalyserBuffer));
  } else if ((currentMode === 'raw' || activeCompressedKind === 'adpcm') && lastAudioAt && Date.now() - lastAudioAt > 350) {
    latestWave = new Float32Array(0);
    latestWaveChannels = 1;
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
  const channels = latestWaveChannels;
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

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !audioStarted || streamPaused || !audioContext) return;
  audioContext.resume()
    .then(() => {
      if (audioWorkletNeedsReset) resetAudioWorklet();
      audioWorkletNeedsReset = false;
    })
    .catch(() => {});
});

window.addEventListener('offline', () => {
  resumeAfterOnline = Boolean(audioStarted && !streamPaused);
  clearTimeout(controlReconnectTimer);
  controlReconnectTimer = null;
  wsGeneration += 1;
  if (controlWs) {
    controlWs.close();
    controlWs = null;
  }
  stopRaw();
  stopOpus();
  stopCompatible();
  resetAudioWorklet();
  setStatus('', 'disconnected');
});

window.addEventListener('online', () => {
  connectControlWebSocket();
  if (!resumeAfterOnline || !audioStarted || streamPaused) return;
  resumeAfterOnline = false;
  const resumed = audioContext ? audioContext.resume() : Promise.resolve();
  resumed
    .then(() => {
      resetAudioWorklet();
      startSelectedMode(preferredMode);
    })
    .catch(() => {});
});

window.addEventListener('pagehide', (event) => {
  resumeAfterPageShow = Boolean(event.persisted && audioStarted && !streamPaused);
  resetAudioWorklet();
  stopRaw();
  stopOpus();
  stopCompatible();
});

window.addEventListener('pageshow', (event) => {
  if (!event.persisted || !resumeAfterPageShow || !audioStarted || streamPaused) return;
  resumeAfterPageShow = false;
  const resumed = audioContext ? audioContext.resume() : Promise.resolve();
  resumed
    .then(() => {
      resetAudioWorklet();
      startSelectedMode(currentMode || preferredMode);
    })
    .catch(() => {});
});

function updateBuffered() {
  if (streamPaused) {
    bufferedEl.textContent = 'Idle';
    browserBandwidthEl.textContent = 'Idle';
    return;
  }
  updateBrowserBandwidth();
  if (currentMode === 'compatible') {
    bufferedEl.textContent = `${getOpusBufferedMs()} ms`;
    return;
  }
  if (currentMode === 'opus' && activeCompressedKind !== 'adpcm') {
    syncOpusLivePlayback();
    bufferedEl.textContent = `${getOpusBufferedMs()} ms`;
    return;
  }
  if (audioWorkletNode && (currentMode === 'raw' || activeCompressedKind === 'adpcm')) {
    const inputSampleRate = audioWorkletDiagnostics?.inputSampleRate || config.sampleRate;
    const bufferedFrames = audioWorkletDiagnostics?.bufferedFrames || 0;
    const bufferedMs = inputSampleRate ? Math.round(bufferedFrames / inputSampleRate * 1000) : 0;
    bufferedEl.textContent = `${bufferedMs} ms`;
    bufferedEl.dataset.underruns = String(audioWorkletDiagnostics?.underruns || 0);
    bufferedEl.dataset.overflows = String(audioWorkletDiagnostics?.overflows || 0);
    bufferedEl.dataset.droppedFrames = String(audioWorkletDiagnostics?.droppedFrames || 0);
    return;
  }
  if (audioContext) {
    queuedFrames = Math.max(0, Math.round((nextPlayTime - audioContext.currentTime) * config.sampleRate));
  }
  const bufferedMs = config.sampleRate ? Math.round(queuedFrames / config.sampleRate * 1000) : 0;
  bufferedEl.textContent = `${bufferedMs} ms${audioWorkletFailed && isAudioWorkletRequested() ? ' · Fallback' : ''}`;
}

function updateBrowserBandwidth() {
  if (streamPaused) {
    browserBandwidthEl.textContent = 'Idle';
    return;
  }
  if (currentMode === 'compatible') {
    if (!compatibleBandwidthReady) browserBandwidthEl.textContent = 'Loading';
    return;
  }
  const now = Date.now();
  const elapsedSeconds = Math.max(0.001, (now - lastBandwidthAt) / 1000);
  const bitsPerSecond = Math.max(0, (receivedBytes - lastBandwidthBytes) * 8 / elapsedSeconds);
  lastBandwidthBytes = receivedBytes;
  lastBandwidthAt = now;
  browserBandwidthEl.textContent = formatBandwidth(bitsPerSecond);
}

function updateServerMeasuredBandwidth(bitsPerSecond) {
  if (currentMode === 'compatible') {
    if (!compatibleBandwidthReady && bitsPerSecond <= 0) {
      browserBandwidthEl.textContent = 'Loading';
      return;
    }
    compatibleBandwidthReady = true;
  }
  browserBandwidthEl.textContent = formatBandwidth(bitsPerSecond);
}

function getOpusBufferedMs() {
  if (currentMode === 'compatible' && compatibleAudio) return getAudioBufferedMs(compatibleAudio);
  return getAudioBufferedMs(opusAudio);
}

function getAudioBufferedMs(audioElement) {
  if (!audioElement || audioElement.buffered.length === 0) return 0;
  const liveEdge = audioElement.buffered.end(audioElement.buffered.length - 1);
  return Math.max(0, Math.round((liveEdge - audioElement.currentTime) * 1000));
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
  if (modeNoticeOverlay && !modeNoticeOverlay.hidden && modeNoticeOverlay.dataset.notice === 'startup-mode') {
    showStartupModeNotice(modeNoticeOverlay.dataset.mode || preferredMode);
  } else if (modeNoticeOverlay && !modeNoticeOverlay.hidden && modeNoticeOverlay.dataset.notice === 'stream-unavailable') {
    showStreamUnavailable();
  } else if (modeNoticeOverlay && !modeNoticeOverlay.hidden && modeNoticeOverlay.dataset.mode) {
    showModeNotice(modeNoticeOverlay.dataset.mode);
  } else if (modeNoticeOverlay && !modeNoticeOverlay.hidden && modeNoticeOverlay.dataset.notice === 'mobile-startup') {
    showMobileStartupNotice();
  }
  titleLink.title = t('returnHome');
  if (serverNoticeEl && !serverNoticeEl.hidden) {
    const textEl = serverNoticeEl.querySelector('[data-role="server-notice-text"]');
    const reloadButton = serverNoticeEl.querySelector('[data-role="server-notice-reload"]');
    if (textEl) textEl.textContent = t(serverNoticeKind === 'restarted' ? 'serverRestarted' : 'serverDisconnected');
    if (reloadButton) reloadButton.textContent = t('reload');
  }
  updateStatusLabel();
  lastHeardEl.textContent = localizeLastHeard(lastHeardLabel);
  if (audioWorkletFailed) bufferedEl.title = t('workletFallback');
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

function isCompatibleAvailable() {
  return Boolean(config.opusAvailable);
}

function getAvailableModes() {
  const modes = ['raw'];
  if (isCompressedAvailable()) modes.push('opus');
  if (isCompatibleAvailable()) modes.push('compatible');
  return modes;
}

function modeLabel(mode) {
  if (mode === 'compatible') return t('compatible');
  if (mode === 'opus') return t('compressed');
  return t('uncompressed');
}

function selectMode(mode) {
  if (!['raw', 'opus', 'compatible'].includes(mode) || !getAvailableModes().includes(mode)) return;
  closeModeMenu();
  if (mode === preferredMode && (!audioStarted || currentMode === mode)) return;
  if (mode === 'compatible' || mode === 'opus' || (preferredMode === 'compatible' && isMobileDevice())) {
    showModeNotice(mode);
    return;
  }
  applySelectedMode(mode);
}

function applySelectedMode(mode) {
  setPreferredMode(mode);
  if (audioStarted) startSelectedMode();
  updateModeButton();
}

function setPreferredMode(mode) {
  preferredMode = mode;
}

function updateModeMenu() {
  const availableModes = getAvailableModes();
  const visibleMode = audioStarted ? currentMode : preferredMode;
  modeOptions.forEach((option) => {
    const mode = option.dataset.modeOption;
    option.textContent = modeLabel(mode);
    option.disabled = !availableModes.includes(mode);
    option.classList.toggle('active', mode === visibleMode);
    option.classList.toggle('compatible-option', mode === 'compatible');
  });
}

function closeModeMenu() {
  if (!modeMenu) return;
  modeMenu.hidden = true;
  modeButton.setAttribute('aria-expanded', 'false');
}

function showModeNotice(mode) {
  if (hasAcceptedNotice(modeNoticeKeyForMode(mode))) {
    applySelectedMode(mode);
    return;
  }
  if (!modeNoticeOverlay) {
    applySelectedMode(mode);
    return;
  }
  delete modeNoticeOverlay.dataset.notice;
  modeNoticeOverlay.dataset.mode = mode;
  if (modeNoticeTitle) modeNoticeTitle.textContent = t(modeNoticeTitleKey(mode));
  if (modeNoticeBody) modeNoticeBody.textContent = t(modeNoticeBodyKey(mode));
  if (modeNoticeAccept) modeNoticeAccept.textContent = t('accept');
  modeNoticeOverlay.hidden = false;
}

function showStartupNoticeIfNeeded() {
  if (audioStarted) return;
  if (isMobileDevice()) {
    showMobileStartupNoticeIfNeeded();
    return;
  }
  if (preferredMode !== 'raw' || !getAvailableModes().includes('raw') || hasAcceptedNotice(modeNoticeKeyForMode('raw'))) return;
  showStartupModeNotice('raw');
}

function showMobileStartupNoticeIfNeeded() {
  if (mobileStartupNoticeShown || audioStarted || !isMobileDevice() || preferredMode !== 'opus' || !isCompressedAvailable() || !isCompatibleAvailable()) return;
  if (hasAcceptedNotice('mobile-startup')) return;
  mobileStartupNoticeShown = true;
  showMobileStartupNotice();
}

function showMobileStartupNotice() {
  if (!modeNoticeOverlay) return;
  delete modeNoticeOverlay.dataset.mode;
  modeNoticeOverlay.dataset.notice = 'mobile-startup';
  if (modeNoticeTitle) modeNoticeTitle.textContent = t('mobileStartupNoticeTitle');
  if (modeNoticeBody) modeNoticeBody.textContent = t('mobileStartupNoticeBody');
  if (modeNoticeAccept) modeNoticeAccept.textContent = t('accept');
  modeNoticeOverlay.hidden = false;
}

function showStartupModeNotice(mode) {
  if (!modeNoticeOverlay) return;
  delete modeNoticeOverlay.dataset.notice;
  modeNoticeOverlay.dataset.notice = 'startup-mode';
  modeNoticeOverlay.dataset.mode = mode;
  if (modeNoticeTitle) modeNoticeTitle.textContent = t(modeNoticeTitleKey(mode));
  if (modeNoticeBody) modeNoticeBody.textContent = t(modeNoticeBodyKey(mode));
  if (modeNoticeAccept) modeNoticeAccept.textContent = t('accept');
  modeNoticeOverlay.hidden = false;
}

function modeNoticeTitleKey(mode) {
  if (mode === 'compatible') return 'compatibleNoticeTitle';
  if (mode === 'opus') return 'compressedNoticeTitle';
  return 'uncompressedNoticeTitle';
}

function modeNoticeBodyKey(mode) {
  if (mode === 'compatible') return 'compatibleNoticeBody';
  if (mode === 'opus') return 'compressedNoticeBody';
  return 'uncompressedNoticeBody';
}

function modeNoticeKeyForMode(mode) {
  if (mode === 'compatible') return 'compatible-mode';
  if (mode === 'opus') return 'compressed-realtime-mode';
  return 'uncompressed-realtime-mode';
}

function hasAcceptedNotice(key) {
  return sessionStorage.getItem(`${acceptedNoticeStoragePrefix}${key}`) === 'true';
}

function rememberNoticeAccepted(key) {
  sessionStorage.setItem(`${acceptedNoticeStoragePrefix}${key}`, 'true');
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
