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
import { cfg } from './env.js';
import { getState, save } from './state.js';
import { encrypt, decrypt } from './crypto.js';
import { log } from './log.js';

export const RESERVED_SLUGS = new Set([
  'api', 'assets', 'authorize', 'backups', 'favicon.ico', 'healthz', 'index.html',
  'login', 'logout', 'mcp', 'oauth', 'register', 'revoke', 'token', '.well-known'
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

let modules = new Map(); // slug -> { id, dir, manifest, register, test, error }

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
    } catch (e) {
      entry.error = e.message;
      log('mcp', `Module '${d.name}' failed to load: ${e.message}`);
    }
    next.set(entry.manifest?.slug || d.name, entry);

    // Ensure a registry entry exists (holds enabled flag + encrypted settings).
    if (!st.mcps[entry.id]) {
      st.mcps[entry.id] = { id: entry.id, enabled: !entry.error, settings: {}, createdAt: new Date().toISOString() };
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
}

/* ── Request handling: fresh server per request (stateless) ──────────── */
export function buildServerFor(mod) {
  const server = new McpServer({ name: `${mod.id}-mcp-server`, version: mod.manifest.version });
  mod.register({
    server,
    z,
    getSettings: () => getSettingsFor(mod.id),
    log: (m) => log(`mcp:${mod.id}`, m),
    fetchJson
  });
  return server;
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
