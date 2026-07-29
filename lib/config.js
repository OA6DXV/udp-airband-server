'use strict';

const DEFAULT_SERVER_CONFIG_TEMPLATE = `[udp]
# Default UDP bind address for streams that do not set udpHost in streams.json.
host = 0.0.0.0

[web]
host = 0.0.0.0
port = 8585

[admin]
# Web Admin stays disabled unless enabled here or started with --webserver PORT.
host = 127.0.0.1
port = 8584
enabled = true
# Set secure = true to serve Web Admin over HTTPS and keep ALTCHA enabled.
# Set secure = false only for trusted private access; ALTCHA is disabled because browsers require HTTPS or localhost for the challenge.
secure = false
key =
cert =
# Maximum lifetime of an authenticated Web Admin session, in seconds.
session_ttl_seconds = 28800
# Maximum inactivity time before a Web Admin session expires, in seconds.
session_idle_seconds = 1800

[streams]
# Feeds, UDP ports, sample rates, and channel counts stay in this JSON file.
file = streams.json

[storage]
# Runtime metrics, Last Heard, geolocation, and Web Admin authentication use SQLite.
# Relative paths are resolved inside the runtime data directory.
sqlite_file = localdb.sqlite

[geo]
# Server-side geolocation. Public IPs are anonymized before storage.
# Private/local IPs never leave the server.
enabled = true
provider = ipwhois
key =
cache_ttl_days = 30
timeout_ms = 1500
ipv4_anonymize = /24
ipv6_anonymize = /48

[logging]
# Default is a service-friendly log level for startup, connections, warnings, and errors.
# Use -D when running manually to force full debug output from the server and ffmpeg.
level = info
timestamps = false
colors = false

[ssl]
enabled = false
key =
cert =

[compressed]
# Set enabled = false to disable all compressed audio modes.
enabled = true
# ADPCM is the default low-latency compressed mode and does not require ffmpeg.
# Other supported values are opus, aac, and hls.
codec = adpcm
adpcm_frame_ms = 40
ffmpeg = ffmpeg
opus_bitrate = 24k
aac_bitrate = 32k
keepalive_ms = 1000
`;

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

function ensureServerConfigFromTemplate(filePath, templatePath, fs, path) {
  const resolved = path.resolve(filePath);
  const resolvedTemplate = path.resolve(templatePath);
  if (!fs.existsSync(resolvedTemplate)) {
    return { created: false, updated: false, added: [], templateMissing: true };
  }

  if (!fs.existsSync(resolved)) {
    fs.copyFileSync(resolvedTemplate, resolved);
    return { created: true, updated: false, added: [], templateMissing: false };
  }

  const current = loadServerConfig(resolved, fs, path);
  const additions = collectMissingConfigEntries(resolvedTemplate, current, fs, path);
  if (!additions.entries.length) {
    return { created: false, updated: false, added: [], templateMissing: false };
  }

  const originalLines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/);
  const mergedLines = mergeMissingConfigEntries(originalLines, additions.sections);
  fs.writeFileSync(resolved, `${mergedLines.join('\n').replace(/\n+$/, '')}\n`);
  return { created: false, updated: true, added: additions.entries, templateMissing: false };
}

function ensureServerConfigFromTemplateWithTemp(filePath, temporaryPath, fs, path, template = DEFAULT_SERVER_CONFIG_TEMPLATE) {
  const resolvedTemporary = path.resolve(temporaryPath);
  fs.writeFileSync(resolvedTemporary, template.endsWith('\n') ? template : `${template}\n`);
  try {
    return ensureServerConfigFromTemplate(filePath, resolvedTemporary, fs, path);
  } finally {
    fs.rmSync(resolvedTemporary, { force: true });
  }
}

function collectMissingConfigEntries(templatePath, current, fs, path) {
  const lines = fs.readFileSync(path.resolve(templatePath), 'utf8').split(/\r?\n/);
  const entries = [];
  const sections = [];
  let section = '';
  let pendingComments = [];
  const sectionMap = new Map();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      pendingComments = [];
      continue;
    }

    if (/^[#;]/.test(trimmed)) {
      pendingComments.push(line);
      continue;
    }

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      pendingComments = [];
      continue;
    }

    const eq = trimmed.indexOf('=');
    if (eq === -1 || !section) {
      pendingComments = [];
      continue;
    }

    const rawKey = trimmed.slice(0, eq).trim();
    const normalized = normalizeConfigKey(`${section}.${rawKey}`);
    if (Object.prototype.hasOwnProperty.call(current, normalized)) {
      pendingComments = [];
      continue;
    }

    if (!sectionMap.has(section)) {
      const group = { name: section, lines: [] };
      sectionMap.set(section, group);
      sections.push(group);
    }

    const group = sectionMap.get(section);
    for (const comment of pendingComments) {
      group.lines.push(comment);
    }
    group.lines.push(line);
    entries.push(`${section}.${rawKey}`);
    pendingComments = [];
  }

  return { sections, entries };
}

function mergeMissingConfigEntries(originalLines, sections) {
  const lines = [...originalLines];

  for (const section of sections) {
    const range = findSectionRange(lines, section.name);
    const block = [...section.lines];

    if (range) {
      const insertAt = trimTrailingBlankLines(lines, range.end);
      lines.splice(insertAt, 0, ...block);
      continue;
    }

    if (lines[lines.length - 1] !== '') lines.push('');
    lines.push(`[${section.name}]`, ...block);
  }

  return lines;
}

function findSectionRange(lines, sectionName) {
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].trim().match(/^\[([^\]]+)\]$/);
    if (!match) continue;
    if (start !== -1) return { start, end: i };
    if (normalizeConfigKey(match[1]) === normalizeConfigKey(sectionName)) start = i;
  }
  return start === -1 ? null : { start, end: lines.length };
}

function trimTrailingBlankLines(lines, end) {
  let insertAt = end;
  while (insertAt > 0 && lines[insertAt - 1].trim() === '') {
    insertAt -= 1;
  }
  return insertAt;
}

function setServerConfigSetting(filePath, sectionName, keyName, value, fs, path) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Server config not found: ${filePath}`);
  }

  const sectionHeader = `[${sectionName}]`;
  const keyPattern = new RegExp(`^(\\s*)${escapeRegExp(keyName)}\\s*=\\s*.*$`, 'i');
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
      lines[i] = lines[i].replace(keyPattern, `$1${keyName} = ${value}`);
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
  DEFAULT_SERVER_CONFIG_TEMPLATE,
  ensureServerConfigDefaults,
  ensureServerConfigFromTemplate,
  ensureServerConfigFromTemplateWithTemp,
  getSetting,
  loadServerConfig,
  parseArgs,
  parseBoolean,
  setServerConfigSetting,
};
