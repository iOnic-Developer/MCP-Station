/**
 * Modular MCP host. Each folder in MCPS_DIR containing manifest.json +
 * index.js becomes an MCP server mounted at /<slug> (streamable HTTP,
 * stateless JSON — a fresh McpServer per request, no session state).
 *
 * Module contract (see docs/BUILDING_MCPS.md and mcps/_template):
 *   manifest.json — { id, slug, name, description, icon, version, settings[] }
 *   index.js      — export function register({ server, z, getSettings, log, fetchJson })
 *                   export async function test(settings, { fetchJson })   // optional
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { cfg } from './env.js';
import { getState, save } from './state.js';
import { encrypt, decrypt } from './crypto.js';
import { createShare, listShares, revokeShare, parseTtl } from './fileShares.js';
import { log } from './log.js';

const shareStore = { createShare, listShares, revokeShare, parseTtl };

// 'mcp' is deliberately NOT reserved: nothing in the station routes it, and hosting a module at
// /mcp makes the endpoint path-identical to the working SiYuan Companion — the last wire-visible
// difference between the two servers once headers and metadata match.
export const RESERVED_SLUGS = new Set([
  'api', 'assets', 'authorize', 'backups', 'favicon.ico', 'healthz', 'index.html',
  'login', 'logout', 'oauth', 'register', 'revoke', 'token', '.well-known'
]);

export const ManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9_\-]+$/, 'id: lowercase letters, digits, _ or - only'),
  slug: z.string().regex(/^[a-z0-9_\-]+$/, 'slug: lowercase letters, digits, _ or - only'),
  name: z.string().min(1),
  description: z.string().default(''),
  icon: z.string().default('🔌'),
  version: z.string().default('1.0.0'),
  settings: z.array(z.object({
    key: z.string().regex(/^[a-zA-Z0-9_]+$/),
    label: z.string(),
    type: z.enum(['text', 'secret', 'select', 'textarea']).default('text'),
    required: z.boolean().default(false),
    default: z.string().optional(),
    options: z.array(z.string()).optional(),
    help: z.string().optional()
  })).default([])
});

let modules = new Map(); // slug -> { id, dir, manifest, register, test, instructions, error }

/* ── Self-contained module config ─────────────────────────────────────────
 * The registry (station.json) stays the source of truth, but every write is
 * mirrored to mcps/<id>/.config.json so a module folder carries its own config:
 * delete the folder, put it back, and the station adopts it and carries on.
 * Dot-prefixed, so the file walker never shows it as an editable tab.
 * Secrets stay encrypted with the station key — a folder moved to a DIFFERENT
 * station loads fine but its secrets won't decrypt, so it lands as NEEDS SETTINGS.
 */
const CONFIG_FILE = '.config.json';

export function mirrorConfig(id) {
  const mod = getModuleById(id);
  const reg = getState().mcps[id];
  if (!mod || !reg) return;
  try {
    fs.writeFileSync(
      path.join(mod.dir, CONFIG_FILE),
      JSON.stringify({ id, enabled: reg.enabled, settings: reg.settings || {}, token: reg.token || '', updatedAt: reg.updatedAt }, null, 2)
    );
  } catch (e) {
    log('mcp', `Could not mirror config for '${id}': ${e.message}`);
  }
}

function adoptConfig(dir, id, hasError) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dir, CONFIG_FILE), 'utf8'));
    log('mcp', `Adopted config for '${id}' from its module folder`);
    return {
      id,
      enabled: hasError ? false : c.enabled !== false,
      settings: c.settings && typeof c.settings === 'object' ? c.settings : {},
      token: typeof c.token === 'string' ? c.token : '',
      createdAt: new Date().toISOString(),
      adoptedAt: new Date().toISOString()
    };
  } catch {
    return null; // no file, or unreadable — fall back to a fresh entry
  }
}

/** This module's own static bearer ('' = none; the station-wide MCP_TOKEN still works). */
export function getModuleToken(id) {
  const reg = getState().mcps[id];
  return reg?.token ? decrypt(reg.token) : '';
}

/** Set (or clear, with '') a module's own bearer token. Returns the plaintext once. */
export function setModuleToken(id, plain) {
  const st = getState();
  if (!st.mcps[id]) throw new Error(`Unknown MCP '${id}'`);
  st.mcps[id].token = plain ? encrypt(plain) : '';
  st.mcps[id].updatedAt = new Date().toISOString();
  save();
  mirrorConfig(id);
  return plain;
}

/** Enable/disable a module (mirrored into its folder). */
export function setEnabled(id, enabled) {
  const st = getState();
  if (!st.mcps[id]) throw new Error(`Unknown MCP '${id}'`);
  st.mcps[id].enabled = Boolean(enabled);
  st.mcps[id].updatedAt = new Date().toISOString();
  save();
  mirrorConfig(id);
}

/** Scan MCPS_DIR and (re)load every module. Cache-busted dynamic imports = hot reload. */
export async function loadModules() {
  const next = new Map();
  const st = getState();
  fs.mkdirSync(cfg.mcpsDir, { recursive: true });
  const dirs = fs.readdirSync(cfg.mcpsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'));

  for (const d of dirs) {
    const dir = path.join(cfg.mcpsDir, d.name);
    const entry = { id: d.name, dir, manifest: null, register: null, test: null, error: null };
    try {
      const manifest = ManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')));
      if (RESERVED_SLUGS.has(manifest.slug)) throw new Error(`slug '${manifest.slug}' is reserved`);
      if (next.has(manifest.slug)) throw new Error(`duplicate slug '${manifest.slug}' (already used by another module)`);
      entry.id = manifest.id;
      entry.manifest = manifest;
      const mod = await import(pathToFileURL(path.join(dir, 'index.js')).href + `?v=${Date.now()}`);
      if (typeof mod.register !== 'function') {
        throw new Error('index.js must export: function register({ server, z, getSettings, log, fetchJson })');
      }
      entry.register = mod.register;
      entry.test = typeof mod.test === 'function' ? mod.test : null;
      // Optional house style handed to every client at initialize() (MCP `instructions`).
      try { entry.instructions = fs.readFileSync(path.join(dir, 'instructions.md'), 'utf8').slice(0, 100_000); }
      catch { entry.instructions = ''; }
    } catch (e) {
      entry.error = e.message;
      log('mcp', `Module '${d.name}' failed to load: ${e.message}`);
    }
    next.set(entry.manifest?.slug || d.name, entry);

    // Ensure a registry entry exists (enabled flag + encrypted settings). A folder that
    // carries a .config.json but has no registry entry — restored from trash, copied in,
    // or re-added after a manual delete — adopts its own config instead of starting blank.
    if (!st.mcps[entry.id]) {
      st.mcps[entry.id] = adoptConfig(dir, entry.id, Boolean(entry.error))
        || { id: entry.id, enabled: !entry.error, settings: {}, createdAt: new Date().toISOString() };
      save();
    }
  }
  modules = next;
  log('mcp', `Loaded ${[...modules.values()].filter((m) => !m.error).length}/${modules.size} module(s): ${[...modules.keys()].join(', ') || 'none'}`);
  return modules;
}

export const getModules = () => modules;
export const getModuleBySlug = (slug) => modules.get(slug) || null;
export const getModuleById = (id) => [...modules.values()].find((m) => m.id === id) || null;

/** Decrypted settings object for a module (manifest defaults applied). */
export function getSettingsFor(id) {
  const st = getState();
  const reg = st.mcps[id];
  const mod = getModuleById(id);
  const out = {};
  for (const s of mod?.manifest?.settings || []) {
    const raw = reg?.settings?.[s.key];
    out[s.key] = raw != null && raw !== '' ? decrypt(raw) : (s.default ?? '');
  }
  return out;
}

/** True when every required setting has a value. */
export function isConfigured(id) {
  const mod = getModuleById(id);
  if (!mod?.manifest) return false;
  const vals = getSettingsFor(id);
  return mod.manifest.settings.filter((s) => s.required).every((s) => vals[s.key]);
}

/** Store settings (secrets encrypted). '••••••' means "leave unchanged". */
export function saveSettings(id, values) {
  const st = getState();
  const mod = getModuleById(id);
  if (!st.mcps[id] || !mod?.manifest) throw new Error(`Unknown MCP '${id}'`);
  for (const s of mod.manifest.settings) {
    if (!(s.key in values)) continue;
    const v = String(values[s.key] ?? '');
    if (s.type === 'secret' && v === '••••••') continue; // masked placeholder — unchanged
    st.mcps[id].settings[s.key] = v === '' ? '' : (s.type === 'secret' ? encrypt(v) : v);
  }
  st.mcps[id].updatedAt = new Date().toISOString();
  save();
  mirrorConfig(id);
}

/* ── Request handling: fresh server per request (stateless) ──────────── */
export function buildServerFor(mod) {
  const server = new McpServer(
    { name: `${mod.id}-mcp-server`, version: mod.manifest.version },
    mod.instructions ? { instructions: mod.instructions } : undefined
  );
  mod.register({
    server,
    z,
    getSettings: () => getSettingsFor(mod.id),
    log: (m) => log(`mcp:${mod.id}`, m),
    fetchJson,
    shareStore // { createShare, listShares, revokeShare, parseTtl } — public /f/<token> links
  });
  return server;
}

/**
 * What can this MCP actually do? Runs the module for real over an in-memory transport and
 * asks it, exactly as a client would — so the answer is the truth, not a guess parsed from
 * the source. This is how you inspect a module a friend handed you before trusting it.
 */
export async function describeModule(id) {
  const mod = getModuleById(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  if (mod.error) throw new Error(`Module failed to load: ${mod.error}`);

  const server = buildServerFor(mod);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-station-introspect', version: cfg.version }, { capabilities: {} });
  try {
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const caps = client.getServerCapabilities() || {};
    const [tools, prompts] = await Promise.all([
      caps.tools ? client.listTools().then((r) => r.tools) : [],
      caps.prompts ? client.listPrompts().then((r) => r.prompts) : []
    ]);
    return {
      name: mod.manifest.name,
      version: mod.manifest.version,
      instructions: client.getInstructions() || '',
      tools,
      prompts
    };
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

export async function handleMcpRequest(req, res) {
  const slug = req.params.slug;
  const mod = getModuleBySlug(slug);
  const st = getState();
  if (!mod) return res.status(404).json({ error: `No MCP is hosted at /${slug}` });
  if (mod.error) return res.status(500).json({ error: `MCP '${slug}' failed to load: ${mod.error}` });
  if (!st.mcps[mod.id]?.enabled) return res.status(404).json({ error: `MCP '${slug}' is disabled in MCP Station` });

  if (req.method !== 'POST') {
    return res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'This MCP runs stateless streamable HTTP — POST only.' },
      id: null
    });
  }

  try {
    const server = buildServerFor(mod);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    log('mcp', `Error handling /${slug}: ${e.message}`);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
}

/* ── Module management (create / delete / file editing) ──────────────── */
export function createModule({ name, slug, description = '', icon = '🔌' }) {
  slug = String(slug || '').trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '_');
  if (!slug) throw new Error('A slug is required (e.g. weather_mcp)');
  if (RESERVED_SLUGS.has(slug)) throw new Error(`'${slug}' is a reserved path — pick another slug`);
  if (getModuleBySlug(slug)) throw new Error(`slug '${slug}' is already in use`);
  const id = slug;
  const dir = path.join(cfg.mcpsDir, id);
  if (fs.existsSync(dir)) throw new Error(`Folder mcps/${id} already exists`);

  const tpl = path.join(cfg.mcpsDir, '_template');
  const fill = (s) => s
    .replaceAll('__ID__', id)
    .replaceAll('__SLUG__', slug)
    .replaceAll('__NAME__', name || slug)
    .replaceAll('__DESCRIPTION__', description)
    .replaceAll('__ICON__', icon || '🔌');

  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(tpl)) {
    const src = fs.readFileSync(path.join(tpl, f), 'utf8');
    fs.writeFileSync(path.join(dir, f), fill(src));
  }
  log('mcp', `Created module '${id}' from template`);
  return { id, slug };
}

/** Soft delete: move the folder to DATA_DIR/trash and drop the registry entry. */
export function deleteModule(id) {
  const mod = getModuleById(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  const trash = path.join(cfg.dataDir, 'trash');
  fs.mkdirSync(trash, { recursive: true });
  const dest = path.join(trash, `${id}-${Date.now()}`);
  fs.cpSync(mod.dir, dest, { recursive: true });
  fs.rmSync(mod.dir, { recursive: true, force: true });
  const st = getState();
  delete st.mcps[id];
  save();
  log('mcp', `Deleted module '${id}' (copy kept in data/trash)`);
}

const EDITABLE = /\.(js|json|md|txt)$/;
const MAX_FILE = 512 * 1024;

function jail(mod, rel) {
  const p = path.resolve(mod.dir, rel);
  if (!p.startsWith(path.resolve(mod.dir) + path.sep) && p !== path.resolve(mod.dir)) {
    throw new Error('Path escapes the module folder');
  }
  return p;
}

export function listModuleFiles(id) {
  const mod = getModuleById(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  const out = [];
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else out.push({ path: rel, size: fs.statSync(path.join(dir, e.name)).size });
    }
  };
  walk(mod.dir, '');
  return out;
}

export function readModuleFile(id, rel) {
  const mod = getModuleById(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  const p = jail(mod, rel);
  if (!EDITABLE.test(p)) throw new Error('Only .js/.json/.md/.txt files can be opened');
  if (fs.statSync(p).size > MAX_FILE) throw new Error('File too large for the editor');
  return fs.readFileSync(p, 'utf8');
}

export function writeModuleFile(id, rel, content) {
  const mod = getModuleById(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  const p = jail(mod, rel);
  if (!EDITABLE.test(p)) throw new Error('Only .js/.json/.md/.txt files can be written');
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE) throw new Error('Content too large (512 KB max)');
  if (rel === 'manifest.json') {
    ManifestSchema.parse(JSON.parse(content)); // validate before write
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  log('mcp', `Wrote ${id}/${rel} — reload modules to apply`);
}

/* ── Per-module assistant chat, stored in the module's own folder ─────── */
const CHAT_FILE = '.chat.json'; // dot-prefixed: listModuleFiles skips it, so it never shows as a tab

export function readModuleChat(id) {
  const mod = getModuleById(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(mod.dir, CHAT_FILE), 'utf8'));
    return Array.isArray(parsed.messages) ? parsed.messages : [];
  } catch {
    return [];
  }
}

export function writeModuleChat(id, messages) {
  const mod = getModuleById(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  const clean = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && typeof m.content === 'string')
    .slice(-60)
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.slice(0, 60_000) }));
  fs.writeFileSync(path.join(mod.dir, CHAT_FILE), JSON.stringify({ messages: clean }, null, 2));
  return clean;
}

/** The module's editable files inlined, for the assistant's system prompt. */
export function moduleSource(id, budget = 60_000) {
  const mod = getModuleById(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  const out = [];
  let left = budget;
  for (const f of listModuleFiles(id)) {
    if (!EDITABLE.test(f.path) || left <= 0) continue;
    let content;
    try { content = fs.readFileSync(path.join(mod.dir, f.path), 'utf8'); } catch { continue; }
    if (content.length > left) content = content.slice(0, left) + '\n… [truncated]';
    left -= content.length;
    out.push(`### ${f.path}\n\`\`\`\n${content}\n\`\`\``);
  }
  return out.join('\n\n');
}

/* ── Shared HTTP helper handed to modules ────────────────────────────── */
export async function fetchJson(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers || {}) },
    signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs || 30_000)
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 2000) }; }
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status} from ${new URL(url).host}: ${JSON.stringify(data).slice(0, 400)}`);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}
