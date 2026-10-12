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
    users: 'Users', gain: 'Gain', startAudio: 'Start Audio', mute: 'Mute', unmute: 'Unmute', buffered: 'Buffered', bandwidth: 'Bandwidth', lastHeardTime: 'Last Heard Time', mode: 'Mode', level: 'Level', localTime: 'Local Time', disconnected: 'Disconnected', waitingUdp: 'Waiting for UDP', connected: 'Connected', idle: 'Push to Reconnect', pushDisconnect: 'Push to disconnect', stopStream: 'Stop stream', returnHome: 'Click to return home', normalUnavailable: 'Normal unavailable', compressed: 'Normal', uncompressed: 'RAW', switchMode: 'Switch audio mode', never: 'never', now: 'Now',
    audioUnavailable: 'Audio unavailable. Use HTTPS and a browser with AudioWorklet support.', opusLive: 'Low Data', opusLiveUnavailable: 'Low Data unavailable', modeUnavailable: 'Mode unavailable',
    serverDisconnected: 'Connection to the server was lost. Reconnecting...',
    serverRestarted: 'The server restarted. This page reconnected; refresh if audio does not resume.',
    streamUnavailableTitle: 'Stream updated',
    streamUnavailableBody: 'This stream is no longer available with its previous configuration. Return to the home page to see the updated stream list.',
    returnToHome: 'Return to home',
    reload: 'Reload',
    accept: 'Accept',
  },
  es: {
    users: 'Usuarios', gain: 'Ganancia', startAudio: 'Iniciar audio', mute: 'Silenciar', unmute: 'Activar audio', buffered: 'Buffer', bandwidth: 'Ancho de banda', lastHeardTime: 'Ultima transmision', mode: 'Modo', level: 'Nivel', localTime: 'Hora local', disconnected: 'Desconectado', waitingUdp: 'Esperando UDP', connected: 'Conectado', idle: 'Presiona para reconectar', pushDisconnect: 'Presiona para desconectar', stopStream: 'Detener stream', returnHome: 'Click para volver a la pagina principal', normalUnavailable: 'Normal no disponible', compressed: 'Normal', uncompressed: 'RAW', switchMode: 'Cambiar modo de audio', never: 'nunca', now: 'Ahora',
    audioUnavailable: 'Audio no disponible. Usa HTTPS y un navegador compatible con AudioWorklet.', opusLive: 'Internet lento', opusLiveUnavailable: 'Internet lento no disponible', modeUnavailable: 'Modo no disponible',
    serverDisconnected: 'Se perdio la conexion con el servidor. Reconectando...',
    serverRestarted: 'El servidor se reinicio. Esta pagina se reconecto; actualiza si el audio no vuelve.',
    streamUnavailableTitle: 'Stream actualizado',
    streamUnavailableBody: 'Este stream ya no esta disponible con su configuracion anterior. Regresa a la pagina principal para ver la lista actualizada.',
    returnToHome: 'Volver al inicio',
    reload: 'Actualizar',
    accept: 'Aceptar',
  },
};

let language = localStorage.getItem('udp-airband-language') || 'en';
if (!translations[language]) language = 'en';
let currentStatusKey = 'disconnected';
let lastHeardLabel = 'never';

let audioContext;
let gainNode;
let config = { sampleRate: 8000, channels: 1 };
let gain = Number(gainInput.value);
let lastPeak = 0;
let latestWave = new Float32Array(0);
let lastUdpAt = 0;
let lastAudioAt = 0;
let streamConfirmed = false;
let wsGeneration = 0;
let controlWs;
let serverInstanceId = '';
let serverNoticeEl;
let serverNoticeKind = '';
let streamUnavailable = false;
let rawWs;
let adpcmWs;
let currentMode = 'raw';
let preferredMode = 'adpcm';
let opusRealtimeServerAvailable = false;
let opusRealtimeSupported = false;
let opusRealtimeModulePromise;
let opusRealtimeWebSocket;
let opusRealtimeDecoder;
let opusRealtimeWorkletNode;
let opusRealtimeWorkletPromise;
let opusRealtimeWorkletConnected = false;
let opusRealtimeWorkletConfiguration = '';
let opusRealtimeWorkletDiagnostics = null;
let opusRealtimeGeneration = 0;
let opusRealtimeReconnectTimer;
let opusRealtimeErrorReported = false;
let opusRealtimeDeliveredFrames = 0;
let opusRealtimeDeliveryDroppedFrames = 0;

// Read-only local diagnostics: no listener IDs or telemetry leave the browser.
window.getAudioDiagnostics = () => ({
  mode: currentMode,
  audioContextState: audioContext?.state || 'uninitialized',
  decoder: opusRealtimeDecoder?.diagnostics() || null,
  delivery: { deliveredFrames: opusRealtimeDeliveredFrames, droppedFrames: opusRealtimeDeliveryDroppedFrames },
  playback: opusRealtimeWorkletDiagnostics ? { ...opusRealtimeWorkletDiagnostics } : null,
});
let audioStarted = false;
let muted = false;
let streamPaused = false;
let pausedMode = null;
let statusHovering = false;
let receivedBytes = 0;
let lastBandwidthBytes = 0;
let lastBandwidthAt = Date.now();
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
const configuredBasePath = document.querySelector('base')?.getAttribute('href') || '/';
const appBasePath = new URL(configuredBasePath, location.origin).pathname.replace(/\/?$/, '/');
function appPath(path) {
  return `${appBasePath}${String(path).replace(/^\/+/, '')}`;
}
function appWebSocketUrl(path) {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${appPath(path)}`;
}
const streamName = decodeURIComponent(location.pathname.slice(appBasePath.length).replace(/^\/+|\/+$/g, ''));
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
    if (modeNoticeOverlay?.dataset.notice === 'stream-unavailable') location.href = appPath('');
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
  startAudioPlayback().catch(handlePlaybackError);
});

async function startAudioPlayback() {
  if (audioStarted) {
    if (audioContext && audioContext.state !== 'running') {
      requestBackgroundPlaybackSession();
      await audioContext.resume();
    }
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
  }

  requestBackgroundPlaybackSession();
  const resumePromise = audioContext.resume();
  await resumePromise;
  await ensurePcmWorkletConnected();
  connectControlWebSocket();
  streamPaused = false;
  audioStarted = true;
  startSelectedMode();
  updateAudioButton();
  updateGainControl();
  updateConnectionState();
}

function requestBackgroundPlaybackSession() {
  try {
    if (navigator.audioSession && navigator.audioSession.type !== 'playback') {
      navigator.audioSession.type = 'playback';
    }
  } catch {
    // The browser may not expose or allow changing audioSession.
  }
}

function applyOutputGain() {
  if (gainNode) gainNode.gain.value = muted ? 0 : gain;
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

  const generation = ++wsGeneration;
  controlWs = new WebSocket(`${appWebSocketUrl(`${encodeURIComponent(streamName)}/control`)}?clientId=${encodeURIComponent(clientId)}`);

  controlWs.addEventListener('open', () => {
    if (generation === wsGeneration) updateConnectionState();
  });
  controlWs.addEventListener('close', () => {
    if (generation === wsGeneration) {
      setStatus('', 'disconnected');
      if (!streamUnavailable) {
        showServerNotice('disconnected');
        setTimeout(connectControlWebSocket, 1000);
      }
    }
  });
  controlWs.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      const message = JSON.parse(event.data);
      if (message.type === 'config') {
        config = message;
        opusRealtimeServerAvailable = Boolean(message.opusRealtimeAvailable);
        opusRealtimeSupported = false;
        updateServerInstance(message.serverInstanceId);
        document.title = `${message.label} - UDP Airband Monitor`;
        titleLink.textContent = message.label;
        titleLink.title = t('returnHome');
        if (audioStarted && getAvailableModes().includes(preferredMode) && currentMode !== preferredMode) {
          startSelectedMode();
        }
        updateModeButton();
        updateConnectionState();
        if (opusRealtimeServerAvailable) {
          probeOpusRealtimeSupport().then((supported) => {
            opusRealtimeSupported = supported;
            updateModeButton();
            if (supported && audioStarted && currentMode !== preferredMode) startSelectedMode(preferredMode);
            if (!supported && currentMode === 'opus-live') handlePlaybackError(new Error('Low Data unavailable'));
          });
        }
      } else if (message.type === 'streamUpdated') {
        applyStreamUpdate(message.stream);
      } else if (message.type === 'streamUnavailable') {
        showStreamUnavailable();
      } else if (message.type === 'stats') {
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

async function probeOpusRealtimeSupport() {
  if (!window.isSecureContext
    || !window.AudioWorkletNode
    || !window.AudioDecoder
    || !window.EncodedAudioChunk) return false;
  try {
    const module = await loadOpusRealtimeModule();
    return module.supportsOpusAudioDecoder(window.AudioDecoder);
  } catch {
    return false;
  }
}

function loadOpusRealtimeModule() {
  if (!opusRealtimeModulePromise) {
    const version = encodeURIComponent(config.softwareVersion || '2.0-preview');
    opusRealtimeModulePromise = import(`${appPath('assets/opus-webcodecs.mjs')}?v=${version}`)
      .catch((error) => {
        opusRealtimeModulePromise = null;
        throw error;
      });
  }
  return opusRealtimeModulePromise;
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
    stopNormal();
    stopOpusRealtime();
    hideServerNotice();
  }
  if (!modeNoticeOverlay) {
    location.href = appPath('');
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
  lastBandwidthBytes = receivedBytes;
  lastBandwidthAt = Date.now();
  browserBandwidthEl.textContent = 'Idle';
  if (mode === 'opus-live') {
    if (!isOpusRealtimeAvailable()) {
      handlePlaybackError(new Error('Low Data unavailable'));
      return;
    }
    startOpusRealtime();
    updateModeButton();
    return;
  }
  if (mode === 'adpcm') {
    startNormal();
  } else if (mode === 'raw') {
    startRaw();
  } else {
    handlePlaybackError(new Error('Unknown audio profile'));
    return;
  }
  updateModeButton();
}

function pauseStream() {
  pausedMode = currentMode;
  streamPaused = true;
  stopRaw();
  stopNormal();
  stopOpusRealtime();
  latestWave = new Float32Array(0);
  lastPeak = 0;
  updateConnectionState();
  updateBuffered();
}

function resumeStream() {
  streamPaused = false;
  if (audioStarted) {
    startSelectedMode(pausedMode || currentMode || preferredMode);
  }
  pausedMode = null;
  updateConnectionState();
}

function startRaw() {
  stopOpusRealtime();
  stopNormal();
  if (rawWs && rawWs.readyState <= 1) return;

  currentMode = 'raw';
  const socket = new WebSocket(`${appWebSocketUrl(`${encodeURIComponent(streamName)}/audio`)}?clientId=${encodeURIComponent(clientId)}`);
  rawWs = socket;
  socket.binaryType = 'arraybuffer';
  socket.addEventListener('close', () => {
    if (rawWs !== socket) return;
    rawWs = null;
    setTimeout(() => {
      if (audioStarted && !streamPaused && currentMode === 'raw' && !rawWs) startRaw();
    }, 1000);
  });
  socket.addEventListener('message', (event) => {
    if (rawWs !== socket || !audioStarted || streamPaused || !(event.data instanceof ArrayBuffer)) return;
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

function startNormal() {
  stopRaw();
  stopOpusRealtime();
  stopNormal();
  currentMode = 'adpcm';
  startAdpcm();
}

function startOpusRealtime() {
  if (!isOpusRealtimeAvailable()) {
    setStatus('', 'opusLiveUnavailable');
    return;
  }
  stopRaw();
  stopNormal();
  stopOpusRealtime();
  currentMode = 'opus-live';
  opusRealtimeErrorReported = false;
  opusRealtimeDeliveredFrames = 0;
  opusRealtimeDeliveryDroppedFrames = 0;
  const generation = ++opusRealtimeGeneration;

  Promise.all([ensureOpusRealtimeWorklet(), loadOpusRealtimeModule()])
    .then(([worklet, module]) => {
      if (generation !== opusRealtimeGeneration || currentMode !== 'opus-live' || streamPaused) return;
      if (!opusRealtimeWorkletConnected) {
        worklet.connect(gainNode);
        opusRealtimeWorkletConnected = true;
      }
      opusRealtimeDecoder = new module.OpusWebCodecsDecoder({
        onPcm: deliverOpusRealtimePcm,
        onError: (error) => handleOpusRealtimeError(error, generation),
        onSequenceGap: (missing) => {
          if (missing > 0) console.debug(`Realtime Opus skipped ${missing} packet(s)`);
        },
      });
      const socket = new WebSocket(`${appWebSocketUrl(`${encodeURIComponent(streamName)}/opus-live`)}?clientId=${encodeURIComponent(clientId)}`);
      opusRealtimeWebSocket = socket;
      socket.binaryType = 'arraybuffer';
      socket.addEventListener('message', (event) => {
        if (generation !== opusRealtimeGeneration || !(event.data instanceof ArrayBuffer)) return;
        receivedBytes += event.data.byteLength;
        streamConfirmed = true;
        opusRealtimeDecoder?.push(event.data).catch(() => {});
        lastAudioAt = Date.now();
        updateConnectionState();
      });
      socket.addEventListener('open', updateConnectionState, { once: true });
      socket.addEventListener('close', () => {
        if (generation !== opusRealtimeGeneration) return;
        opusRealtimeDecoder?.close();
        opusRealtimeDecoder = null;
        resetOpusRealtimeWorklet();
        if (currentMode === 'opus-live' && audioStarted && !streamPaused) {
          clearTimeout(opusRealtimeReconnectTimer);
          opusRealtimeReconnectTimer = setTimeout(startOpusRealtime, 1000);
        }
      });
      socket.addEventListener('error', () => setStatus('', 'opusLiveUnavailable'));
      updateModeButton();
      updateMediaSessionMetadata();
    })
    .catch((error) => handleOpusRealtimeError(error, generation));
}

async function ensureOpusRealtimeWorklet() {
  if (!audioContext || !gainNode || !window.isSecureContext || !audioContext.audioWorklet || !window.AudioWorkletNode) {
    throw new Error('AudioWorklet requires HTTPS and browser support');
  }
  if (opusRealtimeWorkletNode) return opusRealtimeWorkletNode;
  if (!opusRealtimeWorkletPromise) {
    const version = encodeURIComponent(config.softwareVersion || '2.0-preview');
    opusRealtimeWorkletPromise = audioContext.audioWorklet.addModule(`${appPath('assets/audio-worklet.mjs')}?v=${version}`)
      .then(() => {
        if (!audioContext || audioContext.state === 'closed') throw new Error('AudioContext closed during Worklet initialization');
        const node = new AudioWorkletNode(audioContext, 'opus-pcm', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        node.port.onmessage = ({ data }) => {
          if (data?.type === 'worklet-diagnostics') opusRealtimeWorkletDiagnostics = data;
          if (data?.type === 'worklet-error') handlePlaybackError(new Error(data.message));
        };
        node.addEventListener('processorerror', () => {
          handlePlaybackError(new Error('AudioWorklet processor failed'));
          node.port.close();
          opusRealtimeWorkletNode = null;
        });
        opusRealtimeWorkletNode = node;
        return node;
      })
      .finally(() => { opusRealtimeWorkletPromise = null; });
  }
  return opusRealtimeWorkletPromise;
}

async function ensurePcmWorkletConnected() {
  const node = await ensureOpusRealtimeWorklet();
  if (!opusRealtimeWorkletConnected) {
    node.connect(gainNode);
    opusRealtimeWorkletConnected = true;
  }
  return node;
}

function deliverOpusRealtimePcm(samples, frames, sampleRate, channels) {
  const node = opusRealtimeWorkletNode;
  if (!node || currentMode !== 'opus-live' || !audioContext || audioContext.state !== 'running') {
    opusRealtimeDeliveryDroppedFrames += frames;
    return;
  }
  if (!configureOpusRealtimeWorklet(sampleRate, channels)) {
    opusRealtimeDeliveryDroppedFrames += frames;
    return;
  }
  if (samples.length > 0) {
    latestWave = samples.slice(Math.max(0, samples.length - 4096));
    lastPeak = Math.max(lastPeak * 0.92, peakOf(samples));
    lastAudioAt = Date.now();
  }
  try {
    node.port.postMessage({ type: 'samples', buffer: samples.buffer, frames, channels }, [samples.buffer]);
    opusRealtimeDeliveredFrames += frames;
  } catch (error) {
    opusRealtimeDeliveryDroppedFrames += frames;
    handleOpusRealtimeError(error, opusRealtimeGeneration);
  }
}

function configureOpusRealtimeWorklet(sampleRate, channels) {
  if (!opusRealtimeWorkletNode) return false;
  const targetLatencyMs = Number(config.opusWorkletTargetLatencyMs) || 100;
  const highWaterMs = Math.max(targetLatencyMs + 40, targetLatencyMs * 3.2);
  const key = `${sampleRate}:${channels}:${targetLatencyMs}:${highWaterMs}`;
  if (key === opusRealtimeWorkletConfiguration) return true;
  opusRealtimeWorkletNode.port.postMessage({
    type: 'configure',
    inputSampleRate: sampleRate,
    channels,
    targetLatencyMs,
    highWaterMs,
    capacitySeconds: 2,
    maxDrift: 0.004,
  });
  opusRealtimeWorkletConfiguration = key;
  opusRealtimeWorkletDiagnostics = null;
  return true;
}

function resetOpusRealtimeWorklet() {
  if (opusRealtimeWorkletNode) opusRealtimeWorkletNode.port.postMessage({ type: 'reset' });
  opusRealtimeWorkletConfiguration = '';
  opusRealtimeWorkletDiagnostics = null;
  latestWave = new Float32Array(0);
  lastPeak = 0;
}

function stopOpusRealtime() {
  opusRealtimeGeneration += 1;
  clearTimeout(opusRealtimeReconnectTimer);
  opusRealtimeReconnectTimer = null;
  if (opusRealtimeWebSocket && opusRealtimeWebSocket.readyState <= 1) opusRealtimeWebSocket.close();
  opusRealtimeWebSocket = null;
  if (opusRealtimeDecoder) opusRealtimeDecoder.close();
  opusRealtimeDecoder = null;
  resetOpusRealtimeWorklet();
  if (opusRealtimeWorkletNode && opusRealtimeWorkletConnected) {
    opusRealtimeWorkletNode.disconnect(gainNode);
    opusRealtimeWorkletConnected = false;
  }
}

function handleOpusRealtimeError(error, generation) {
  if (generation !== opusRealtimeGeneration || opusRealtimeErrorReported) return;
  opusRealtimeErrorReported = true;
  handlePlaybackError(error);
}

function handlePlaybackError(error) {
  console.warn('Audio playback failed:', error?.message || error);
  stopRaw();
  stopNormal();
  stopOpusRealtime();
  audioStarted = false;
  setStatus('', 'audioUnavailable');
  updateAudioButton();
  updateModeButton();
}

function startAdpcm() {
  currentMode = 'adpcm';

  const socket = new WebSocket(`${appWebSocketUrl(`${encodeURIComponent(streamName)}/adpcm`)}?clientId=${encodeURIComponent(clientId)}`);
  adpcmWs = socket;
  socket.binaryType = 'arraybuffer';
  socket.addEventListener('message', (event) => {
    if (adpcmWs !== socket || !audioStarted || streamPaused || !(event.data instanceof ArrayBuffer)) return;
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
  socket.addEventListener('close', () => {
    if (adpcmWs !== socket) return;
    adpcmWs = null;
    setTimeout(() => {
      if (audioStarted && !streamPaused && currentMode === 'adpcm' && !adpcmWs) startNormal();
    }, 1000);
  });
  socket.addEventListener('error', () => {
    if (adpcmWs === socket) setStatus('', 'normalUnavailable');
  });
}

function updateMediaSessionMetadata() {
  if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: document.title || titleLink.textContent || streamName,
    artist: titleLink.textContent || streamName,
    album: 'UDP Airband Server',
  });
}

function stopRaw() {
  if (rawWs) {
    const socket = rawWs;
    rawWs = null;
    socket.close();
  }
}

function stopNormal() {
  if (adpcmWs) {
    const socket = adpcmWs;
    adpcmWs = null;
    socket.close();
  }
}

function updateModeButton() {
  const visibleMode = audioStarted ? currentMode : preferredMode;
  modeButton.textContent = modeLabel(visibleMode);
  modeButton.disabled = getAvailableModes().length <= 1;
  modeButton.title = getAvailableModes().length > 1 ? t('switchMode') : t('modeUnavailable');
  modeButton.classList.toggle('opus-live-mode', visibleMode === 'opus-live');
  updateModeMenu();
}

function scheduleAudio(samples, frames) {
  if (!audioContext || audioContext.state !== 'running') return;
  if (!opusRealtimeWorkletNode) {
    handlePlaybackError(new Error('AudioWorklet is not initialized'));
    return;
  }
  if (!opusRealtimeWorkletConnected) {
    opusRealtimeWorkletNode.connect(gainNode);
    opusRealtimeWorkletConnected = true;
  }
  if (!configureOpusRealtimeWorklet(config.sampleRate, config.channels)) return;
  const copy = samples.slice();
  opusRealtimeWorkletNode.port.postMessage({ type: 'samples', buffer: copy.buffer, frames, channels: config.channels }, [copy.buffer]);
  opusRealtimeDeliveredFrames += frames;
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
  if (lastAudioAt && Date.now() - lastAudioAt > 350) {
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
  const channels = currentMode === 'opus-live' ? 1 : config.channels;
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
  const diagnostics = opusRealtimeWorkletDiagnostics;
  const rate = diagnostics?.inputSampleRate || config.sampleRate;
  bufferedEl.textContent = String(rate ? Math.round((diagnostics?.bufferedFrames || 0) / rate * 1000) : 0) + ' ms';
}

function updateBrowserBandwidth() {
  if (streamPaused) {
    browserBandwidthEl.textContent = 'Idle';
    return;
  }

  const now = Date.now();
  const elapsedSeconds = Math.max(0.001, (now - lastBandwidthAt) / 1000);
  if (elapsedSeconds < 1) return;
  const bitsPerSecond = Math.max(0, (receivedBytes - lastBandwidthBytes) * 8 / elapsedSeconds);
  lastBandwidthBytes = receivedBytes;
  lastBandwidthAt = now;
  browserBandwidthEl.textContent = formatBandwidth(bitsPerSecond);
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
  if (modeNoticeOverlay && !modeNoticeOverlay.hidden && modeNoticeOverlay.dataset.notice === 'stream-unavailable') showStreamUnavailable();
  titleLink.title = t('returnHome');
  if (serverNoticeEl && !serverNoticeEl.hidden) {
    const textEl = serverNoticeEl.querySelector('[data-role="server-notice-text"]');
    const reloadButton = serverNoticeEl.querySelector('[data-role="server-notice-reload"]');
    if (textEl) textEl.textContent = t(serverNoticeKind === 'restarted' ? 'serverRestarted' : 'serverDisconnected');
    if (reloadButton) reloadButton.textContent = t('reload');
  }
  updateStatusLabel();
  lastHeardEl.textContent = localizeLastHeard(lastHeardLabel);
}

function localizeLastHeard(label) {
  if (!label || label === 'never') return t('never');
  if (label === 'Now') return t('now');
  if (language === 'es') {
    const seconds = label.match(/^(\d+)s ago$/);
    if (seconds) return `hace ${seconds[1]} s`;
    const hours = label.match(/^(\d+)h ago$/);
    if (hours) return `hace ${hours[1]} h`;
    const days = label.match(/^(\d+)d ago$/);
    if (days) return `hace ${days[1]} d`;
  }
  return label;
}

function isOpusRealtimeAvailable() {
  return Boolean(opusRealtimeServerAvailable && opusRealtimeSupported);
}

function getAvailableModes() {
  const modes = ['raw', 'adpcm'];
  if (isOpusRealtimeAvailable()) modes.push('opus-live');
  return modes;
}

function modeLabel(mode) {
  if (mode === 'opus-live') return t('opusLive');
  if (mode === 'adpcm') return t('compressed');
  return t('uncompressed');
}

function selectMode(mode) {
  if (!['raw', 'adpcm', 'opus-live'].includes(mode) || !getAvailableModes().includes(mode)) return;
  closeModeMenu();
  if (mode === preferredMode && (!audioStarted || currentMode === mode)) return;
  applySelectedMode(mode);
}

function applySelectedMode(mode) {
  lastBandwidthBytes = receivedBytes;
  lastBandwidthAt = Date.now();
  browserBandwidthEl.textContent = 'Idle';
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
    option.classList.toggle('opus-live-option', mode === 'opus-live');
  });
}

function closeModeMenu() {
  if (!modeMenu) return;
  modeMenu.hidden = true;
  modeButton.setAttribute('aria-expanded', 'false');
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
