'use strict';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '-D') {
      out.debug = true;
      continue;
    }
    if (raw === '-h') {
      out.help = true;
      continue;
    }
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq !== -1) {
      out[toCamel(raw.slice(2, eq))] = raw.slice(eq + 1);
    } else {
      const key = toCamel(raw.slice(2));
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
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

function setServerConfigSetting(filePath, sectionName, keyName, value, fs, path) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Server config not found: ${filePath}`);
  }

  const sectionHeader = `[${sectionName}]`;
  const keyPattern = new RegExp(`^(\\s*${escapeRegExp(keyName)}\\s*=\\s*).*$`, 'i');
  const lines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/);
  let inSection = false;
  let sectionFound = false;
  let keyUpdated = false;
  let insertAt = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      if (inSection && !keyUpdated) insertAt = i;
      inSection = normalizeConfigKey(sectionMatch[1]) === normalizeConfigKey(sectionName);
      sectionFound = sectionFound || inSection;
      continue;
    }
    if (inSection && keyPattern.test(lines[i])) {
      lines[i] = lines[i].replace(keyPattern, `$1${value}`);
      keyUpdated = true;
      break;
    }
  }

  if (!sectionFound) {
    if (lines[lines.length - 1] !== '') lines.push('');
    lines.push(sectionHeader, `${keyName} = ${value}`);
  } else if (!keyUpdated) {
    lines.splice(insertAt, 0, `${keyName} = ${value}`);
  }

  fs.writeFileSync(resolved, `${lines.join('\n').replace(/\n+$/, '')}\n`);
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  ensureServerConfigDefaults,
  getSetting,
  loadServerConfig,
  parseArgs,
  parseBoolean,
  setServerConfigSetting,
};
