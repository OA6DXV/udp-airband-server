'use strict';

const net = require('net');

function classifyAddress(value) {
  const normalized = normalizeAddress(value);
  const family = net.isIP(normalized);
  if (!family) {
    return {
      anonymized: '',
      family: 0,
      isLocal: true,
      normalized: '',
    };
  }

  const isLocal = family === 4 ? isNonPublicIpv4(normalized) : isNonPublicIpv6(normalized);
  return {
    anonymized: isLocal ? normalized : anonymizePublicAddress(normalized, family),
    family,
    isLocal,
    normalized,
  };
}

function normalizeAddress(value) {
  let address = String(value || '').trim();
  if (address.startsWith('[') && address.includes(']')) {
    address = address.slice(1, address.indexOf(']'));
  }
  const zoneIndex = address.indexOf('%');
  if (zoneIndex !== -1) address = address.slice(0, zoneIndex);
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped && net.isIP(mapped[1]) === 4) return mapped[1];
  return address.toLowerCase();
}

function anonymizePublicAddress(address, family = net.isIP(address)) {
  if (family === 4) {
    const octets = address.split('.');
    return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
  }
  if (family === 6) {
    const groups = expandIpv6(address);
    return `${groups[0].toString(16)}:${groups[1].toString(16)}:${groups[2].toString(16)}::`;
  }
  return '';
}

function isNonPublicIpv4(address) {
  const parts = address.split('.').map(Number);
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function isNonPublicIpv6(address) {
  const groups = expandIpv6(address);
  const first = groups[0];
  const second = groups[1];
  const allZero = groups.every((group) => group === 0);
  const loopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  return allZero
    || loopback
    || (first & 0xfe00) === 0xfc00
    || (first & 0xffc0) === 0xfe80
    || (first & 0xff00) === 0xff00
    || (first === 0x2001 && second === 0x0db8)
    || (first & 0xe000) !== 0x2000;
}

function expandIpv6(address) {
  let input = address;
  const ipv4Tail = input.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4Tail) {
    const octets = ipv4Tail[1].split('.').map(Number);
    const replacement = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    input = input.slice(0, -ipv4Tail[1].length) + replacement;
  }

  const halves = input.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const missing = Math.max(0, 8 - left.length - right.length);
  return [...left, ...Array(missing).fill('0'), ...right].map((group) => parseInt(group || '0', 16));
}

module.exports = {
  anonymizePublicAddress,
  classifyAddress,
  normalizeAddress,
};
