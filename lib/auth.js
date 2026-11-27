'use strict';

const crypto = require('node:crypto');

const COOKIE = 'st_auth';
const MAX_AGE_S = 30 * 24 * 60 * 60;
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Salasanasuojaus. Salasana luetaan ympäristömuuttujasta CHECK_PASSWORD, eikä sitä
 * tallenneta koodiin. Ilman salasanaa suojaus ei ole käytössä.
 */
function createAuth(password) {
  const enabled = Boolean(password);
  // Evästeeseen tallennetaan salasanasta johdettu tunniste, ei itse salasanaa.
  // Kun salasana vaihdetaan, vanhat kirjautumiset lakkaavat toimimasta.
  const token = enabled ? crypto.createHmac('sha256', password).update('sivutarkastaja-istunto-v1').digest('hex') : '';
  const attempts = new Map();

  function isAuthed(req) {
    if (!enabled) return true;
    const got = parseCookies(req.headers.cookie)[COOKIE];
    return Boolean(got) && crypto.timingSafeEqual(sha(got), sha(token));
  }

  function requireAuth(req, res, next) {
    if (isAuthed(req)) return next();
    res.status(401).json({ error: 'Tarkastukset on suojattu salasanalla. Kirjaudu sisään.', loginRequired: true });
  }

  function tooManyAttempts(ip) {
    const now = Date.now();
    const a = attempts.get(ip);
    if (!a || a.reset < now) {
      attempts.set(ip, { count: 1, reset: now + ATTEMPT_WINDOW_MS });
      if (attempts.size > 10_000) attempts.clear();
      return false;
    }
    a.count++;
    return a.count > MAX_ATTEMPTS;
  }

  function login(req, res) {
    if (!enabled) return res.json({ ok: true });
    if (tooManyAttempts(req.ip)) {
      return res.status(429).json({ error: 'Liian monta yritystä. Odota 15 minuuttia ja yritä uudelleen.' });
    }
    const given = String((req.body && req.body.password) || '');
    if (!given || !crypto.timingSafeEqual(sha(given), sha(password))) {
      return res.status(401).json({ error: 'Salasana on väärin.' });
    }
    attempts.delete(req.ip);
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`);
    res.json({ ok: true });
  }

  function logout(req, res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  }

  function session(req, res) {
    res.json({ required: enabled, ok: isAuthed(req) });
  }

  return { enabled, isAuthed, requireAuth, login, logout, session };
}

module.exports = { createAuth };
