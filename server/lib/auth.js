import { cfg } from './env.js';
import { getState, save } from './state.js';
import { randomToken, sign, unsign, timingEqual } from './crypto.js';

const SESSION_TTL = 7 * 24 * 3600 * 1000; // 7 days, sliding
const COOKIE = 'station_sid';
const attempts = new Map(); // ip -> { n, resetAt }

/* ── Login rate limiting (8 fails / minute / ip) ─────────────────────── */
export function checkRate(ip) {
  const a = attempts.get(ip);
  return !(a && Date.now() < a.resetAt && a.n >= 8);
}

export function noteFail(ip) {
  const now = Date.now();
  let a = attempts.get(ip);
  if (!a || now > a.resetAt) a = { n: 0, resetAt: now + 60_000 };
  a.n++;
  attempts.set(ip, a);
}

export function verifyPassword(pw) {
  return Boolean(cfg.appPassword) && timingEqual(String(pw || ''), cfg.appPassword);
}

/* ── Sessions (server-side records + HMAC-signed cookie) ─────────────── */
export function createSession(res) {
  const st = getState();
  const sid = randomToken(24);
  st.sessions[sid] = { createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL };
  save();
  setCookie(res, sign(sid), SESSION_TTL / 1000);
  return sid;
}

export function destroySession(req, res) {
  const sid = readSession(req);
  if (sid) {
    delete getState().sessions[sid];
    save();
  }
  setCookie(res, '', 0);
}

function setCookie(res, value, maxAge) {
  const parts = [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (cfg.cookieSecure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function readSession(req) {
  const raw = (req.headers.cookie || '')
    .split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const sid = unsign(decodeURIComponent(raw.slice(COOKIE.length + 1)));
  if (!sid) return null;
  const st = getState();
  const s = st.sessions[sid];
  if (!s || s.expiresAt < Date.now()) {
    if (s) { delete st.sessions[sid]; save(); }
    return null;
  }
  if (s.expiresAt - Date.now() < SESSION_TTL / 2) { // sliding renewal
    s.expiresAt = Date.now() + SESSION_TTL;
    save();
  }
  return sid;
}

/** Gate for /api/*: valid session + CSRF header on mutating requests. */
export function requireSession(req, res, next) {
  if (!cfg.appPassword) {
    return res.status(503).json({ error: 'APP_PASSWORD is not set on the server — set it and restart the container.' });
  }
  const sid = readSession(req);
  if (!sid) return res.status(401).json({ error: 'Not signed in' });
  if (req.method !== 'GET' && req.headers['x-station-csrf'] !== '1') {
    return res.status(403).json({ error: 'Missing CSRF header' });
  }
  req.sid = sid;
  next();
}
