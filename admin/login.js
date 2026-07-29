'use strict';

if (!globalThis.$altcha) throw new Error('ALTCHA failed to initialize.');
globalThis.$altcha.algorithms.set('PBKDF2/SHA-256', () => new Worker('/altcha-pbkdf2.js'));

const form = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const challengeContainer = document.getElementById('challengeContainer');
const widget = document.getElementById('altchaWidget');
const message = document.getElementById('loginMessage');
const submitButton = document.getElementById('loginButton');
const languageSelect = document.getElementById('languageSelect');
const LANGUAGE_STORAGE_KEY = 'udp-airband-language';
const translations = {
  en: {
    language: 'Language',
    pageTitle: 'UDP Airband Admin Login',
    webAdmin: 'Web Admin',
    username: 'Username',
    password: 'Password',
    signIn: 'Sign in',
    signingIn: 'Signing in...',
    setupRequired: 'No administrator account exists yet. Run npm run admin:setup on the server.',
    serviceUnavailable: 'The authentication service is unavailable.',
    reloadPage: 'Reload this page before trying again.',
    enterCredentials: 'Enter username and password.',
    completeVerification: 'Complete the verification before signing in.',
    tooManyAttempts: 'Too many attempts. Try again in {seconds} seconds.',
    newVerificationRequired: 'Complete a new verification before trying again.',
    requestNotVerified: 'The request could not be verified. Reload the page.',
    invalidLogin: 'Invalid username, password, or verification.',
    requestFailed: 'The login request failed.',
  },
  es: {
    language: 'Idioma',
    pageTitle: 'Inicio de sesión - UDP Airband Admin',
    webAdmin: 'Administración web',
    username: 'Usuario',
    password: 'Contraseña',
    signIn: 'Iniciar sesión',
    signingIn: 'Iniciando sesión...',
    setupRequired: 'Todavía no existe una cuenta administradora. Ejecuta npm run admin:setup en el servidor.',
    serviceUnavailable: 'El servicio de autenticación no está disponible.',
    reloadPage: 'Recarga esta página antes de intentarlo nuevamente.',
    enterCredentials: 'Ingresa usuario y contraseña.',
    completeVerification: 'Completa la verificación antes de iniciar sesión.',
    tooManyAttempts: 'Demasiados intentos. Intenta nuevamente en {seconds} segundos.',
    newVerificationRequired: 'Completa una nueva verificación antes de intentarlo nuevamente.',
    requestNotVerified: 'La solicitud no pudo ser verificada. Recarga la página.',
    invalidLogin: 'Usuario, contraseña o verificación inválidos.',
    requestFailed: 'La solicitud de inicio de sesión falló.',
  },
};
let language = localStorage.getItem(LANGUAGE_STORAGE_KEY) || 'en';
if (!translations[language]) language = 'en';
let loginCsrfToken = '';
let challengeRequired = false;
let challengeConfiguredFor = '';
let verifiedAltchaPayload = '';

languageSelect.value = language;
languageSelect.addEventListener('change', async () => {
  language = languageSelect.value;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  applyTranslations();
  if (challengeRequired) await configureChallengeWidget({ reset: true });
});

widget.addEventListener('verified', (event) => {
  verifiedAltchaPayload = event.detail && event.detail.payload || getWidgetPayload();
});
widget.addEventListener('statechange', (event) => {
  const state = event.detail && event.detail.state;
  if (state !== 'verified') verifiedAltchaPayload = '';
});

initialize();

async function initialize() {
  applyTranslations();
  try {
    const response = await fetch('/api/auth/status', { cache: 'no-store', credentials: 'same-origin' });
    const body = await response.json();
    if (body.authenticated) {
      window.location.replace('/');
      return;
    }
    loginCsrfToken = body.loginCsrfToken || '';
    if (body.setupRequired) {
      showMessage('setupRequired');
    }
  } catch {
    showMessage('serviceUnavailable');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!loginCsrfToken) {
    showMessage('reloadPage');
    return;
  }
  if (!usernameInput.value.trim() || !passwordInput.value) {
    showMessage('enterCredentials');
    return;
  }
  setBusy(true);
  showMessage('');
  let altchaPayload = '';
  try {
    if (challengeRequired) {
      altchaPayload = await resolveAltchaPayload();
      if (!altchaPayload && challengeRequired) throw new Error(t('completeVerification'));
    }

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': loginCsrfToken,
      },
      body: JSON.stringify({
        username: usernameInput.value,
        password: passwordInput.value,
        altcha: altchaPayload,
      }),
    });
    const body = await response.json().catch(() => ({}));
    resetChallengePayload();
    passwordInput.value = '';
    if (response.ok) {
      window.location.replace('/');
      return;
    }
    challengeRequired = Boolean(body.challengeRequired);
    await updateChallengeVisibility();
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after') || body.retryAfter || 1);
      showMessage('tooManyAttempts', { seconds: retryAfter });
    } else if (response.status === 403 || response.status === 409) {
      showMessage(challengeRequired
        ? 'newVerificationRequired'
        : 'requestNotVerified');
    } else {
      showMessage('invalidLogin');
    }
  } catch (err) {
    resetChallengePayload();
    challengeConfiguredFor = '';
    if (challengeRequired) await updateChallengeVisibility();
    showMessage(err.message || t('requestFailed'), {}, { literal: true });
  } finally {
    setBusy(false);
    passwordInput.focus();
  }
});

async function updateChallengeVisibility() {
  challengeContainer.hidden = !challengeRequired;
  if (challengeRequired) {
    await configureChallengeWidget({ reset: true });
  } else {
    resetChallengePayload();
    widget.removeAttribute('challenge');
    challengeConfiguredFor = '';
  }
}

async function resolveAltchaPayload() {
  const existingPayload = verifiedAltchaPayload || getWidgetPayload();
  if (existingPayload) return existingPayload;

  await configureChallengeWidget();
  return '';
}

async function configureChallengeWidget(options = {}) {
  const username = usernameInput.value.trim();
  const challengeUrl = `/api/auth/challenge?username=${encodeURIComponent(username)}&t=${Date.now()}`;
  if (options.reset || challengeConfiguredFor !== username) {
    resetChallengePayload();
    challengeConfiguredFor = username;
  }
  widget.setAttribute('challenge', challengeUrl);
  await widget.configure({
    challenge: challengeUrl,
    credentials: 'same-origin',
    fetch: challengeFetch,
    humanInteractionSignature: false,
    language: document.documentElement.lang || 'en',
  });
}

async function challengeFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      ...(options.headers || {}),
      'x-csrf-token': loginCsrfToken,
    },
  });
  return response;
}

function getWidgetPayload() {
  const input = widget.querySelector('input[name="altcha"]');
  return input && input.value || '';
}

function resetChallengePayload() {
  verifiedAltchaPayload = '';
  widget.reset();
}

function setBusy(busy) {
  submitButton.disabled = busy;
  usernameInput.disabled = busy;
  passwordInput.disabled = busy;
  languageSelect.disabled = busy;
  submitButton.textContent = busy ? t('signingIn') : t('signIn');
}

function showMessage(key, replacements = {}, options = {}) {
  message.dataset.messageKey = options.literal ? '' : key;
  message.dataset.messageReplacements = options.literal ? '' : JSON.stringify(replacements);
  message.textContent = options.literal ? key : t(key, replacements);
}

function applyTranslations() {
  document.documentElement.lang = language;
  document.title = t('pageTitle');
  languageSelect.value = language;
  languageSelect.setAttribute('aria-label', t('language'));
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  if (message.dataset.messageKey) {
    const replacements = JSON.parse(message.dataset.messageReplacements || '{}');
    message.textContent = t(message.dataset.messageKey, replacements);
  }
  if (submitButton.disabled) submitButton.textContent = t('signingIn');
}

function t(key, replacements = {}) {
  let value = translations[language][key] || translations.en[key] || key;
  Object.entries(replacements).forEach(([name, replacement]) => {
    value = value.replaceAll(`{${name}}`, String(replacement));
  });
  return value;
}
