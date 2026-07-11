import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './env.js';

let key = null;

/**
 * Encryption/signing key. Prefers SESSION_SECRET env; otherwise generates a
 * random secret persisted at DATA_DIR/secret.key so restarts keep working.
 */
export function initKey() {
  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    const f = path.join(cfg.dataDir, 'secret.key');
    try {
      secret = fs.readFileSync(f, 'utf8').trim();
    } catch {
      secret = crypto.randomBytes(48).toString('hex');
      fs.mkdirSync(cfg.dataDir, { recursive: true });
      fs.writeFileSync(f, secret, { mode: 0o600 });
    }
  }
  key = crypto.scryptSync(secret, 'mcp-station-v1', 32);
  return key;
}

function k() {
  if (!key) initKey();
  return key;
}

/** AES-256-GCM. Returns 'enc:v1:<iv>:<tag>:<ciphertext>' (base64 parts). */
export function encrypt(plain) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `enc:v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

/** Decrypts 'enc:v1:...' blobs; passes plaintext through untouched. */
export function decrypt(blob) {
  if (!blob) return '';
  const s = String(blob);
  if (!s.startsWith('enc:v1:')) return s;
  try {
    const [, , ivB, tagB, dataB] = s.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', k(), Buffer.from(ivB, 'base64'));
    d.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([d.update(Buffer.from(dataB, 'base64')), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const sha256b64url = (s) => crypto.createHash('sha256').update(s).digest('base64url');

export function timingEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** HMAC-sign a value for cookies: 'value.signature'. */
export function sign(value) {
  const mac = crypto.createHmac('sha256', k()).update(String(value)).digest('base64url');
  return `${value}.${mac}`;
}

export function unsign(signed) {
  const i = String(signed).lastIndexOf('.');
  if (i < 1) return null;
  const value = String(signed).slice(0, i);
  return timingEqual(sign(value), signed) ? value : null;
}
