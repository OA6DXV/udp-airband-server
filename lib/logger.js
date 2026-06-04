'use strict';

function createLogger(options = {}) {
  const configuredLevel = normalizeLevel(options.level || 'info');
  const level = options.debug ? 'debug' : configuredLevel;
  const timestamps = Boolean(options.timestamps);
  const colors = Boolean(options.colors);
  const levelPriority = {
    off: 100,
    error: 40,
    warn: 30,
    info: 20,
    debug: 10,
  };

  function line(level, event, fields = {}) {
    if (!shouldLog(level)) return;
    const parts = [level.toUpperCase(), event];
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null || value === '') continue;
      parts.push(`${key}=${formatValue(value)}`);
    }
    const output = decorate(level, timestamps ? `${new Date().toISOString()} ${parts.join(' ')}` : parts.join(' '));
    if (level === 'error' || level === 'warn') {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  function shouldLog(messageLevel) {
    return levelPriority[messageLevel] >= levelPriority[level];
  }

  return {
    debugEnabled: level === 'debug',
    level,
    shouldLog,
    plain: (messageLevel, message) => {
      if (!shouldLog(messageLevel)) return;
      const output = decorate(messageLevel, timestamps ? `${new Date().toISOString()} ${message}` : message);
      if (messageLevel === 'error' || messageLevel === 'warn') {
        console.error(output);
      } else {
        console.log(output);
      }
    },
    debug: (event, fields) => {
      line('debug', event, fields);
    },
    info: (event, fields) => line('info', event, fields),
    warn: (event, fields) => line('warn', event, fields),
    error: (event, fields) => line('error', event, fields),
  };

  function decorate(messageLevel, message) {
    if (!colors) return message;
    const code = {
      info: '\x1b[34m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
    }[messageLevel];
    return code ? `${code}${message}\x1b[0m` : message;
  }
}

function normalizeLevel(value) {
  const level = String(value).trim().toLowerCase();
  return ['off', 'error', 'warn', 'info', 'debug'].includes(level) ? level : 'info';
}

function formatValue(value) {
  const text = String(value);
  if (/^[A-Za-z0-9._:/@+-]+$/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

module.exports = {
  createLogger,
};
