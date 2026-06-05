'use strict';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '-D') {
      out.debug = true;
      continue;
    }
    if (raw === '-A') {
      out.api = true;
      continue;
    }
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq !== -1) {
      out[toCamel(raw.slice(2, eq))] = raw.slice(eq + 1);
    } else {
      const key = toCamel(raw.slice(2));
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    }
  }
  return out;
}

function loadServerConfig(filePath, fs, path) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return {};
  }

  const out = {};
  let section = '';
  const lines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.replace(/[;#].*$/, '').trim();
    if (!trimmed) continue;

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = normalizeConfigKey(sectionMatch[1]);
      continue;
    }

    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      throw new Error(`Invalid config line in ${filePath}: ${line}`);
    }

    const rawKey = normalizeConfigKey(trimmed.slice(0, eq).trim());
    const key = section ? `${section}.${rawKey}` : rawKey;
    out[key] = unquote(trimmed.slice(eq + 1).trim());
  }
  return out;
}

function getSetting(serverConfig, key, fallback) {
  const normalized = normalizeConfigKey(key);
  return Object.prototype.hasOwnProperty.call(serverConfig, normalized) ? serverConfig[normalized] : fallback;
}

function ensureServerConfigDefaults(filePath, defaults, fs, path) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return false;
  }

  const current = loadServerConfig(filePath, fs, path);
  const additions = [];
  for (const section of defaults) {
    const missingKeys = section.keys.filter((item) => {
      const normalized = normalizeConfigKey(`${section.name}.${item.key}`);
      return !Object.prototype.hasOwnProperty.call(current, normalized);
    });
    if (!missingKeys.length) continue;
    additions.push('', `[${section.name}]`);
    for (const comment of section.comments || []) {
      additions.push(`# ${comment}`);
    }
    for (const item of missingKeys) {
      if (item.comment) additions.push(`# ${item.comment}`);
      additions.push(`${item.key} = ${item.value}`);
    }
  }

  if (!additions.length) {
    return false;
  }

  const original = fs.readFileSync(resolved, 'utf8');
  const separator = original.endsWith('\n') || original.endsWith('\r\n') ? '' : '\n';
  fs.writeFileSync(resolved, `${original}${separator}${additions.join('\n')}\n`);
  return true;
}

function normalizeConfigKey(value) {
  return String(value)
    .trim()
    .replace(/[-_]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase())
    .replace(/\s+/g, '');
}

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function toCamel(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

module.exports = {
  ensureServerConfigDefaults,
  getSetting,
  loadServerConfig,
  parseArgs,
  parseBoolean,
};
