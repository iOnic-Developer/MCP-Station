import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './env.js';

/**
 * Single-file JSON state store (atomic tmp+rename writes, debounced).
 * Everything that must survive a restart lives here: MCP registry entries
 * (enabled flags + encrypted settings), OAuth clients/codes/tokens, admin
 * sessions and the assistant's retained instructions.
 */
const FILE = () => path.join(cfg.dataDir, 'station.json');

let state = null;
let saveTimer = null;

const DEFAULTS = () => ({
  kind: 'mcp-station-state',
  version: 1,
  createdAt: new Date().toISOString(),
  /** Retained system instructions for the Claude popup (seeded on first boot). */
  instructions: '',
  /** Global settings: anthropicApiKey (encrypted), anthropicModel. */
  global: {},
  /** id -> { id, enabled, settings: { key: encryptedValue }, createdAt, updatedAt } */
  mcps: {},
  oauth: { clients: {}, codes: {}, tokens: {}, refresh: {} },
  sessions: {}
});

export function loadState() {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    state = { ...DEFAULTS(), ...parsed };
    state.oauth = { ...DEFAULTS().oauth, ...(parsed.oauth || {}) };
  } catch {
    state = DEFAULTS();
    persist();
  }
  return state;
}

export function getState() {
  if (!state) loadState();
  return state;
}

/** Immediate synchronous write. */
export function persist() {
  const tmp = FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(getState(), null, 2));
  fs.renameSync(tmp, FILE());
}

/** Debounced write — safe to call after every mutation. */
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { persist(); } catch (e) { console.error('state persist failed:', e.message); }
  }, 150);
}

/** Drop expired sessions, auth codes and tokens. Called periodically.
 * Epochs differ per record type: sessions ms, codes `exp` ms, tokens `expiresAt` SECONDS
 * (the OAuth wire format requireBearerAuth checks). Comparing seconds to Date.now() deleted
 * every live access token at the first sweep after issue — every connector died within 10 min. */
export function gc() {
  const st = getState();
  const now = Date.now();
  let dirty = false;
  for (const [k, v] of Object.entries(st.sessions)) if (v.expiresAt < now) { delete st.sessions[k]; dirty = true; }
  for (const [k, v] of Object.entries(st.oauth.codes)) if ((v.exp ?? 0) < now) { delete st.oauth.codes[k]; dirty = true; }
  for (const [k, v] of Object.entries(st.oauth.tokens)) if ((v.expiresAt ?? 0) * 1000 < now) { delete st.oauth.tokens[k]; dirty = true; }
  // refresh tokens: no server-side expiry, rotated on use — exactly like the Companion. Never swept.
  if (dirty) save();
}
