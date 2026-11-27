'use strict';

// Estää palvelinta hakemasta sisäverkon osoitteita (SSRF-suoja).

const dns = require('node:dns').promises;
const net = require('node:net');

function ipv4ToInt(ip) {
  return ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
}

const BLOCKED_V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].map(([base, bits]) => [ipv4ToInt(base), bits]);

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return BLOCKED_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (base & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return (
      v === '::' ||
      v === '::1' ||
      v.startsWith('fc') ||
      v.startsWith('fd') ||
      v.startsWith('fe8') ||
      v.startsWith('fe9') ||
      v.startsWith('fea') ||
      v.startsWith('feb') ||
      v.startsWith('ff')
    );
  }
  return true;
}

/** Tarkistaa käyttäjän antaman osoitteen ja palauttaa URL-olion. */
function parseUserUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new UrlError('Anna tarkastettavan sivun osoite.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlError('Osoite ei ole kelvollinen. Tarkista kirjoitusasu.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlError('Vain http- ja https-osoitteet voidaan tarkastaa.');
  }
  if (url.username || url.password) {
    throw new UrlError('Osoitteessa ei voi olla käyttäjätunnusta tai salasanaa.');
  }
  return url;
}

const lookupCache = new Map();

/**
 * Tarkistaa isäntänimen: 'ok' (vain julkisia osoitteita), 'private'
 * (yksityinen verkko) tai 'notfound' (nimeä ei löydy).
 */
async function checkHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return isPrivateIp(host) ? 'private' : 'ok';
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return 'private';
  }
  const cached = lookupCache.get(host);
  if (cached && cached.expires > Date.now()) return cached.result;
  let result;
  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true });
    if (addrs.length === 0) result = 'notfound';
    else result = addrs.every((a) => !isPrivateIp(a.address)) ? 'ok' : 'private';
  } catch {
    result = 'notfound';
  }
  lookupCache.set(host, { result, expires: Date.now() + 60_000 });
  return result;
}

async function isHostAllowed(hostname) {
  return (await checkHost(hostname)) === 'ok';
}

class UrlError extends Error {}

module.exports = { parseUserUrl, checkHost, isHostAllowed, isPrivateIp, UrlError };
