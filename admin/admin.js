'use strict';

const form = document.getElementById('streamsForm');
const rowsEl = document.getElementById('streamRows');
const rowTemplate = document.getElementById('streamRowTemplate');
const sectionsEl = document.getElementById('sectionRows');
const sectionTemplate = document.getElementById('sectionRowTemplate');
const addButton = document.getElementById('addStream');
const addSectionButton = document.getElementById('addSection');
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
    openGeo: 'Open listener geography map',
    geo: 'Geo',
    twelveHoursAgo: '12 hours ago',
    now: 'Now',
    streams: 'Streams',
    streamsDescription: 'Stream settings are saved to streams.json; order and sections are saved in the database.',
    sections: 'Receiver sections',
    sectionsDescription: 'Group streams on the public list.',
    addSection: '+ Add section',
    sectionName: 'Section name',
    section: 'Section',
    noSection: 'No section',
    order: 'Order',
    dragToReorder: 'Drag to reorder',
    moveSectionUp: 'Move section up',
    moveSectionDown: 'Move section down',
    removeSection: 'Remove section',
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
    layoutOnlyChanges: 'Only order or grouping changed. No stream reload is needed.',
    layoutChangesApplied: 'Stream order and sections were saved. No stream reload was needed.',
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
    openGeo: 'Abrir mapa geográfico de oyentes',
    geo: 'Geo',
    twelveHoursAgo: 'Hace 12 horas',
    now: 'Ahora',
    streams: 'Streams',
    streamsDescription: 'La configuración se guarda en streams.json; el orden y las secciones se guardan en la base de datos.',
    sections: 'Secciones de receptores',
    sectionsDescription: 'Agrupa los streams en la página pública.',
    addSection: '+ Agregar sección',
    sectionName: 'Nombre de la sección',
    section: 'Sección',
    noSection: 'Sin sección',
    order: 'Orden',
    dragToReorder: 'Arrastrar para reordenar',
    moveSectionUp: 'Subir sección',
    moveSectionDown: 'Bajar sección',
    removeSection: 'Eliminar sección',
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
    layoutOnlyChanges: 'Solo cambió el orden o la agrupación. No es necesario recargar los streams.',
    layoutChangesApplied: 'Se guardaron el orden y las secciones. No fue necesario recargar los streams.',
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
let savedSections = [];
let softwareVersion = '';
let changeScope = 'none';
let postSaveNotice = null;
let reloadPending = false;
let previousAppliedConfiguration = null;
let pendingRemoveRow = null;
let draggingRow = null;
let sectionIdSequence = 0;
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
  });
  row.querySelector('[name="name"]').focus();
  markDirty();
});
addSectionButton.addEventListener('click', () => {
  const row = appendSection({ id: createSectionId(), name: '' });
  refreshSectionOptions();
  row.querySelector('[name="sectionName"]').focus();
  markDirty();
});
rowsEl.addEventListener('dragstart', handleStreamDragStart);
rowsEl.addEventListener('dragover', handleStreamDragOver);
rowsEl.addEventListener('drop', (event) => {
  if (!draggingRow) return;
  event.preventDefault();
});
rowsEl.addEventListener('dragend', handleStreamDragEnd);
sectionsEl.addEventListener('click', handleSectionAction);
sectionsEl.addEventListener('input', (event) => {
  if (event.target.matches('[name="sectionName"]')) refreshSectionOptions();
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
    savedSections = (state.sections || []).map((section) => ({ ...section }));
    if (renderStreams && !dirty) {
      renderStreamsFrom(savedStreams, savedSections);
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
  const sectionSelect = row.querySelector('[name="sectionId"]');
  sectionSelect.append(new Option(translate('noSection'), ''));
  for (const section of collectFormSections()) {
    sectionSelect.append(new Option(section.name, section.id));
  }
  sectionSelect.value = stream.sectionId || '';
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

function createSectionId() {
  sectionIdSequence += 1;
  return `section-${Date.now().toString(36)}-${sectionIdSequence.toString(36)}`;
}

function appendSection(section) {
  const row = sectionTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.sectionId = section.id || createSectionId();
  row.querySelector('[name="sectionName"]').value = section.name || '';
  applyTranslations(row);
  sectionsEl.appendChild(row);
  updateSectionOrderControls();
  return row;
}

function renderSections(sections) {
  sectionsEl.replaceChildren();
  sections.forEach(appendSection);
  refreshSectionOptions();
}

function collectFormSections() {
  return Array.from(sectionsEl.children).map((row) => ({
    id: row.dataset.sectionId,
    name: row.querySelector('[name="sectionName"]').value.trim(),
  }));
}

function refreshSectionOptions() {
  const sections = collectFormSections();
  for (const select of rowsEl.querySelectorAll('[name="sectionId"]')) {
    const selected = select.value;
    select.replaceChildren(new Option(translate('noSection'), ''));
    for (const section of sections) select.append(new Option(section.name, section.id));
    select.value = sections.some((section) => section.id === selected) ? selected : '';
  }
}

function handleSectionAction(event) {
  const button = event.target.closest('button');
  const row = button && button.closest('.managed-section');
  if (!row) return;
  const direction = Number(button.dataset.moveSection);
  if (Number.isInteger(direction) && direction) {
    const sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    sectionsEl.insertBefore(direction < 0 ? row : sibling, direction < 0 ? sibling : row);
    updateSectionOrderControls();
    markDirty();
    return;
  }
  if (button.classList.contains('remove-section')) {
    const removedId = row.dataset.sectionId;
    for (const select of rowsEl.querySelectorAll('[name="sectionId"]')) {
      if (select.value === removedId) select.value = '';
    }
    row.remove();
    refreshSectionOptions();
    updateSectionOrderControls();
    markDirty();
  }
}

function updateSectionOrderControls() {
  const rows = Array.from(sectionsEl.children);
  rows.forEach((row, index) => {
    row.querySelector('[data-move-section="-1"]').disabled = index === 0;
    row.querySelector('[data-move-section="1"]').disabled = index === rows.length - 1;
  });
}

function handleStreamDragStart(event) {
  if (!event.target.closest('.drag-handle')) {
    event.preventDefault();
    return;
  }
  draggingRow = event.target.closest('tr');
  draggingRow.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggingRow.querySelector('[name="name"]').value);
}

function handleStreamDragOver(event) {
  if (!draggingRow) return;
  const targetRow = event.target.closest('tr');
  if (!targetRow || targetRow === draggingRow) return;
  event.preventDefault();
  const afterTarget = event.clientY > targetRow.getBoundingClientRect().top + targetRow.offsetHeight / 2;
  rowsEl.insertBefore(draggingRow, afterTarget ? targetRow.nextElementSibling : targetRow);
}

function handleStreamDragEnd() {
  if (!draggingRow) return;
  draggingRow.classList.remove('dragging');
  draggingRow = null;
  markDirty();
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
  await applyStreamConfiguration({ streams, sections: collectFormSections() }, {
    previousStreams: savedStreams,
    previousSections: savedSections,
    successKey: null,
    updateRevert: true,
  });
}

async function applyStreamConfiguration(configuration, { previousStreams, previousSections, successKey, updateRevert }) {
  const { streams, sections } = configuration;
  const appliedScope = classifyStreamChanges(streams, savedStreams);
  const revertCandidate = {
    streams: previousStreams.map((stream) => ({ ...stream })),
    sections: previousSections.map((section) => ({ ...section })),
  };

  setBusy(true);
  try {
    const result = await request('/api/streams', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-admin-request': '1',
      },
      body: JSON.stringify({ streams, sections }),
    });
    dirty = false;
    changeScope = 'none';
    postSaveNotice = successKey || (appliedScope === 'none'
      ? 'layoutChangesApplied'
      : appliedScope === 'label'
        ? 'labelChangesApplied'
        : 'structuralChangesApplied');
    reloadPending = appliedScope === 'structural';
    reloadButton.classList.toggle('reload-pending', reloadPending);
    previousAppliedConfiguration = updateRevert ? revertCandidate : null;
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
  if (!previousAppliedConfiguration) return;
  clearMessage();
  await applyStreamConfiguration(previousAppliedConfiguration, {
    previousStreams: savedStreams,
    previousSections: savedSections,
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
    previousAppliedConfiguration = null;
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
  dirty = changeScope !== 'none'
    || !streamLayoutEqual(collectFormStreams(), savedStreams)
    || !sectionsEqual(collectFormSections(), savedSections);
  if (dirty) postSaveNotice = null;
  updateDirtyState();
}

function discardChanges() {
  renderStreamsFrom(savedStreams, savedSections);
  dirty = false;
  changeScope = 'none';
  postSaveNotice = null;
  updateDirtyState();
  clearMessage();
}

function renderStreamsFrom(streams, sections = savedSections) {
  renderSections(sections);
  rowsEl.replaceChildren();
  streams.forEach(appendRow);
  changeScope = classifyStreamChanges(collectFormStreams(), savedStreams);
  dirty = changeScope !== 'none'
    || !streamLayoutEqual(collectFormStreams(), savedStreams)
    || !sectionsEqual(collectFormSections(), savedSections);
  updateDirtyState();
}

function updateDirtyState() {
  let key = 'noUnsavedChanges';
  if (dirty) {
    key = changeScope === 'label'
      ? 'labelOnlyChanges'
      : changeScope === 'structural' ? 'structuralChanges' : 'layoutOnlyChanges';
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
  revertButton.hidden = !previousAppliedConfiguration;
  revertButton.disabled = unavailable || !previousAppliedConfiguration;
  addButton.disabled = unavailable;
  addSectionButton.disabled = unavailable;
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
    sectionId: row.querySelector('[name="sectionId"]').value,
  }));
}

function streamLayoutEqual(left, right) {
  const a = left.map((stream) => ({ name: stream.name, sectionId: stream.sectionId || '' }));
  const b = right.map((stream) => ({ name: stream.name, sectionId: stream.sectionId || '' }));
  return JSON.stringify(a) === JSON.stringify(b);
}

function sectionsEqual(left, right) {
  return JSON.stringify(left.map((section) => ({ id: section.id, name: section.name.trim() })))
    === JSON.stringify(right.map((section) => ({ id: section.id, name: section.name.trim() })));
}

function classifyStreamChanges(currentStreams, savedStreamList) {
  if (currentStreams.length !== savedStreamList.length) return 'structural';
  const savedByName = new Map(savedStreamList.map((stream) => [String(stream.name || '').trim(), normalizeStreamForCompare(stream)]));
  let labelsChanged = false;
  for (const stream of currentStreams) {
    const current = normalizeStreamForCompare(stream);
    const saved = savedByName.get(current.name);
    if (!saved || !sameStreamTransport(current, saved)) return 'structural';
    if (current.label !== saved.label) labelsChanged = true;
  }
  return labelsChanged ? 'label' : 'none';
}

function sameStreamTransport(left, right) {
  return left.name === right.name
    && left.udpHost === right.udpHost
    && left.udpPort === right.udpPort
    && left.sampleRate === right.sampleRate
    && left.channels === right.channels;
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
  refreshSectionOptions();
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
