'use strict';

const net = require('net');

function createProxyTrust(value) {
  const entries = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const blockList = new net.BlockList();

  for (const entry of entries) {
    const [rawAddress, rawPrefix] = entry.split('/');
    const address = normalizeAddress(rawAddress);
    const family = net.isIP(address);
    if (!family) throw new Error(`Invalid trusted proxy address: ${entry}`);
    if (rawPrefix === undefined) {
      blockList.addAddress(address, family === 4 ? 'ipv4' : 'ipv6');
      continue;
    }
    const prefix = Number(rawPrefix);
    const maximum = family === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 1 || prefix > maximum) {
      throw new Error(`Trusted proxy CIDR must use a prefix between 1 and ${maximum}: ${entry}`);
    }
    blockList.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }

  return {
    entries,
    isTrusted(address) {
      const normalized = normalizeAddress(address);
      const family = net.isIP(normalized);
      return Boolean(family && blockList.check(normalized, family === 4 ? 'ipv4' : 'ipv6'));
    },
  };
}

function resolveRequestContext(req, proxyTrust) {
  const immediateAddress = normalizeAddress(req.socket && req.socket.remoteAddress);
  const trusted = Boolean(proxyTrust && proxyTrust.isTrusted(immediateAddress));
  const forwardedProto = trusted ? firstHeader(req.headers['x-forwarded-proto']) : '';
  const forwardedHost = trusted ? firstHeader(req.headers['x-forwarded-host']) : '';
  const forwardedFor = trusted ? firstHeader(req.headers['x-forwarded-for']) : '';
  const protocol = ['http', 'https'].includes(forwardedProto.toLowerCase())
    ? forwardedProto.toLowerCase()
    : ((req.socket && req.socket.encrypted) ? 'https' : 'http');
  const host = sanitizeHost(forwardedHost || req.headers.host || '');
  const clientAddress = normalizeAddress(forwardedFor) || immediateAddress;

  return {
    clientAddress,
    host,
    immediateAddress,
    origin: host ? `${protocol}://${host}` : '',
    protocol,
    secure: protocol === 'https',
    trustedProxy: trusted,
  };
}

function firstHeader(value) {
  return String(Array.isArray(value) ? value[0] : (value || '')).split(',')[0].trim();
}

function normalizeAddress(value) {
  let address = String(value || '').trim();
  if (address.startsWith('[') && address.includes(']')) {
    address = address.slice(1, address.indexOf(']'));
  }
  const zoneIndex = address.indexOf('%');
  if (zoneIndex !== -1) address = address.slice(0, zoneIndex);
  if (address.startsWith('::ffff:') && net.isIP(address.slice(7)) === 4) {
    address = address.slice(7);
  }
  return address;
}

function sanitizeHost(value) {
  const host = String(value || '').trim();
  if (!host || host.length > 255 || /[\s/\\@]/.test(host)) return '';
  return host;
}

module.exports = {
  createProxyTrust,
  normalizeAddress,
  resolveRequestContext,
};
