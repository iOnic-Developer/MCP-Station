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
import fs from 'node:fs';
import { cfg, ROOT } from './lib/env.js';
import * as fileShares from './lib/fileShares.js';
import { zipFiles } from './lib/zip.js';
import { initKey, encrypt, decrypt, randomToken } from './lib/crypto.js';
import { loadState, getState, save, persist, gc } from './lib/state.js';
import { log, getLogs } from './lib/log.js';
import * as auth from './lib/auth.js';
import * as oauth from './lib/oauth.js';
import * as host from './lib/mcpHost.js';
import * as assistant from './lib/assistant.js';
import * as backup from './lib/backup.js';

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: false }));

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

app.get('/healthz', (req, res) => {
  const mods = [...host.getModules().values()];
  res.json({ ok: true, version: cfg.version, modules: mods.filter((m) => !m.error).length, oauth: oauth.oauthEnabled() });
});

if (oauth.oauthEnabled()) oauth.mountOAuth(app);

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
  const hasAssistantKey = Boolean(assistant.getApiKey());
  res.json({
    authed: Boolean(auth.readSession(req)),
    version: cfg.version,
    publicUrl: cfg.publicUrl,
    oauth: oauth.oauthEnabled(),
    mcpTokenSet: Boolean(cfg.mcpToken),
    passwordSet: Boolean(cfg.appPassword),
    hasAssistantKey,
    hasAnthropicKey: hasAssistantKey,
    provider: assistant.getProvider(),
    model: assistant.getModel()
  });
});

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
      clients: m.manifest ? oauth.listConnections(m.manifest.slug).length : 0,
      lastTest: reg.lastTest || null,
      settings,
      url: `${oauth.baseUrl(req)}/${m.manifest?.slug || m.id}/mcp`
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
  } catch (e) { res.status(400).json({ error: e.message }); }
});

api.patch('/mcps/:id', (req, res) => {
  try {
    const st = getState();
    const id = req.params.id;
    if (!st.mcps[id]) return res.status(404).json({ error: `Unknown MCP '${id}'` });
    if (typeof req.body?.enabled === 'boolean') host.setEnabled(id, req.body.enabled);
    if (req.body?.settings && typeof req.body.settings === 'object') {
      host.saveSettings(id, req.body.settings);
      st.mcps[id].lastTest = null;
      save();
    }
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

api.delete('/mcps/:id', async (req, res) => {
  try {
    host.deleteModule(req.params.id);
    await host.loadModules();
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

api.post('/mcps/:id/test', async (req, res) => {
  const mod = host.getModuleById(req.params.id);
  if (!mod) return res.status(404).json({ error: 'Unknown MCP' });
  let result;
  if (mod.error) result = { ok: false, message: `Load error: ${mod.error}` };
  else if (!mod.test) result = { ok: true, message: 'Module loads fine (no test() export — add one for a real connectivity check).' };
  else {
    try {
      const out = await mod.test(host.getSettingsFor(mod.id), { fetchJson: host.fetchJson });
      result = { ok: out?.ok !== false, message: out?.message || 'Test passed' };
    } catch (e) { result = { ok: false, message: e.message }; }
  }
  const reg = getState().mcps[mod.id];
  if (reg) { reg.lastTest = { ok: result.ok, message: String(result.message).slice(0, 300), at: new Date().toISOString() }; save(); }
  res.json(result);
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
  } catch (e) { res.status(400).json({ error: e.message }); }
});

api.get('/mcps/:id/skill', async (req, res) => {
  try {
    const { name, content } = await host.buildSkillMd(req.params.id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-skill.zip"`);
    res.send(zipFiles([{ name: `${name}/SKILL.md`, data: content }]));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

api.post('/mcps/:id/skill/share', async (req, res) => {
  try {
    const { name, content } = await host.buildSkillMd(req.params.id);
    const root = path.join(cfg.dataDir, 'skills');
    const abs = path.join(root, `${name}-SKILL.md`);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(abs, content);
    const share = fileShares.createShare({ rootDir: root, absPath: abs, ttlMs: fileShares.parseTtl(req.body?.expires_in ?? '7d') });
    log('mcp', `Shared skill for '${req.params.id}' at /f/${share.token.slice(0, 8)}…`);
    res.json(share);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

api.get('/mcps/:id/export-module', (req, res) => {
  try {
    const { name, entries } = host.exportModuleZip(req.params.id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-module.zip"`);
    res.send(zipFiles(entries));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

api.get('/mcps/:id/capabilities', async (req, res) => {
  try { res.json(await host.describeModule(req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

api.post('/mcps/:id/token', (req, res) => {
  try {
    const token = host.setModuleToken(req.params.id, randomToken(32));
    res.json({ ok: true, token });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
api.delete('/mcps/:id/token', (req, res) => {
  try { host.setModuleToken(req.params.id, ''); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
api.get('/mcps/:id/connections', (req, res) => {
  const mod = host.getModuleById(req.params.id);
  if (!mod?.manifest) return res.status(404).json({ error: 'Unknown MCP' });
  res.json({ connections: oauth.listConnections(mod.manifest.slug) });
});
api.delete('/connections/:handle', (req, res) => {
  try { oauth.revokeConnection(req.params.handle); res.json({ ok: true }); }
  catch (e) { res.status(404).json({ error: e.message }); }
});

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

api.get('/instructions', (req, res) => res.json({ instructions: getState().instructions }));
api.put('/instructions', (req, res) => {
  const st = getState();
  st.instructions = String(req.body?.instructions || '').slice(0, 200_000);
  save();
  res.json({ ok: true });
});
api.post('/instructions/reset', (req, res) => res.json({ ok: true, instructions: assistant.resetInstructions() }));
api.post('/assistant', assistant.handleChat);

api.get('/global', (req, res) => {
  const st = getState();
  res.json({
    provider: assistant.getProvider(),
    openaiModel: st.global.openaiModel || cfg.openaiModel,
    openaiApiKey: st.global.openaiApiKey ? '••••••' : '',
    openaiEnvKeySet: Boolean(cfg.openaiApiKey),
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
  if (['openai', 'anthropic', 'gemini'].includes(b.provider)) st.global.provider = b.provider;
  if (typeof b.openaiModel === 'string' && b.openaiModel.trim()) st.global.openaiModel = b.openaiModel.trim();
  if (typeof b.openaiApiKey === 'string' && b.openaiApiKey !== '••••••') {
    st.global.openaiApiKey = b.openaiApiKey ? encrypt(b.openaiApiKey.trim()) : '';
  }
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
  } catch (e) { res.status(400).json({ error: e.message }); }
});
api.post('/restore/:name', async (req, res) => {
  try { res.json(await backup.restoreBackup({ name: req.params.name })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

api.get('/logs', (req, res) => res.json({ logs: getLogs() }));

app.get('/f/:token', (req, res) => {
  const hit = fileShares.resolveShare(req.params.token);
  if (!hit) {
    log('files', `share miss /f/${String(req.params.token).slice(0, 8)}… → 404 (unknown/expired/removed)`);
    return res.status(404).send('This link is invalid or has expired.');
  }
  res.setHeader('Content-Type', hit.contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${hit.name.replace(/[^\w.\-]+/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(hit.abs)
    .on('error', () => { if (!res.headersSent) res.status(500).end(); })
    .pipe(res);
});

app.use(express.static(path.join(ROOT, 'public'), {
  index: 'index.html',
  etag: true,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));

app.all(['/:slug/mcp', '/:slug'], (req, res, next) => {
  if (!host.getModuleBySlug(req.params.slug)) return next();
  if (req.method === 'OPTIONS') return res.status(204).end();
  const authType = req.headers.authorization ? 'bearer' : 'NONE';
  const ua = String(req.headers['user-agent'] || '-').slice(0, 60);
  const method = req.method;
  const rpc = req.body?.method || '-';
  res.on('finish', () => {
    log('mcp', `${method} ${req.path} → ${res.statusCode} (auth=${authType}, rpc=${rpc}, ua=${ua})`);
  });
  oauth.bearerGate(req, res, () => host.handleMcpRequest(req, res));
});

app.use((req, res) => {
  const authType = req.headers.authorization ? 'bearer' : 'NONE';
  const ua = String(req.headers['user-agent'] || '-').slice(0, 60);
  log('mcp', `${req.method} ${req.path} → 404 no such path (auth=${authType}, ua=${ua})`);
  res.status(404).json({ error: `Nothing here. Hosted MCPs: ${[...host.getModules().keys()].map((s) => `/${s}/mcp`).join(', ') || '(none)'}` });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const type = err?.type;
  let status = err?.status || err?.statusCode || 500;
  let message = 'Internal server error';
  if (type === 'entity.parse.failed') { status = 400; message = 'Malformed JSON in request body'; }
  else if (type === 'entity.too.large') { status = 413; message = 'Request body too large'; }
  else if (type === 'charset.unsupported' || type === 'encoding.unsupported') { status = 415; message = 'Unsupported request encoding'; }
  else if (status >= 400 && status < 500) { message = err.message || 'Bad request'; }
  log('http', `${req.method} ${req.path} → ${status} ${type || err?.name || 'error'}: ${String(err?.message || '').slice(0, 200)}`);
  res.status(status).json({ error: message });
});

async function main() {
  initKey();
  loadState();
  assistant.ensureInstructions();
  await host.loadModules();

  if (!cfg.appPassword) log('boot', '⚠ APP_PASSWORD is not set — the admin UI and OAuth approvals are locked out until you set it.');
  if (!cfg.publicUrl) log('boot', '⚠ PUBLIC_URL is not set — OAuth is off; claude.ai connectors will not work (MCP_TOKEN bearer still does).');
  if (cfg.mcpToken) log('boot', 'Static MCP_TOKEN bearer is enabled.');
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

async function verifyPublicUrl() {
  if (!cfg.publicUrl) return;
  const target = `${cfg.publicUrl}/healthz`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(target, { redirect: 'manual', signal: ctrl.signal });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location') || '';
      let hostName = loc; try { hostName = new URL(loc).host; } catch { /* keep raw */ }
      return log('boot', `⚠ PUBLIC_URL (${cfg.publicUrl}) REDIRECTS to ${hostName || loc} — claude.ai cannot reach the station through it. Point PUBLIC_URL at the host that serves the station directly.`);
    }
    if (!r.ok) return log('boot', `⚠ PUBLIC_URL self-check: ${target} → HTTP ${r.status} (not 200). claude.ai's discovery will fail here — check the host/proxy.`);
    const j = await r.json().catch(() => null);
    if (j && j.ok) return log('boot', `✅ PUBLIC_URL verified — ${cfg.publicUrl} reaches this station (v${j.version}).`);
    log('boot', `⚠ PUBLIC_URL (${cfg.publicUrl}) answered 200 but not with this station's /healthz — it may point at a different service.`);
  } catch (e) {
    log('boot', `Note: couldn't self-verify PUBLIC_URL from inside the container (${e.name === 'AbortError' ? 'timeout' : e.message}). Often just split-horizon DNS — verify externally: curl ${target}`);
  } finally { clearTimeout(t); }
}

main().catch((e) => {
  console.error('Fatal boot error:', e);
  process.exit(1);
});
