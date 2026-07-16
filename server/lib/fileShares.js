/**
 * Public share links for stored files. A share maps an unguessable 128-bit token to ONE file
 * under a module's jail root; the station serves it unauthenticated at GET /f/<token> so a
 * browser (or anything) can fetch it by URL. Tokens are unguessable, links can expire, and the
 * resolver re-verifies the file is still inside the recorded root — the only public surface here
 * is a file someone explicitly chose to share.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cfg } from './env.js';
import { getState, persist } from './state.js';

const CONTENT_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.json': 'application/json', '.csv': 'text/csv',
  '.html': 'text/html; charset=utf-8', '.xml': 'application/xml', '.zip': 'application/zip',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm'
};
export const contentTypeFor = (p) => CONTENT_TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream';

const shares = () => (getState().shares ||= {});
const publicBase = () => (cfg.publicUrl || `http://localhost:${cfg.port}`).replace(/\/+$/, '');
const urlFor = (token) => `${publicBase()}/f/${token}`;

/** Parse "24h" / "7d" / "30m" / "3600" (seconds) → ms, or null for no expiry. */
export function parseTtl(spec) {
  if (spec == null || spec === '' || /^(never|none|0)$/i.test(String(spec))) return null;
  const m = String(spec).trim().match(/^(\d+)\s*([smhdw]?)$/i);
  if (!m) throw new Error('expires_in: use e.g. "24h", "7d", "30m", or seconds — or "never".');
  const n = Number(m[1]);
  const unit = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3, '': 1e3 }[m[2].toLowerCase()];
  return n * unit;
}

/**
 * Create (or return an existing identical) share for an absolute file path inside rootDir.
 * absPath must already be validated to sit under rootDir by the caller (the module's jail).
 */
export function createShare({ rootDir, absPath, ttlMs }) {
  const root = path.resolve(rootDir);
  const abs = path.resolve(absPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('File is outside the share root.');
  const st = fs.statSync(abs); // throws if missing
  if (!st.isFile()) throw new Error('Only files can be shared, not folders.');

  const rel = path.relative(root, abs).replaceAll('\\', '/');
  const expiresAt = ttlMs ? Date.now() + ttlMs : null;
  const token = crypto.randomBytes(16).toString('base64url'); // 128-bit, unguessable
  shares()[token] = { rootDir: root, rel, name: path.basename(abs), createdAt: Date.now(), expiresAt };
  persist();
  return { token, url: urlFor(token), rel, name: path.basename(abs), size: st.size, expiresAt };
}

/** Resolve a token to a servable file, or null (expired/unknown/missing/escaped all read the same). */
export function resolveShare(token) {
  const rec = shares()[String(token || '')];
  if (!rec) return null;
  if (rec.expiresAt && rec.expiresAt < Date.now()) { delete shares()[token]; persist(); return null; }
  const root = path.resolve(rec.rootDir);
  const abs = path.resolve(root, rec.rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null; // defence in depth
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return { abs, name: rec.name, contentType: contentTypeFor(abs) };
}

/** Active (non-expired) shares whose file lives under rootDir. */
export function listShares(rootDir) {
  const root = rootDir ? path.resolve(rootDir) : null;
  const now = Date.now();
  return Object.entries(shares())
    .filter(([, r]) => (!r.expiresAt || r.expiresAt > now) && (!root || path.resolve(r.rootDir) === root))
    .map(([token, r]) => ({ token, url: urlFor(token), path: r.rel, name: r.name, createdAt: r.createdAt, expiresAt: r.expiresAt }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Revoke by token or by full share URL. Returns true if something was removed. */
export function revokeShare(tokenOrUrl) {
  const token = String(tokenOrUrl || '').split('/f/').pop().trim();
  if (shares()[token]) { delete shares()[token]; persist(); return true; }
  return false;
}

/** Drop expired shares (called from state gc). Returns true if any were removed. */
export function gcShares() {
  const now = Date.now();
  let dirty = false;
  for (const [k, r] of Object.entries(shares())) if (r.expiresAt && r.expiresAt < now) { delete shares()[k]; dirty = true; }
  return dirty;
}
