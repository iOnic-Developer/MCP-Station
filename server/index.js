/**
 * MCP Station — entry point.
 * Route map:
 *   GET  /healthz                                   liveness
 *   *    /.well-known/…, /register, /authorize,     OAuth 2.1 (see lib/oauth.js)
 *        /oauth/approve, /token, /revoke
 *   *    /api/…                                     admin API (session + CSRF)
 *   GET  /  + /assets/…                             admin UI (static)
 *   POST /<slug>                                    hosted MCP endpoints (bearer)
 */
import express from 'express';
import path from 'node:path';
import { cfg, ROOT } from './lib/env.js';
import { initKey, encrypt, decrypt, randomToken } from './lib/crypto.js';
import { loadState, getState, save, persist, gc } from './lib/state.js';
import { log, getLogs } from './lib/log.js';
import * as auth from './lib/auth.js';
import * as oauth from './lib/oauth.js';
import * as host from './lib/mcpHost.js';
import * as assistant from './lib/assistant.js';
import * as backup from './lib/backup.js';

const app = express();
// Deliberately NO `trust proxy` and NO x-powered-by suppression: the working SiYuan Companion
// sets neither, and the mandate is a machine surface indistinguishable from it. (`trust proxy`
// only fed rate-limit keys — and its absence silences the express-rate-limit ValidationError
// spam; the Companion runs the same shared-bucket behaviour behind the same proxy.)
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: false }));

/* ── Security headers for the admin UI only ──────────────────────────── */
// The hand-rolled CORS layer for the OAuth/MCP surfaces is GONE on purpose. The Companion serves
// zero CORS headers on /mcp and only the SDK's own cors() on /token, /register, /revoke and the
// metadata routes — and it connects. Ours now does exactly the same: the SDK router carries its
// own CORS; the MCP endpoints carry none. (v1.3.3 added this layer chasing the connector bug; it
// was never the cause, and it was the last header-level difference from the working server.)
app.use((req, res, next) => {
  const machine = req.path.startsWith('/.well-known/')
    || ['/register', '/token', '/revoke', '/authorize', '/oauth/approve'].includes(req.path)
    || Boolean(host.getModuleBySlug(req.path.slice(1)));
  if (!machine) {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
  }
  next();
});

/* ── Health ──────────────────────────────────────────────────────────── */
app.get('/healthz', (req, res) => {
  const mods = [...host.getModules().values()];
  res.json({ ok: true, version: cfg.version, modules: mods.filter((m) => !m.error).length, oauth: oauth.oauthEnabled() });
});

/* ── OAuth 2.1 ─────────────────────────────────────────────────────────
 * Discovery / DCR / authorize / token / revoke are served by the MCP SDK's own mcpAuthRouter (the
 * exact code the working SiYuan Companion runs), plus our per-slug protected-resource metadata and
 * /oauth/approve consent step — all wired in mountOAuth(). Only mounted when PUBLIC_URL is set. */
if (oauth.oauthEnabled()) oauth.mountOAuth(app);

/* ── Auth (admin UI) ─────────────────────────────────────────────────── */
app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!cfg.appPassword) return res.status(503).json({ error: 'APP_PASSWORD is not set on the server — set it and restart.' });
  if (!auth.checkRate(ip)) return res.status(429).json({ error: 'Too many attempts — wait a minute.' });
  if (!auth.verifyPassword(req.body?.password)) {
    auth.noteFail(ip);
    return res.status(401).json({ error: 'Wrong password' });
  }
  auth.createSession(res);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({
    authed: Boolean(auth.readSession(req)),
    version: cfg.version,
    publicUrl: cfg.publicUrl,
    oauth: oauth.oauthEnabled(),
    mcpTokenSet: Boolean(cfg.mcpToken),
    passwordSet: Boolean(cfg.appPassword),
    hasAnthropicKey: Boolean(assistant.getApiKey()),
    provider: assistant.getProvider(),
    model: assistant.getModel()
  });
});

/* ── Admin API (session-gated) ───────────────────────────────────────── */
const api = express.Router();
app.use('/api', (req, res, next) => {
  if (['/login', '/logout', '/me'].includes(req.path)) return next();
  return auth.requireSession(req, res, () => api(req, res, next));
});

function mcpListing(req) {
  const st = getState();
  return [...host.getModules().values()].map((m) => {
    const reg = st.mcps[m.id] || {};
    const settings = {};
    for (const s of m.manifest?.settings || []) {
      const raw = reg.settings?.[s.key];
      settings[s.key] = s.type === 'secret'
        ? (raw ? '••••••' : '')
        : (raw != null && raw !== '' ? decrypt(raw) : (s.default ?? ''));
    }
    return {
      id: m.id,
      manifest: m.manifest,
      error: m.error,
      enabled: Boolean(reg.enabled),
      configured: m.manifest ? host.isConfigured(m.id) : false,
      tokenSet: Boolean(reg.token),
      settings,
      url: `${oauth.baseUrl(req)}/${m.manifest?.slug || m.id}`
    };
  }).sort((a, b) => (a.manifest?.name || a.id).localeCompare(b.manifest?.name || b.id));
}

api.get('/mcps', (req, res) => res.json({ mcps: mcpListing(req) }));

api.post('/mcps', async (req, res) => {
  try {
    const { name, slug, description, icon } = req.body || {};
    const created = host.createModule({ name, slug, description, icon });
    await host.loadModules();
    res.status(201).json({ ok: true, ...created });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

api.patch('/mcps/:id', (req, res) => {
  try {
    const st = getState();
    const id = req.params.id;
    if (!st.mcps[id]) return res.status(404).json({ error: `Unknown MCP '${id}'` });
    if (typeof req.body?.enabled === 'boolean') host.setEnabled(id, req.body.enabled);
    if (req.body?.settings && typeof req.body.settings === 'object') {
      host.saveSettings(id, req.body.settings);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

api.delete('/mcps/:id', async (req, res) => {
  try {
    host.deleteModule(req.params.id);
    await host.loadModules();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

api.post('/mcps/:id/test', async (req, res) => {
  const mod = host.getModuleById(req.params.id);
  if (!mod) return res.status(404).json({ error: 'Unknown MCP' });
  if (mod.error) return res.json({ ok: false, message: `Load error: ${mod.error}` });
  if (!mod.test) return res.json({ ok: true, message: 'Module loads fine (no test() export — add one for a real connectivity check).' });
  try {
    const out = await mod.test(host.getSettingsFor(mod.id), { fetchJson: host.fetchJson });
    res.json({ ok: out?.ok !== false, message: out?.message || 'Test passed' });
  } catch (e) {
    res.json({ ok: false, message: e.message });
  }
});

api.get('/mcps/:id/files', (req, res) => {
  try { res.json({ files: host.listModuleFiles(req.params.id) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

api.get('/mcps/:id/file', (req, res) => {
  try { res.json({ path: req.query.path, content: host.readModuleFile(req.params.id, String(req.query.path || '')) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

api.put('/mcps/:id/file', (req, res) => {
  try {
    host.writeModuleFile(req.params.id, String(req.body?.path || ''), String(req.body?.content ?? ''));
    res.json({ ok: true, note: 'Saved — hit Reload modules to apply.' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* What this MCP can do — introspected by running it, not by reading its source */
api.get('/mcps/:id/capabilities', async (req, res) => {
  try { res.json(await host.describeModule(req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

/* Per-MCP access: its own bearer token + the live OAuth connections that can reach it */
api.post('/mcps/:id/token', (req, res) => {
  try {
    const token = host.setModuleToken(req.params.id, randomToken(32));
    res.json({ ok: true, token }); // shown once — only the encrypted copy is kept
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
api.delete('/mcps/:id/token', (req, res) => {
  try {
    host.setModuleToken(req.params.id, '');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
api.get('/mcps/:id/connections', (req, res) => {
  const mod = host.getModuleById(req.params.id);
  if (!mod?.manifest) return res.status(404).json({ error: 'Unknown MCP' });
  res.json({ connections: oauth.listConnections(mod.manifest.slug) });
});
api.delete('/connections/:handle', (req, res) => {
  try {
    oauth.revokeConnection(req.params.handle);
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

/* Per-MCP assistant chat — history lives in the module's own folder (.chat.json) */
api.get('/mcps/:id/chat', (req, res) => {
  try { res.json({ messages: host.readModuleChat(req.params.id) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
api.put('/mcps/:id/chat', (req, res) => {
  try { res.json({ ok: true, messages: host.writeModuleChat(req.params.id, req.body?.messages) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

api.post('/reload', async (req, res) => {
  await host.loadModules();
  res.json({ ok: true, mcps: mcpListing(req) });
});

/* Assistant */
api.get('/instructions', (req, res) => res.json({ instructions: getState().instructions }));
api.put('/instructions', (req, res) => {
  const st = getState();
  st.instructions = String(req.body?.instructions || '').slice(0, 200_000);
  save();
  res.json({ ok: true });
});
api.post('/assistant', assistant.handleChat);

/* Global settings */
api.get('/global', (req, res) => {
  const st = getState();
  res.json({
    provider: assistant.getProvider(),
    anthropicModel: st.global.anthropicModel || cfg.anthropicModel,
    anthropicApiKey: st.global.anthropicApiKey ? '••••••' : '',
    envKeySet: Boolean(cfg.anthropicApiKey),
    geminiModel: st.global.geminiModel || cfg.geminiModel,
    geminiApiKey: st.global.geminiApiKey ? '••••••' : '',
    geminiEnvKeySet: Boolean(cfg.geminiApiKey)
  });
});
api.put('/global', (req, res) => {
  const st = getState();
  const b = req.body || {};
  if (b.provider === 'anthropic' || b.provider === 'gemini') st.global.provider = b.provider;
  if (typeof b.anthropicModel === 'string' && b.anthropicModel.trim()) st.global.anthropicModel = b.anthropicModel.trim();
  if (typeof b.anthropicApiKey === 'string' && b.anthropicApiKey !== '••••••') {
    st.global.anthropicApiKey = b.anthropicApiKey ? encrypt(b.anthropicApiKey.trim()) : '';
  }
  if (typeof b.geminiModel === 'string' && b.geminiModel.trim()) st.global.geminiModel = b.geminiModel.trim();
  if (typeof b.geminiApiKey === 'string' && b.geminiApiKey !== '••••••') {
    st.global.geminiApiKey = b.geminiApiKey ? encrypt(b.geminiApiKey.trim()) : '';
  }
  save();
  res.json({ ok: true });
});

/* Import / export / backup */
api.get('/export', (req, res) => {
  const data = backup.exportConfig(req.query.secrets === '1');
  res.setHeader('Content-Disposition', `attachment; filename="mcp-station-export-${Date.now()}.json"`);
  res.json(data);
});
api.post('/import', (req, res) => {
  try { res.json(backup.importConfig(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
api.post('/backup', async (req, res) => {
  try { res.json(await backup.createBackup()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
api.get('/backups', (req, res) => res.json({ backups: backup.listBackups() }));
api.get('/backups/:name', (req, res) => {
  try { res.download(backup.backupPath(req.params.name)); }
  catch (e) { res.status(404).json({ error: e.message }); }
});
api.post('/restore', express.raw({ type: ['application/gzip', 'application/x-gzip', 'application/octet-stream'], limit: '200mb' }), async (req, res) => {
  try {
    if (req.body?.length > 100) return res.json(await backup.restoreBackup({ buffer: req.body }));
    return res.status(400).json({ error: 'Upload a .tar.gz backup as the request body' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
api.post('/restore/:name', async (req, res) => {
  try { res.json(await backup.restoreBackup({ name: req.params.name })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

api.get('/logs', (req, res) => res.json({ logs: getLogs() }));

/* ── Static UI ───────────────────────────────────────────────────────── */
// no-cache = "revalidate every load" (ETags still make that a cheap 304). The SPA's assets are
// unversioned, so any max-age served a stale app.js/app.css for that long after every redeploy.
app.use(express.static(path.join(ROOT, 'public'), {
  index: 'index.html',
  etag: true,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));

/* ── Hosted MCP endpoints (must stay last) ───────────────────────────── */
app.all('/:slug', (req, res, next) => {
  if (!host.getModuleBySlug(req.params.slug)) return next();
  // Log EVERY MCP request and its outcome. A successful call used to log nothing, which left a
  // blind spot exactly where connectors were failing: we could see a token issued and then silence,
  // with no way to tell "the client never called" from "the call arrived and something ate it".
  const auth = req.headers.authorization ? 'bearer' : 'NONE';
  const ua = String(req.headers['user-agent'] || '-').slice(0, 60);
  const method = req.method;
  const rpc = req.body?.method || '-';
  res.on('finish', () => {
    log('mcp', `${method} /${req.params.slug} → ${res.statusCode} (auth=${auth}, rpc=${rpc}, ua=${ua})`);
  });
  oauth.bearerGate(req, res, () => host.handleMcpRequest(req, res));
});

app.use((req, res) => {
  // Log the misses too — an authenticated call to a wrong/stale path used to vanish without a
  // trace, which read as "claude.ai never called" when it actually called the wrong URL.
  const auth = req.headers.authorization ? 'bearer' : 'NONE';
  const ua = String(req.headers['user-agent'] || '-').slice(0, 60);
  log('mcp', `${req.method} ${req.path} → 404 no such path (auth=${auth}, ua=${ua})`);
  res.status(404).json({ error: `Nothing here. Hosted MCPs: ${[...host.getModules().keys()].map((s) => '/' + s).join(', ') || '(none)'}` });
});

/* ── Boot ────────────────────────────────────────────────────────────── */
async function main() {
  initKey();
  loadState();
  assistant.ensureInstructions();
  await host.loadModules();

  if (!cfg.appPassword) log('boot', '⚠ APP_PASSWORD is not set — the admin UI and OAuth approvals are locked out until you set it.');
  if (!cfg.publicUrl) log('boot', '⚠ PUBLIC_URL is not set — OAuth is off; claude.ai connectors will not work (MCP_TOKEN bearer still does).');
  if (cfg.mcpToken) log('boot', 'Static MCP_TOKEN bearer is enabled.');
  // Surface OAuth-store durability: if this shows 0 clients/tokens right after you had a live
  // connector, DATA_DIR is NOT on a persistent volume and every restart is wiping the connection.
  const oa = getState().oauth;
  const nClients = Object.keys(oa.clients || {}).length;
  const nTokens = Object.keys(oa.tokens || {}).length;
  const nRefresh = Object.keys(oa.refresh || {}).length;
  log('boot', `OAuth store loaded from ${cfg.dataDir}/station.json — ${nClients} client(s), ${nTokens} access + ${nRefresh} refresh token(s). If this is 0 after you connected, DATA_DIR is not a persistent volume.`);
  verifyPublicUrl();

  setInterval(gc, 10 * 60_000).unref();
  process.on('SIGTERM', () => { persist(); process.exit(0); });
  process.on('SIGINT', () => { persist(); process.exit(0); });

  app.listen(cfg.port, () => {
    log('boot', `MCP Station v${cfg.version} on :${cfg.port} — UI at / · MCPs at /<slug> · OAuth ${oauth.oauthEnabled() ? 'ON' : 'off'}`);
  });
}

/* PUBLIC_URL self-check — catches the #1 silent connector failure: PUBLIC_URL pointing at a host
 * that isn't actually this station (an auth wall like Cloudflare Access, the wrong subdomain, or a
 * proxy misroute). PUBLIC_URL is the OAuth issuer and the base of every URL claude.ai is told to
 * call, so if it doesn't land back here, discovery/token silently fail and claude.ai reports a
 * generic "authorization failed". We fetch our own advertised /healthz and say plainly whether it
 * reaches us. Never fatal — split-horizon DNS can legitimately block the loopback, so a connection
 * error is only a soft note, but a redirect is the smoking gun and gets flagged loudly. */
async function verifyPublicUrl() {
  if (!cfg.publicUrl) return;
  const target = `${cfg.publicUrl}/healthz`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(target, { redirect: 'manual', signal: ctrl.signal });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location') || '';
      let host = loc; try { host = new URL(loc).host; } catch { /* keep raw */ }
      return log('boot', `⚠ PUBLIC_URL (${cfg.publicUrl}) REDIRECTS to ${host || loc} — claude.ai cannot reach the station through it. An auth wall (e.g. Cloudflare Access) or the wrong host fails every connector. Point PUBLIC_URL at the host that serves the station directly.`);
    }
    if (!r.ok) return log('boot', `⚠ PUBLIC_URL self-check: ${target} → HTTP ${r.status} (not 200). claude.ai's discovery will fail here — check the host/proxy.`);
    const j = await r.json().catch(() => null);
    if (j && j.ok) return log('boot', `✅ PUBLIC_URL verified — ${cfg.publicUrl} reaches this station (v${j.version}).`);
    log('boot', `⚠ PUBLIC_URL (${cfg.publicUrl}) answered 200 but not with this station's /healthz — it may point at a different service.`);
  } catch (e) {
    log('boot', `Note: couldn't self-verify PUBLIC_URL from inside the container (${e.name === 'AbortError' ? 'timeout' : e.message}). Often just split-horizon DNS — verify externally: curl ${target}`);
  } finally {
    clearTimeout(t);
  }
}

main().catch((e) => {
  console.error('Fatal boot error:', e);
  process.exit(1);
});
