'use strict';

function createLogger(options = {}) {
  const debugEnabled = Boolean(options.debug);

  function line(level, event, fields = {}) {
    const parts = [level.toUpperCase(), event];
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null || value === '') continue;
      parts.push(`${key}=${formatValue(value)}`);
    }
    const output = parts.join(' ');
    if (level === 'error' || level === 'warn') {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  return {
    debugEnabled,
    debug: (event, fields) => {
      if (debugEnabled) line('debug', event, fields);
    },
    info: (event, fields) => line('info', event, fields),
    warn: (event, fields) => line('warn', event, fields),
    error: (event, fields) => line('error', event, fields),
  };
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
