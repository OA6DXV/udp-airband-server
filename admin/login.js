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
let loginCsrfToken = '';
let challengeRequired = false;
let challengeConfiguredFor = '';

initialize();

async function initialize() {
  try {
    const response = await fetch('/api/auth/status', { cache: 'no-store', credentials: 'same-origin' });
    const body = await response.json();
    if (body.authenticated) {
      window.location.replace('/');
      return;
    }
    loginCsrfToken = body.loginCsrfToken || '';
    if (body.setupRequired) {
      showMessage('No administrator account exists yet. Run npm run admin:setup on the server.');
    }
  } catch {
    showMessage('The authentication service is unavailable.');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!loginCsrfToken) {
    showMessage('Reload this page before trying again.');
    return;
  }
  if (!usernameInput.value.trim() || !passwordInput.value) {
    showMessage('Enter username and password.');
    return;
  }
  setBusy(true);
  showMessage('');
  let altchaPayload = '';
  try {
    if (challengeRequired) {
      await configureChallengeWidget({ reset: true });
      const verification = await widget.verify();
      altchaPayload = verification && verification.payload;
      if (!altchaPayload) throw new Error('Verification could not be completed.');
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
    widget.reset();
    passwordInput.value = '';
    if (response.ok) {
      window.location.replace('/');
      return;
    }
    challengeRequired = Boolean(body.challengeRequired);
    await updateChallengeVisibility();
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after') || body.retryAfter || 1);
      showMessage(`Too many attempts. Try again in ${retryAfter} seconds.`);
    } else if (response.status === 403 || response.status === 409) {
      showMessage(challengeRequired
        ? 'Complete a new verification before trying again.'
        : 'The request could not be verified. Reload the page.');
    } else {
      showMessage('Invalid username, password, or verification.');
    }
  } catch (err) {
    widget.reset();
    challengeConfiguredFor = '';
    if (challengeRequired) await updateChallengeVisibility();
    showMessage(err.message || 'The login request failed.');
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
    widget.reset();
    widget.removeAttribute('challenge');
    challengeConfiguredFor = '';
  }
}

async function configureChallengeWidget(options = {}) {
  const username = usernameInput.value.trim();
  const challengeUrl = `/api/auth/challenge?username=${encodeURIComponent(username)}&t=${Date.now()}`;
  if (options.reset || challengeConfiguredFor !== username) {
    widget.reset();
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

function challengeFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      ...(options.headers || {}),
      'x-csrf-token': loginCsrfToken,
    },
  });
}

function setBusy(busy) {
  submitButton.disabled = busy;
  usernameInput.disabled = busy;
  passwordInput.disabled = busy;
  submitButton.textContent = busy ? 'Signing in...' : 'Sign in';
}

function showMessage(value) {
  message.textContent = value;
}
