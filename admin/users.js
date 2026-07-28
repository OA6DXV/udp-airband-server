'use strict';

const LANGUAGE_STORAGE_KEY = 'udp-airband-language';
const translations = {
  en: {
    webAdmin: 'Web Admin',
    backToAdmin: '< Back',
    listenerGeography: 'Listener Geography',
    listeners: 'Listeners',
    loadingMap: 'Loading map...',
    noGeoData: 'No public listener locations have been collected yet.',
    mapUnavailable: 'Google GeoChart could not be loaded.',
    requestFailed: 'Could not load listener geography.',
    mapAria: 'Listener geography map',
    selectedCountry: 'Selected country',
    noCityData: 'No city data available',
    language: 'Language',
    serverOnline: 'Server online',
    serverOffline: 'Server offline',
  },
  es: {
    webAdmin: 'Administración web',
    backToAdmin: '< Volver',
    listenerGeography: 'Geografía de oyentes',
    listeners: 'Oyentes',
    loadingMap: 'Cargando mapa...',
    noGeoData: 'Todavía no se recopilaron ubicaciones públicas de oyentes.',
    mapUnavailable: 'No se pudo cargar Google GeoChart.',
    requestFailed: 'No se pudo cargar la geografía de oyentes.',
    mapAria: 'Mapa geográfico de oyentes',
    selectedCountry: 'País seleccionado',
    noCityData: 'No hay datos de ciudad disponibles',
    language: 'Idioma',
    serverOnline: 'Servidor en línea',
    serverOffline: 'Servidor fuera de línea',
  },
};

const languageSelect = document.getElementById('languageSelect');
const geoMessage = document.getElementById('geoMessage');
const geoChartElement = document.getElementById('geoChart');
const geoLayout = document.getElementById('geoLayout');
const statusDot = document.querySelector('.status-dot');
const countryDetail = document.getElementById('countryDetail');
let language = localStorage.getItem(LANGUAGE_STORAGE_KEY);
let geoStats = { countries: [], totalListeners: 0 };
let chart = null;
let messageKey = 'loadingMap';
let selectedCode = '';
let resizeTimer = null;
let layoutRedrawTimer = null;

if (!translations[language]) language = 'en';
languageSelect.value = language;
applyLanguage();

languageSelect.addEventListener('change', () => {
  language = languageSelect.value;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  applyLanguage();
  drawChart();
});

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawChart, 120);
});

loadGeoStats();

async function loadGeoStats() {
  try {
    const response = await fetch('/api/users/geo', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    geoStats = await response.json();
    setServerOnline(true);
    if (!Array.isArray(geoStats.countries)) geoStats.countries = [];
    waitForGoogleCharts();
  } catch {
    setServerOnline(false);
    showMessage('requestFailed', true);
  }
}

function waitForGoogleCharts() {
  if (!window.google || !google.charts) {
    showMessage('mapUnavailable', true);
    return;
  }
  google.charts.load('current', { packages: ['geochart'] });
  google.charts.setOnLoadCallback(drawChart);
}

function drawChart() {
  if (!window.google || !google.visualization) return;

  const data = new google.visualization.DataTable();
  data.addColumn('string', 'Country');
  data.addColumn('number', translate('listeners'));
  data.addColumn({ type: 'string', role: 'tooltip', p: { html: true } });
  data.addRows(geoStats.countries.map((country) => [
    country.code,
    country.listeners,
    buildTooltip(country),
  ]));

  chart = new google.visualization.GeoChart(geoChartElement);
  google.visualization.events.addListener(chart, 'select', handleSelection);
  chart.draw(data, {
    backgroundColor: '#181d24',
    colorAxis: {
      minValue: 0,
      colors: ['#173426', '#4fb477', '#9ce1b6'],
    },
    datalessRegionColor: '#29323c',
    defaultColor: '#4fb477',
    displayMode: 'regions',
    legend: 'none',
    tooltip: {
      isHtml: true,
      trigger: 'focus',
      textStyle: { color: '#edf1f5' },
    },
  });
  if (geoStats.countries.length) {
    hideMessage();
  } else {
    showMessage('noGeoData');
  }
  renderSelectedCountry();
}

function handleSelection() {
  const selection = chart.getSelection();
  if (!selection.length || selection[0].row === null) return;
  selectedCode = geoStats.countries[selection[0].row].code;
  renderSelectedCountry();
}

function renderSelectedCountry() {
  if (!selectedCode) {
    countryDetail.hidden = true;
    geoLayout.classList.remove('detail-visible');
    return;
  }
  const country = geoStats.countries.find((entry) => entry.code === selectedCode);
  if (!country) return;

  document.getElementById('countryName').textContent = country.country;
  document.getElementById('countryListeners').textContent = String(country.listeners);
  const cityList = document.getElementById('cityList');
  cityList.replaceChildren();
  if (!country.topCities.length) {
    const empty = document.createElement('p');
    empty.className = 'city-empty';
    empty.textContent = translate('noCityData');
    cityList.appendChild(empty);
  } else {
    country.topCities.forEach((city) => {
      const row = document.createElement('div');
      const name = document.createElement('span');
      const count = document.createElement('strong');
      name.textContent = city.city;
      count.textContent = String(city.listeners);
      row.append(name, count);
      cityList.appendChild(row);
    });
  }
  const layoutChanged = !geoLayout.classList.contains('detail-visible');
  countryDetail.hidden = false;
  geoLayout.classList.add('detail-visible');
  if (layoutChanged) scheduleLayoutRedraw();
}

function scheduleLayoutRedraw() {
  clearTimeout(layoutRedrawTimer);
  layoutRedrawTimer = setTimeout(() => {
    if (chart) drawChart();
  }, 50);
}

function buildTooltip(country) {
  const lines = [
    `<strong>${escapeHtml(translate('listeners'))}: ${country.listeners}</strong>`,
    ...country.topCities.map((city) => `${escapeHtml(city.city)}: ${city.listeners}`),
  ];
  return `<div class="geo-tooltip">${lines.join('')}</div>`;
}

function applyLanguage() {
  document.documentElement.lang = language;
  languageSelect.value = language;
  languageSelect.setAttribute('aria-label', translate('language'));
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = translate(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((element) => {
    element.setAttribute('aria-label', translate(element.dataset.i18nAria));
  });
  setServerOnline(statusDot.classList.contains('online'));
  if (geoMessage.classList.contains('visible')) geoMessage.textContent = translate(messageKey);
  renderSelectedCountry();
}

function setServerOnline(online) {
  statusDot.classList.toggle('online', online);
  statusDot.classList.toggle('offline', !online);
  const text = translate(online ? 'serverOnline' : 'serverOffline');
  statusDot.setAttribute('aria-label', text);
  statusDot.title = text;
}

function showMessage(key, error = false) {
  messageKey = key;
  geoMessage.textContent = translate(key);
  geoMessage.classList.add('visible');
  geoMessage.classList.toggle('error', error);
}

function hideMessage() {
  geoMessage.classList.remove('visible', 'error');
}

function translate(key) {
  return translations[language][key] || translations.en[key] || key;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
