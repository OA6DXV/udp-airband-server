'use strict';

const form = document.getElementById('streamsForm');
const rowsEl = document.getElementById('streamRows');
const rowTemplate = document.getElementById('streamRowTemplate');
const addButton = document.getElementById('addStream');
const saveButton = document.getElementById('saveStreams');
const discardButton = document.getElementById('discardStreams');
const revertButton = document.getElementById('revertStreams');
const messageEl = document.getElementById('message');
const dirtyStateEl = document.getElementById('dirtyState');
const reloadButton = document.getElementById('reloadStreams');
const restartButton = document.getElementById('restartServer');
const restartDialog = document.getElementById('restartDialog');
const restartDialogTitle = document.getElementById('restartDialogTitle');
const restartWarning = document.getElementById('restartWarning');
const confirmRestartButton = document.getElementById('confirmRestart');
const reloadDialog = document.getElementById('reloadDialog');
const confirmReloadButton = document.getElementById('confirmReload');
const removeStreamDialog = document.getElementById('removeStreamDialog');
const confirmRemoveStreamButton = document.getElementById('confirmRemoveStream');
const serverStatusEl = document.getElementById('serverStatus');
const versionEl = document.getElementById('version');
const languageSelect = document.getElementById('languageSelect');
const chart = document.getElementById('historyChart');
const chartEmpty = document.getElementById('chartEmpty');
const logoutButton = document.getElementById('logoutButton');

const ONLINE_REFRESH_MS = 15000;
const RECOVERY_REFRESH_MS = 1000;
const RESTART_TIMEOUT_MS = 15000;
const HISTORY_WINDOW_MS = 12 * 60 * 60 * 1000;
const LANGUAGE_STORAGE_KEY = 'udp-airband-language';
const translations = {
  en: {
    webAdmin: 'Web Admin',
    loading: 'Loading',
    language: 'Language',
    serverOverview: 'Server overview',
    activeUsers: 'Active users',
    configuredStreams: 'Configured streams',
    uptime: 'Uptime',
    configuration: 'Configuration',
    connectedUsers: 'Connected users',
    historyDescription: 'Unique clients during the last 12 hours',
    historyAria: 'Connected user history',
    openUsersDetails: 'Open connected users details',
    collectingHistory: 'Collecting history...',
    twelveHoursAgo: '12 hours ago',
    now: 'Now',
    streams: 'Streams',
    streamsDescription: 'Changes are applied live and saved to streams.json.',
    addStream: '+ Add stream',
    routeName: 'Route name',
    displayName: 'Display name',
    udpHost: 'UDP host',
    udpPort: 'UDP port',
    sampleRate: 'Sample rate',
    channels: 'Channels',
    actions: 'Actions',
    mono: 'Mono',
    stereo: 'Stereo',
    noUnsavedChanges: 'No unsaved changes',
    unsavedChanges: 'Unsaved changes',
    labelOnlyChanges: 'Only display names changed. No stream reload is needed.',
    structuralChanges: 'Structural stream changes detected. Affected listeners will be notified.',
    labelChangesApplied: 'Display name changes were saved and applied live. Reload is not needed.',
    structuralChangesApplied: 'Structural changes were saved. Reload streams to confirm the runtime configuration; affected listeners were notified.',
    discardChanges: 'Discard changes',
    revertConfiguration: 'Revert configuration',
    applyChanges: 'Apply changes',
    reloadStreams: 'Reload streams',
    reloadTitle: 'Reload streams?',
    reloadNotRequiredWarning: 'Reload is not required right now. Reloading streams can interrupt active listeners if the disk configuration contains structural changes.',
    serverProcess: 'Server process',
    detectingRuntime: 'Detecting how the server was started...',
    restartServer: 'Restart server',
    cancel: 'Cancel',
    removeStream: 'Remove stream',
    removeStreamConfirm: 'Are you sure you want to delete the stream?',
    yes: 'Yes',
    no: 'No',
    newStream: 'New stream',
    atLeastOneStream: 'At least one stream is required.',
    streamsUpdated: 'Streams updated.',
    streamsReverted: 'Previous stream configuration restored.',
    streamsReloaded: 'Streams reloaded from disk.',
    restartTitle: 'Restart server?',
    shutdownTitle: 'Shut down server?',
    shutdownServer: 'Shut down server',
    systemdRestartWarning: 'Are you sure you want to restart the server? Current listeners will disconnect. Make sure the systemd service is configured for automatic restart, such as Restart=on-failure or Restart=always.',
    consoleShutdownWarning: 'Are you sure you want to shut down the server? It is running directly from a console, so this will terminate the process and it must be started again manually.',
    unknownRestartWarning: 'Are you sure you want to restart the server? No systemd service was detected, so this may terminate the process and require it to be started again manually.',
    unsavedWarning: ' Unsaved stream edits will be discarded.',
    runtimeSystemd: 'Running under systemd. Automatic restart must be configured in the service.',
    runtimeConsole: 'Running from a console. Restarting will stop the process until it is started manually.',
    runtimeUnknown: 'No systemd service detected. Restarting may require a manual start.',
    serverShutdown: 'Server shut down. Start it manually to restore the Web Admin.',
    restartRequested: 'Restart requested. Waiting for the server...',
    statusChecking: 'Checking server status',
    statusOnline: 'Server online',
    statusRestarting: 'Server restarting',
    statusOffline: 'Server offline',
    requestFailed: 'Request failed ({status}).',
    logout: 'Logout',
  },
  es: {
    webAdmin: 'Administración web',
    loading: 'Cargando',
    language: 'Idioma',
    serverOverview: 'Resumen del servidor',
    activeUsers: 'Usuarios activos',
    configuredStreams: 'Streams configurados',
    uptime: 'Tiempo activo',
    configuration: 'Configuración',
    connectedUsers: 'Usuarios conectados',
    historyDescription: 'Clientes únicos durante las últimas 12 horas',
    historyAria: 'Historial de usuarios conectados',
    openUsersDetails: 'Abrir detalle de usuarios conectados',
    collectingHistory: 'Recopilando historial...',
    twelveHoursAgo: 'Hace 12 horas',
    now: 'Ahora',
    streams: 'Streams',
    streamsDescription: 'Los cambios se aplican en vivo y se guardan en streams.json.',
    addStream: '+ Agregar stream',
    routeName: 'Nombre de ruta',
    displayName: 'Nombre visible',
    udpHost: 'Host UDP',
    udpPort: 'Puerto UDP',
    sampleRate: 'Frecuencia de muestreo',
    channels: 'Canales',
    actions: 'Acciones',
    mono: 'Mono',
    stereo: 'Estéreo',
    noUnsavedChanges: 'No hay cambios sin guardar',
    unsavedChanges: 'Cambios sin guardar',
    labelOnlyChanges: 'Solo cambiaron nombres visibles. No es necesario recargar los streams.',
    structuralChanges: 'Se detectaron cambios estructurales. Los oyentes afectados serán notificados.',
    labelChangesApplied: 'Los nombres visibles se guardaron y actualizaron en vivo. No es necesario recargar.',
    structuralChangesApplied: 'Los cambios estructurales se guardaron. Recarga los streams para confirmar la configuración activa; los oyentes afectados fueron notificados.',
    discardChanges: 'Descartar cambios',
    revertConfiguration: 'Revertir configuración',
    applyChanges: 'Aplicar cambios',
    reloadStreams: 'Recargar streams',
    reloadTitle: '¿Recargar streams?',
    reloadNotRequiredWarning: 'No es necesario recargar ahora. Recargar streams puede interrumpir a los listeners activos si la configuración en disco contiene cambios estructurales.',
    serverProcess: 'Proceso del servidor',
    detectingRuntime: 'Detectando cómo se inició el servidor...',
    restartServer: 'Reiniciar servidor',
    cancel: 'Cancelar',
    removeStream: 'Eliminar stream',
    removeStreamConfirm: 'Estas seguro de borrar el stream?',
    yes: 'Sí',
    no: 'No',
    newStream: 'Nuevo stream',
    atLeastOneStream: 'Se requiere al menos un stream.',
    streamsUpdated: 'Streams actualizados.',
    streamsReverted: 'Configuración anterior de streams restaurada.',
    streamsReloaded: 'Streams recargados desde el disco.',
    restartTitle: '¿Reiniciar servidor?',
    shutdownTitle: '¿Apagar servidor?',
    shutdownServer: 'Apagar servidor',
    systemdRestartWarning: '¿Estás seguro de reiniciar el servidor? Los listeners actuales se desconectarán. Asegúrate de que el servicio systemd tenga reinicio automático, por ejemplo Restart=on-failure o Restart=always.',
    consoleShutdownWarning: '¿Estás seguro de apagar el servidor? Se está ejecutando directamente desde una consola, por lo que el proceso terminará y deberá iniciarse otra vez manualmente.',
    unknownRestartWarning: '¿Estás seguro de reiniciar el servidor? No se detectó un servicio systemd, por lo que el proceso puede terminar y requerir un inicio manual.',
    unsavedWarning: ' Los cambios de streams sin guardar se descartarán.',
    runtimeSystemd: 'Ejecutándose bajo systemd. El reinicio automático debe estar configurado en el servicio.',
    runtimeConsole: 'Ejecutándose desde una consola. Reiniciar detendrá el proceso hasta que se inicie manualmente.',
    runtimeUnknown: 'No se detectó un servicio systemd. Reiniciar puede requerir un inicio manual.',
    serverShutdown: 'Servidor apagado. Inícialo manualmente para restaurar la administración web.',
    restartRequested: 'Reinicio solicitado. Esperando al servidor...',
    statusChecking: 'Comprobando estado del servidor',
    statusOnline: 'Servidor en línea',
    statusRestarting: 'Servidor reiniciando',
    statusOffline: 'Servidor fuera de línea',
    requestFailed: 'La solicitud falló ({status}).',
    logout: 'Cerrar sesión',
  },
};

let dirty = false;
let refreshTimer = null;
let restartTimeout = null;
let runtimeMode = 'unknown';
let serverState = 'checking';
let stateRequestInFlight = false;
let operationBusy = false;
let lastUserHistory = [];
let savedStreams = [];
let softwareVersion = '';
let changeScope = 'none';
let postSaveNotice = null;
let reloadPending = false;
let previousAppliedStreams = null;
let pendingRemoveRow = null;
let csrfToken = '';
let language = localStorage.getItem(LANGUAGE_STORAGE_KEY);
if (!translations[language]) language = 'en';

form.addEventListener('input', markDirty);
form.addEventListener('submit', saveStreams);
discardButton.addEventListener('click', discardChanges);
revertButton.addEventListener('click', revertConfiguration);
addButton.addEventListener('click', () => {
  const row = appendRow({
    name: `stream-${rowsEl.children.length + 1}`,
    label: translate('newStream'),
    udpHost: '0.0.0.0',
    udpPort: nextPort(),
    sampleRate: 8000,
    channels: 1,
  }, { position: 'start' });
  row.querySelector('[name="name"]').focus();
  markDirty();
});
reloadButton.addEventListener('click', requestReload);
confirmReloadButton.addEventListener('click', reloadStreams);
confirmRemoveStreamButton.addEventListener('click', removePendingStream);
restartButton.addEventListener('click', openRestartDialog);
confirmRestartButton.addEventListener('click', requestRestart);
logoutButton.addEventListener('click', logout);
languageSelect.addEventListener('change', () => {
  language = languageSelect.value;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  applyLanguage();
});
window.addEventListener('resize', () => renderChart(lastUserHistory));

languageSelect.value = language;
applyLanguage();
bootstrap();

async function bootstrap() {
  try {
    const status = await request('/api/auth/status');
    if (!status.authenticated) {
      window.location.replace('/');
      return;
    }
    csrfToken = status.csrfToken || '';
    loadState(true);
  } catch {
    window.location.replace('/');
  }
}

async function logout() {
  try {
    await request('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.replace('/');
  }
}

async function loadState(renderStreams) {
  if (stateRequestInFlight) return false;
  stateRequestInFlight = true;
  clearTimeout(refreshTimer);
  try {
    const state = await request('/api/state');
    softwareVersion = state.version;
    versionEl.textContent = softwareVersion;
    document.getElementById('activeUsers').textContent = state.activeUsers;
    document.getElementById('streamCount').textContent = state.streams.length;
    document.getElementById('uptime').textContent = formatDuration(state.uptimeSeconds);
    document.getElementById('configPath').textContent = state.configPath;
    runtimeMode = state.runtimeMode || 'unknown';
    updateRuntimeSummary();
    setServerState('online');
    clearRestartTimeout();
    savedStreams = state.streams.map((stream) => ({ ...stream }));
    if (renderStreams && !dirty) {
      renderStreamsFrom(savedStreams);
    }
    updateDirtyState();
    lastUserHistory = state.userHistory || [];
    renderChart(lastUserHistory);
    scheduleStateRefresh(ONLINE_REFRESH_MS);
    return true;
  } catch (err) {
    if (serverState !== 'restarting') setServerState('offline');
    scheduleStateRefresh(RECOVERY_REFRESH_MS);
    return false;
  } finally {
    stateRequestInFlight = false;
  }
}

function scheduleStateRefresh(delay) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => loadState(false), delay);
}

function appendRow(stream, options = {}) {
  const row = rowTemplate.content.firstElementChild.cloneNode(true);
  for (const key of ['name', 'label', 'udpHost', 'udpPort', 'sampleRate', 'channels']) {
    const input = row.querySelector(`[name="${key}"]`);
    input.value = stream[key];
  }
  row.querySelector('.remove-stream').addEventListener('click', () => {
    if (rowsEl.children.length <= 1) {
      showMessage(translate('atLeastOneStream'), 'error');
      return;
    }
    pendingRemoveRow = row;
    removeStreamDialog.showModal();
  });
  applyTranslations(row);
  if (options.position === 'start') rowsEl.prepend(row);
  else rowsEl.appendChild(row);
  return row;
}

function removePendingStream(event) {
  event.preventDefault();
  removeStreamDialog.close();
  if (!pendingRemoveRow) return;
  pendingRemoveRow.remove();
  pendingRemoveRow = null;
  markDirty();
}

async function saveStreams(event) {
  event.preventDefault();
  clearMessage();
  if (!form.reportValidity()) return;

  const streams = collectFormStreams();
  await applyStreamConfiguration(streams, {
    previousStreams: savedStreams,
    successKey: null,
    updateRevert: true,
  });
}

async function applyStreamConfiguration(streams, { previousStreams, successKey, updateRevert }) {
  const appliedScope = classifyStreamChanges(streams, savedStreams);
  const revertCandidate = previousStreams.map((stream) => ({ ...stream }));

  setBusy(true);
  try {
    const result = await request('/api/streams', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-admin-request': '1',
      },
      body: JSON.stringify({ streams }),
    });
    dirty = false;
    changeScope = 'none';
    postSaveNotice = successKey || (appliedScope === 'none'
      ? 'streamsUpdated'
      : appliedScope === 'label'
        ? 'labelChangesApplied'
        : 'structuralChangesApplied');
    reloadPending = appliedScope === 'structural';
    reloadButton.classList.toggle('reload-pending', reloadPending);
    previousAppliedStreams = updateRevert ? revertCandidate : null;
    updateDirtyState();
    showMessage(translate(postSaveNotice || 'streamsUpdated'), 'success');
    await loadState(true);
  } catch (err) {
    showMessage(err.message, 'error');
  } finally {
    setBusy(false);
  }
}

async function revertConfiguration() {
  if (!previousAppliedStreams || !previousAppliedStreams.length) return;
  clearMessage();
  await applyStreamConfiguration(previousAppliedStreams, {
    previousStreams: savedStreams,
    successKey: 'streamsReverted',
    updateRevert: false,
  });
}

async function reloadStreams() {
  if (reloadDialog.open) reloadDialog.close();
  clearMessage();
  setBusy(true);
  try {
    const result = await request('/api/streams/reload', {
      method: 'POST',
      headers: { 'x-admin-request': '1' },
    });
    dirty = false;
    changeScope = 'none';
    postSaveNotice = null;
    reloadPending = false;
    previousAppliedStreams = null;
    updateDirtyState();
    reloadButton.classList.remove('reload-pending');
    showMessage(translate('streamsReloaded'), 'success');
    await loadState(true);
  } catch (err) {
    showMessage(err.message, 'error');
  } finally {
    setBusy(false);
  }
}

function requestReload() {
  if (reloadPending) {
    reloadStreams();
    return;
  }
  reloadDialog.showModal();
}

function openRestartDialog() {
  updateRestartDialogText();
  restartDialog.showModal();
}

function updateRestartDialogText() {
  const unsavedWarning = dirty ? translate('unsavedWarning') : '';
  if (runtimeMode === 'systemd') {
    restartDialogTitle.textContent = translate('restartTitle');
    confirmRestartButton.textContent = translate('restartServer');
    restartWarning.textContent = `${translate('systemdRestartWarning')}${unsavedWarning}`;
  } else if (runtimeMode === 'console') {
    restartDialogTitle.textContent = translate('shutdownTitle');
    confirmRestartButton.textContent = translate('shutdownServer');
    restartWarning.textContent = `${translate('consoleShutdownWarning')}${unsavedWarning}`;
  } else {
    restartDialogTitle.textContent = translate('restartTitle');
    confirmRestartButton.textContent = translate('restartServer');
    restartWarning.textContent = `${translate('unknownRestartWarning')}${unsavedWarning}`;
  }
}

function updateRuntimeSummary() {
  const summary = document.getElementById('runtimeSummary');
  if (runtimeMode === 'systemd') {
    summary.textContent = translate('runtimeSystemd');
  } else if (runtimeMode === 'console') {
    summary.textContent = translate('runtimeConsole');
  } else {
    summary.textContent = translate('runtimeUnknown');
  }
}

async function requestRestart(event) {
  event.preventDefault();
  restartDialog.close();
  setBusy(true);
  const requestedRuntimeMode = runtimeMode;
  if (requestedRuntimeMode === 'console') {
    setServerState('offline');
  } else {
    setServerState('restarting');
    armRestartTimeout();
  }
  try {
    await request('/api/restart', {
      method: 'POST',
      headers: { 'x-admin-request': '1' },
    });
    if (requestedRuntimeMode === 'console') {
      showMessage(translate('serverShutdown'), 'success');
    } else {
      showMessage(translate('restartRequested'), 'success');
    }
  } catch (err) {
    showMessage(err.message, 'error');
    if (requestedRuntimeMode !== 'console') setServerState('offline');
  } finally {
    setBusy(false);
    scheduleStateRefresh(RECOVERY_REFRESH_MS);
  }
}

function armRestartTimeout() {
  clearRestartTimeout();
  restartTimeout = setTimeout(() => {
    if (serverState === 'restarting') setServerState('offline');
  }, RESTART_TIMEOUT_MS);
}

function clearRestartTimeout() {
  clearTimeout(restartTimeout);
  restartTimeout = null;
}

function setServerState(nextState) {
  serverState = nextState;
  const labels = {
    checking: translate('statusChecking'),
    online: translate('statusOnline'),
    restarting: translate('statusRestarting'),
    offline: translate('statusOffline'),
  };
  serverStatusEl.className = `status-dot ${nextState}`;
  serverStatusEl.setAttribute('aria-label', labels[nextState]);
  serverStatusEl.title = labels[nextState];
  updateControls();
}

async function request(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (!['GET', 'HEAD'].includes(method) && csrfToken) headers['x-csrf-token'] = csrfToken;
  const response = await fetch(url, {
    ...options,
    cache: 'no-store',
    credentials: 'same-origin',
    headers,
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (response.status === 401) {
    window.location.replace('/');
    throw new Error('Authentication required.');
  }
  if (!response.ok) throw new Error(body.error || translate('requestFailed', { status: response.status }));
  return body;
}

function markDirty() {
  changeScope = classifyStreamChanges(collectFormStreams(), savedStreams);
  dirty = changeScope !== 'none';
  if (dirty) postSaveNotice = null;
  updateDirtyState();
}

function discardChanges() {
  renderStreamsFrom(savedStreams);
  dirty = false;
  changeScope = 'none';
  postSaveNotice = null;
  updateDirtyState();
  clearMessage();
}

function renderStreamsFrom(streams) {
  rowsEl.replaceChildren();
  streams.forEach(appendRow);
  changeScope = classifyStreamChanges(collectFormStreams(), savedStreams);
  dirty = changeScope !== 'none';
  updateDirtyState();
}

function updateDirtyState() {
  let key = 'noUnsavedChanges';
  if (dirty) {
    key = changeScope === 'label' ? 'labelOnlyChanges' : 'structuralChanges';
  } else if (reloadPending) {
    key = 'structuralChangesApplied';
  } else if (postSaveNotice) {
    key = postSaveNotice;
  }
  dirtyStateEl.textContent = translate(key);
  updateControls();
}

function setBusy(value) {
  operationBusy = value;
  updateControls();
}

function updateControls() {
  const unavailable = operationBusy || serverState !== 'online';
  saveButton.disabled = unavailable || !dirty;
  discardButton.disabled = unavailable || !dirty;
  revertButton.hidden = !previousAppliedStreams;
  revertButton.disabled = unavailable || !previousAppliedStreams;
  addButton.disabled = unavailable;
  reloadButton.disabled = unavailable;
  restartButton.disabled = unavailable;
}

function collectFormStreams() {
  return Array.from(rowsEl.querySelectorAll('tr')).map((row) => ({
    name: row.querySelector('[name="name"]').value.trim(),
    label: row.querySelector('[name="label"]').value.trim(),
    udpHost: row.querySelector('[name="udpHost"]').value.trim(),
    udpPort: Number(row.querySelector('[name="udpPort"]').value),
    sampleRate: Number(row.querySelector('[name="sampleRate"]').value),
    channels: Number(row.querySelector('[name="channels"]').value),
  }));
}

function streamsEqual(left, right) {
  const a = left.map(normalizeStreamForCompare);
  const b = right.map(normalizeStreamForCompare);
  return JSON.stringify(a) === JSON.stringify(b);
}

function classifyStreamChanges(currentStreams, savedStreamList) {
  const current = currentStreams.map(normalizeStreamForCompare);
  const saved = savedStreamList.map(normalizeStreamForCompare);
  if (JSON.stringify(current) === JSON.stringify(saved)) return 'none';
  if (JSON.stringify(current.map(withoutDisplayLabel)) === JSON.stringify(saved.map(withoutDisplayLabel))) {
    return 'label';
  }
  return 'structural';
}

function withoutDisplayLabel(stream) {
  return {
    name: stream.name,
    udpHost: stream.udpHost,
    udpPort: stream.udpPort,
    sampleRate: stream.sampleRate,
    channels: stream.channels,
  };
}

function normalizeStreamForCompare(stream) {
  return {
    name: String(stream.name || '').trim(),
    label: String(stream.label || '').trim(),
    udpHost: String(stream.udpHost || '').trim(),
    udpPort: Number(stream.udpPort),
    sampleRate: Number(stream.sampleRate),
    channels: Number(stream.channels),
  };
}

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `message visible ${type}`;
}

function clearMessage() {
  messageEl.textContent = '';
  messageEl.className = 'message';
}

function applyLanguage() {
  document.documentElement.lang = language;
  languageSelect.value = language;
  languageSelect.setAttribute('aria-label', translate('language'));
  if (!softwareVersion) versionEl.textContent = translate('loading');
  applyTranslations(document);
  updateDirtyState();
  updateRuntimeSummary();
  setServerState(serverState);
  renderChart(lastUserHistory);
  if (restartDialog.open) updateRestartDialogText();
}

function applyTranslations(root) {
  root.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = translate(element.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((element) => {
    element.setAttribute('aria-label', translate(element.dataset.i18nAria));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.title = translate(element.dataset.i18nTitle);
  });
  root.querySelectorAll('[data-i18n-label]').forEach((element) => {
    element.dataset.label = translate(element.dataset.i18nLabel);
  });
}

function translate(key, replacements = {}) {
  let value = translations[language][key] || translations.en[key] || key;
  for (const [name, replacement] of Object.entries(replacements)) {
    value = value.replace(`{${name}}`, String(replacement));
  }
  return value;
}

function nextPort() {
  const ports = Array.from(rowsEl.querySelectorAll('[name="udpPort"]')).map((input) => Number(input.value) || 8685);
  return Math.min(65535, Math.max(8685, ...ports) + 1);
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function renderChart(points) {
  const context = chart.getContext('2d');
  const rect = chart.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  chart.width = Math.max(1, Math.floor(rect.width * ratio));
  chart.height = Math.max(1, Math.floor(rect.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  chartEmpty.hidden = points.length > 0;
  const peak = points.reduce((max, point) => Math.max(max, point.count), 0);

  const padding = { top: 12, right: 12, bottom: 12, left: 32 };
  const width = Math.max(1, rect.width - padding.left - padding.right);
  const height = Math.max(1, rect.height - padding.top - padding.bottom);
  const end = Date.now();
  const start = end - HISTORY_WINDOW_MS;
  const maxValue = Math.max(3, Math.ceil(peak));

  context.strokeStyle = '#2d3742';
  context.fillStyle = '#8e9cab';
  context.font = '11px system-ui';
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (const value of integerAxisValues(maxValue)) {
    const y = padding.top + height - (value / maxValue) * height;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(padding.left + width, y);
    context.stroke();
    context.fillText(String(value), padding.left - 7, y);
  }

  if (!points.length) return;

  const chartPoints = points.map((point) => ({
    x: padding.left + Math.max(0, Math.min(1, (point.at - start) / (end - start))) * width,
    y: padding.top + height - (point.count / maxValue) * height,
  }));

  const gradient = context.createLinearGradient(0, padding.top, 0, padding.top + height);
  gradient.addColorStop(0, 'rgba(79, 180, 119, 0.35)');
  gradient.addColorStop(1, 'rgba(79, 180, 119, 0.02)');
  context.beginPath();
  context.moveTo(chartPoints[0].x, padding.top + height);
  chartPoints.forEach((point) => context.lineTo(point.x, point.y));
  context.lineTo(chartPoints[chartPoints.length - 1].x, padding.top + height);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();

  context.beginPath();
  chartPoints.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.strokeStyle = '#4fb477';
  context.lineWidth = 2;
  context.lineJoin = 'round';
  context.stroke();
}

function integerAxisValues(maxValue) {
  if (maxValue <= 6) {
    return Array.from({ length: maxValue + 1 }, (_, index) => maxValue - index);
  }
  const step = Math.max(1, Math.ceil(maxValue / 4));
  const values = [];
  for (let value = maxValue; value > 0; value -= step) values.push(value);
  if (!values.includes(0)) values.push(0);
  return values;
}
