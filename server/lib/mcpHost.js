/**
 * Modular MCP host. Each folder in MCPS_DIR containing manifest.json +
 * index.js becomes an MCP server mounted at /<slug> (streamable HTTP,
 * stateless JSON — a fresh McpServer per request, no session state).
 *
 * Module contract (see docs/BUILDING_MCPS.md and mcps/_template):
 *   manifest.json — { id, slug, name, description, icon, version, settings[] }
 *   index.js      — export function register({ server, z, getSettings, log, fetchJson, shareStore, stationStore })
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
import { MODULE_CONTRACT } from './seedInstructions.js';
import { log } from './log.js';
import { recordUsage } from './usage.js';

const shareStore = { createShare, listShares, revokeShare, parseTtl };

// 'mcp' is deliberately NOT reserved: nothing in the station routes it, and hosting a module at
// /mcp makes the endpoint path-identical to the working SiYuan Companion — the last wire-visible
// difference between the two servers once headers and metadata match.
export const RESERVED_SLUGS = new Set([
  'api', 'assets', 'authorize', 'backups', 'favicon.ico', 'healthz', 'index.html',
  'login', 'logout', 'oauth', 'register', 'revoke', 'token', '.well-known',
  'f', 'sw.js', 'offline.html', 'manifest.webmanifest'
]);

export const ManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9_\-]+$/, 'id: lowercase letters, digits, _ or - only'),
  slug: z.string().regex(/^[a-z0-9_\-]+$/, 'slug: lowercase letters, digits, _ or - only'),
  name: z.string().min(1),
  description: z.string().default(''),
  icon: z.string().default('🔌'),
  version: z.string().default('1.0.0'),
  configurationAlternatives: z.array(z.array(z.object({
    key: z.string().regex(/^[a-zA-Z0-9_]+$/),
    value: z.string().min(1).optional()
  }).strict()).min(1)).min(1).optional(),
  settings: z.array(z.object({
    key: z.string().regex(/^[a-zA-Z0-9_]+$/),
    label: z.string(),
    type: z.enum(['text', 'secret', 'select', 'textarea']).default('text'),
    required: z.boolean().default(false),
    default: z.string().optional(),
    options: z.array(z.string()).optional(),
    help: z.string().optional()
  })).default([])
}).superRefine((manifest, ctx) => {
  for (const [i, group] of (manifest.configurationAlternatives || []).entries()) {
    for (const [j, condition] of group.entries()) {
      const setting = manifest.settings.find((s) => s.key === condition.key);
      if (!setting) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['configurationAlternatives', i, j, 'key'],
          message: 'Configuration conditions must reference declared settings' });
      } else if (condition.value !== undefined && (setting.type === 'secret' || !condition.value.trim())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['configurationAlternatives', i, j, 'value'],
          message: 'Equality guards must be nonblank and must not contain secret values' });
      }
    }
  }
});

const registeredToolNames = new WeakMap();
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
  if (!mod || !reg || mod.sourceId) return;
  try {
    fs.writeFileSync(
      path.join(mod.dir, CONFIG_FILE),
      JSON.stringify({ id, enabled: reg.enabled, settings: reg.settings || {}, token: reg.token || '', tokenExpiresAt: reg.tokenExpiresAt || null, updatedAt: reg.updatedAt }, null, 2)
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
      tokenExpiresAt: typeof c.tokenExpiresAt === 'number' ? c.tokenExpiresAt : null,
      createdAt: new Date().toISOString(),
      adoptedAt: new Date().toISOString()
    };
  } catch {
    return null; // no file, or unreadable — fall back to a fresh entry
  }
}

/** This module's own static bearer ('' = none or past its expiry; the station-wide MCP_TOKEN still works). */
export function getModuleToken(id) {
  const reg = getState().mcps[id];
  if (!reg?.token) return '';
  if (reg.tokenExpiresAt && reg.tokenExpiresAt < Date.now()) return '';
  return decrypt(reg.token);
}

/** Set (or clear, with '') a module's own bearer token; expiresAt ms epoch or null = unlimited. Returns the plaintext once. */
export function setModuleToken(id, plain, expiresAt = null) {
  const st = getState();
  if (!st.mcps[id]) throw new Error(`Unknown MCP '${id}'`);
  st.mcps[id].token = plain ? encrypt(plain) : '';
  st.mcps[id].tokenExpiresAt = plain && expiresAt ? expiresAt : null;
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
    if (st.mcps[d.name]?.sourceId) {
      log('mcp', `Skipped source folder '${d.name}': id belongs to an account instance`);
      continue;
    }
    const dir = path.join(cfg.mcpsDir, d.name);
    const entry = { id: d.name, dir, manifest: null, register: null, test: null, error: null };
    try {
      const manifest = ManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')));
      if (RESERVED_SLUGS.has(manifest.slug)) throw new Error(`slug '${manifest.slug}' is reserved`);
      if (next.has(manifest.slug)) throw new Error(`duplicate slug '${manifest.slug}' (already used by another module)`);
      if (st.mcps[manifest.id]?.sourceId || Object.values(st.mcps).some((r) => r.sourceId && r.slug === manifest.slug)) {
        log('mcp', `Skipped source '${d.name}': id or slug belongs to an account instance`);
        continue;
      }
      if ([...next.values()].some((m) => m.id === manifest.id)) throw new Error(`duplicate id '${manifest.id}'`);
      entry.id = manifest.id;
      entry.manifest = manifest;
      const mod = await import(pathToFileURL(path.join(dir, 'index.js')).href + `?v=${Date.now()}`);
      if (typeof mod.register !== 'function') {
        throw new Error('index.js must export: function register({ server, z, getSettings, log, fetchJson, shareStore, stationStore })');
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
// Virtual manifests are fresh values, never mutable aliases to shared module metadata.
function instanceModule(reg) {
  const source = [...modules.values()].find((m) => m.id === reg?.sourceId);
  if (!source?.manifest) return null;
  return { ...source, id: reg.id, sourceId: source.id, name: reg.name,
    manifest: { ...structuredClone(source.manifest), id: reg.id, slug: reg.slug } };
}
export const getModuleById = (id) => {
  const reg = getState().mcps[id];
  return reg?.sourceId ? instanceModule(reg) : [...modules.values()].find((m) => m.id === id) || null;
};
export const getModuleBySlug = (slug) => modules.get(slug)
  || instanceModule(Object.values(getState().mcps).find((r) => r.sourceId && r.slug === slug));

export function getInstancesFor(sourceId) {
  const source = getModuleById(sourceId);
  if (!source || source.sourceId) return [];
  return [source, ...Object.values(getState().mcps)
    .filter((r) => r.sourceId === sourceId).map(instanceModule).filter(Boolean)];
}

export function createInstance(sourceId, { name, slug } = {}) {
  const source = getModuleById(sourceId);
  if (!source?.manifest || source.sourceId) throw new Error('An installed source module is required');
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw new Error('name must contain 1–100 characters');
  const st = getState();
  const available = (v) => !RESERVED_SLUGS.has(v) && !getModuleBySlug(v) && !getModuleById(v)
    && !Object.hasOwn(st.mcps, v) && !Object.values(st.mcps).some((r) => r.sourceId && r.slug === v)
    && !fs.existsSync(path.join(cfg.mcpsDir, v));
  if (slug === undefined) {
    const suffix = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'account';
    const stem = `${source.manifest.slug}--${suffix}`.slice(0, 110);
    slug = stem;
    for (let i = 2; !available(slug); i++) slug = `${stem}-${i}`;
  }
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(slug) || !available(slug)) {
    throw new Error('slug must be unique, non-reserved, 1–128 lowercase letters/digits/_/- and start with a letter or digit');
  }
  st.mcps[slug] = { id: slug, sourceId, slug, name: name.trim(), enabled: false,
    settings: {}, token: '', tokenExpiresAt: null, createdAt: new Date().toISOString() };
  save();
  return getModuleById(slug);
}

export function deleteInstance(sourceId, id) {
  const mod = getModuleById(id);
  if (!mod?.sourceId || mod.sourceId !== sourceId) throw new Error('Instance does not belong to this source module');
  delete getState().mcps[id];
  save();
}

function requireSource(id) {
  const mod = getModuleById(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  if (mod.sourceId) throw new Error(`Shared source: use sourceId '${mod.sourceId}' for files, editor, chat, export or source deletion`);
  return mod;
}

/** Decrypted settings object for a module (manifest defaults applied). */
export function getSettingsFor(id) {
  const st = getState();
  const reg = st.mcps[id];
  const mod = getModuleById(id);
  const out = {};
  for (const s of mod?.manifest?.settings || []) {
    const raw = reg?.settings?.[s.key];
    out[s.key] = raw != null && raw !== '' ? decrypt(raw) : (mod?.sourceId ? '' : (s.default ?? ''));
  }
  return out;
}

/** Required settings AND, when declared, at least one complete configuration alternative. */
export function isConfigured(id) {
  const mod = getModuleById(id);
  if (!mod?.manifest) return false;
  const vals = getSettingsFor(id);
  if (!mod.manifest.settings.filter((s) => s.required).every((s) => vals[s.key])) return false;
  return mod.manifest.configurationAlternatives === undefined || mod.manifest.configurationAlternatives.some((group) =>
    group.every(({ key, value }) => value === undefined ? Boolean(vals[key]?.trim()) : vals[key] === value));
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

/* ── stationStore: the station managing itself ────────────────────────
 * Injected into modules exactly the way shareStore is. It exposes the same operations the
 * admin UI drives — mcpHost's own functions, so no HTTP hop and no session cookie — which is
 * what lets the bundled `station` module hand an AI the ability to read, create, edit,
 * configure and reload MCPs. Reaching any of it still needs a bearer for /station, so it is
 * gated exactly like every other endpoint. */
export const stationStore = {
  /** The module contract, verbatim — what an AI needs before it writes an MCP. */
  guide: () => MODULE_CONTRACT,

  /** Every module, with enough detail to decide what to do next. */
  list: () =>
    [...modules.values()].map((m) => ({
      id: m.id,
      slug: m.manifest?.slug || m.id,
      name: m.manifest?.name || m.id,
      icon: m.manifest?.icon || '🔌',
      description: m.manifest?.description || '',
      version: m.manifest?.version || '',
      enabled: Boolean(m.enabled),
      configured: m.manifest ? isConfigured(m.id) : false,
      settingKeys: (m.manifest?.settings || []).map((x) => x.key),
      error: m.error || null
    })),

  /** Live introspection — runs the module and asks it, rather than parsing its source. */
  inspect: (id) => describeModule(id),

  files: (id) => listModuleFiles(id),
  read: (id, rel) => readModuleFile(id, rel),
  write: (id, rel, content) => writeModuleFile(id, rel, content),
  create: (spec) => createModule(spec),
  remove: (id) => deleteModule(id),
  setEnabled: (id, on) => setEnabled(id, on),
  reload: () => loadModules(),

  /** Settings schema + current values, secrets masked exactly as the UI masks them. */
  settings: (id) => {
    const mod = getModuleById(id);
    if (!mod?.manifest) throw new Error(`Unknown MCP '${id}'`);
    const vals = getSettingsFor(id);
    return {
      configured: isConfigured(id),
      settings: mod.manifest.settings.map((s) => ({
        key: s.key,
        label: s.label,
        type: s.type,
        required: Boolean(s.required),
        help: s.help || '',
        value: s.type === 'secret' ? (vals[s.key] ? '••••••' : '') : (vals[s.key] ?? '')
      }))
    };
  },

  /** Write settings. '••••••' for a secret means "leave unchanged"; '' clears it. */
  configure: (id, values) => saveSettings(id, values)
};

/* ── Request handling: fresh server per request (stateless) ──────────── */
export function buildServerFor(mod) {
  const server = new McpServer(
    { name: `${mod.id}-mcp-server`, version: mod.manifest.version },
    mod.instructions ? { instructions: mod.instructions } : undefined
  );
  // Capture names from successful registrations, not untrusted request text or SDK internals.
  const toolNames = new Set();
  for (const method of ['registerTool', 'tool']) {
    const register = server[method].bind(server);
    server[method] = (name, ...args) => {
      const tool = register(name, ...args);
      toolNames.add(name);
      return tool;
    };
  }
  registeredToolNames.set(server, toolNames);
  const settings = Object.freeze({ ...getSettingsFor(mod.id) });
  mod.register({
    server,
    z,
    getSettings: () => ({ ...settings }),
    log: (m) => log(`mcp:${mod.id}`, m),
    fetchJson,
    shareStore, // { createShare, listShares, revokeShare, parseTtl } — public /f/<token> links
    stationStore // station self-management: list/inspect/read/write/create/configure/reload MCPs
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

/** A Claude Code SKILL.md for this module: its about.md plus live tool introspection. */
export async function buildSkillMd(id) {
  const mod = getModuleById(id);
  const cap = await describeModule(id); // throws on unknown/broken module
  const { slug, name, description } = mod.manifest;
  const skillName = slug.replace(/_/g, '-'); // skill names are kebab-case
  const url = `${cfg.publicUrl || 'http://localhost:' + cfg.port}/${slug}/mcp`;
  let about = '';
  try { about = fs.readFileSync(path.join(mod.dir, 'about.md'), 'utf8').trim(); } catch { /* optional */ }

  const tools = cap.tools.map((t) => {
    const props = t.inputSchema?.properties || {};
    const required = new Set(t.inputSchema?.required || []);
    const args = Object.entries(props).map(([k, v]) =>
      `- \`${k}\` (${v.type || 'any'}${required.has(k) ? ', required' : ''})${v.description ? ` — ${v.description}` : ''}`
    ).join('\n') || '- _no arguments_';
    return `### ${t.name}\n\n${t.description || ''}\n\n${args}`;
  }).join('\n\n');

  const content = [
    '---',
    `name: ${skillName}`,
    `description: ${(description || name).replace(/\s+/g, ' ')} Use when working with ${name} over MCP.`,
    '---',
    '',
    `# ${name}`,
    '',
    about || description,
    '',
    '## Connecting',
    '',
    `This MCP is served by MCP Station at \`${url}\`.`,
    '',
    '```bash',
    `claude mcp add --transport http ${slug} ${url} --header "Authorization: Bearer $MCP_TOKEN"`,
    '```',
    '',
    `## Tools\n\n${tools || '_This module registers no tools._'}`,
    cap.instructions ? `\n## House rules (served to every client)\n\n${cap.instructions}` : ''
  ].join('\n');

  return { name: skillName, content };
}

/**
 * A shareable .zip of a module — everything a *different* station needs to run it, and nothing
 * private. Drop the extracted folder into any station's mcps/ and it appears as a NEEDS SETTINGS
 * module. Deliberately excludes the dot-files: .config.json (station-encrypted secrets — useless
 * and unsafe to ship) and .chat.json (the assistant conversation). node_modules is never present
 * (modules take no deps by contract) but is skipped defensively.
 */
export function exportModuleZip(id) {
  const mod = requireSource(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  const root = path.resolve(mod.dir);
  const entries = [];
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.isSymbolicLink()) continue; // no secrets, chat, or deps
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs, rel); continue; }
      if (fs.statSync(abs).size > MAX_FILE) continue; // skip anything oversized for the editor
      entries.push({ name: `${id}/${rel}`, data: fs.readFileSync(abs) });
    }
  };
  walk(root, '');
  if (!entries.length) throw new Error('Module folder is empty');
  return { name: id, entries };
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
    // Observe only response metadata, before serialization. Never buffer or retain tool payloads.
    if (req.body?.method === 'tools/call' && req.body.id != null) {
      const started = performance.now();
      const requestedTool = req.body.params?.name;
      const tool = registeredToolNames.get(server)?.has(requestedTool) && /^[a-zA-Z0-9_.:-]{1,128}$/.test(requestedTool) ? requestedTool : '(invalid)';
      const requestId = req.body.id;
      let outcome = false;
      const send = transport.send.bind(transport);
      transport.send = async (message, ...args) => {
        if (message.id === requestId) outcome = !message.error && Boolean(message.result) && message.result.isError !== true;
        return send(message, ...args);
      };
      res.once('finish', () => recordUsage({ time: new Date().toISOString(), instanceId: mod.id,
        moduleId: mod.sourceId || mod.id, tool, durationMs: performance.now() - started,
        ok: outcome && res.statusCode >= 200 && res.statusCode < 300 }));
    }
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
  if (getModuleBySlug(slug) || getModuleById(slug) || Object.hasOwn(getState().mcps, slug)) throw new Error(`slug '${slug}' is already in use`);
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
  const mod = requireSource(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  if (getInstancesFor(id).length > 1) throw new Error('Remove account instances explicitly before deleting their shared source');
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
  if (String(rel).replace(/\\/g, '/').split('/').some((part) => part.startsWith('.') && part !== '.')) {
    throw new Error('Dot-files and parent paths are station-managed and not editable');
  }
  const p = path.resolve(mod.dir, rel);
  if (!p.startsWith(path.resolve(mod.dir) + path.sep) && p !== path.resolve(mod.dir)) {
    throw new Error('Path escapes the module folder');
  }
  let cursor = path.resolve(mod.dir);
  for (const part of path.relative(cursor, p).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Symlinks are not editable module files');
    } catch (e) {
      if (e.code === 'ENOENT') break;
      throw e;
    }
  }
  let existing = p;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const real = fs.realpathSync(existing);
  const root = fs.realpathSync(mod.dir);
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error('Symlink escapes the module folder');
  return p;
}

export function listModuleFiles(id) {
  const mod = requireSource(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  const out = [];
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else out.push({ path: rel, size: fs.statSync(path.join(dir, e.name)).size });
    }
  };
  walk(mod.dir, '');
  return out;
}

export function readModuleFile(id, rel) {
  const mod = requireSource(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  const p = jail(mod, rel);
  if (!EDITABLE.test(p)) throw new Error('Only .js/.json/.md/.txt files can be opened');
  if (fs.statSync(p).size > MAX_FILE) throw new Error('File too large for the editor');
  return fs.readFileSync(p, 'utf8');
}

export function writeModuleFile(id, rel, content) {
  const mod = requireSource(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  const p = jail(mod, rel);
  if (!EDITABLE.test(p)) throw new Error('Only .js/.json/.md/.txt files can be written');
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE) throw new Error('Content too large (512 KB max)');
  if (p === path.resolve(mod.dir, 'manifest.json')) {
    const manifest = ManifestSchema.parse(JSON.parse(content));
    if (manifest.id !== mod.id) throw new Error('Changing a source module id is not supported');
    if (RESERVED_SLUGS.has(manifest.slug) || (getModuleBySlug(manifest.slug) && getModuleBySlug(manifest.slug).id !== id)) {
      throw new Error('Manifest slug is reserved or already in use');
    }
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  log('mcp', `Wrote ${id}/${rel} — reload modules to apply`);
}

/* ── Per-module assistant chat, stored in the module's own folder ─────── */
const CHAT_FILE = '.chat.json'; // dot-prefixed: listModuleFiles skips it, so it never shows as a tab

export function readModuleChat(id) {
  const mod = requireSource(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(mod.dir, CHAT_FILE), 'utf8'));
    return Array.isArray(parsed.messages) ? parsed.messages : [];
  } catch {
    return [];
  }
}

export function writeModuleChat(id, messages) {
  const mod = requireSource(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  const clean = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && typeof m.content === 'string')
    .slice(-60)
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.slice(0, 60_000) }));
  fs.writeFileSync(path.join(mod.dir, CHAT_FILE), JSON.stringify({ messages: clean }, null, 2));
  return clean;
}

/** The module's editable files inlined, for the assistant's system prompt. Every file is headed
 * with its line count so the model knows the size of what it is editing; a file that overruns
 * the budget is cut at a line boundary with a pointer to read_module_file for the rest, so the
 * model never assumes it has seen the end. */
export function moduleSource(id, budget = 240_000) {
  const mod = requireSource(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  const out = [];
  let left = budget;
  for (const f of listModuleFiles(id)) {
    if (!EDITABLE.test(f.path)) continue;
    let content;
    try { content = fs.readFileSync(path.join(mod.dir, f.path), 'utf8'); } catch { continue; }
    const lines = content.split('\n').length;
    if (left <= 0) {
      out.push(`### ${f.path} (${lines} lines — NOT inlined, budget exhausted; call read_module_file to see it)`);
      continue;
    }
    let note = '';
    if (content.length > left) {
      const cut = content.lastIndexOf('\n', left);
      const shown = content.slice(0, cut > 0 ? cut : left);
      const shownLines = shown.split('\n').length;
      note = `\n… [truncated after line ${shownLines} of ${lines} — call read_module_file with start_line: ${shownLines + 1} for the rest]`;
      content = shown;
    }
    left -= content.length;
    out.push(`### ${f.path} (${lines} lines, ${Buffer.byteLength(content, 'utf8').toLocaleString()} bytes${note ? ' — TRUNCATED below' : ''})\n\`\`\`\n${content}${note}\n\`\`\``);
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
