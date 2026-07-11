/**
 * Self-hosted OAuth 2.1 authorization server — same pattern as the SiYuan
 * Companion: discovery metadata + dynamic client registration + PKCE (S256),
 * approval gated by APP_PASSWORD (or an active admin session). Lets claude.ai
 * (web + phone) add any hosted MCP as a custom connector by URL.
 *
 * Endpoints: /.well-known/oauth-authorization-server,
 * /.well-known/oauth-protected-resource[/:slug], /register, /authorize,
 * /oauth/approve, /token, /revoke.
 *
 * MCP endpoints accept EITHER a valid OAuth access token OR the static
 * MCP_TOKEN env value (dual auth, for Claude Code CLI and scripts).
 */
import { cfg } from './env.js';
import { getState, save } from './state.js';
import { randomToken, sha256b64url, timingEqual } from './crypto.js';
import { verifyPassword, readSession, checkRate, noteFail } from './auth.js';
import { log } from './log.js';

const CODE_TTL = 10 * 60_000;
const ACCESS_TTL = 30 * 24 * 3600_000;   // 30 days
const REFRESH_TTL = 180 * 24 * 3600_000; // 180 days

export function baseUrl(req) {
  if (cfg.publicUrl) return cfg.publicUrl;
  return `${req.protocol}://${req.get('host')}`;
}

export const oauthEnabled = () => Boolean(cfg.publicUrl);

/* ── Discovery metadata ──────────────────────────────────────────────── */
export function asMetadata(req, res) {
  const base = baseUrl(req);
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    revocation_endpoint: `${base}/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: ['mcp'],
    service_documentation: 'https://github.com/iOnic-Developer/MCP-Station'
  });
}

export function protectedResourceMetadata(req, res) {
  const base = baseUrl(req);
  const slug = req.params.slug || '';
  res.json({
    resource: slug ? `${base}/${slug}` : base,
    authorization_servers: [base],
    scopes_supported: ['mcp'],
    bearer_methods_supported: ['header'],
    resource_name: slug ? `MCP Station — ${slug}` : 'MCP Station'
  });
}

/* ── Dynamic client registration (RFC 7591) ──────────────────────────── */
export function handleRegister(req, res) {
  const b = req.body || {};
  const redirectUris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u) => typeof u === 'string') : [];
  if (!redirectUris.length) {
    return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris is required' });
  }
  for (const u of redirectUris) {
    let url;
    try { url = new URL(u); } catch {
      return res.status(400).json({ error: 'invalid_redirect_uri', error_description: `Not a valid URL: ${u}` });
    }
    const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !localhost) {
      return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https (or localhost)' });
    }
  }
  const st = getState();
  const client_id = randomToken(16);
  st.oauth.clients[client_id] = {
    client_id,
    client_name: String(b.client_name || 'MCP client').slice(0, 120),
    redirect_uris: redirectUris.slice(0, 10),
    token_endpoint_auth_method: 'none',
    createdAt: Date.now()
  };
  save();
  log('oauth', `Registered client '${st.oauth.clients[client_id].client_name}' (${client_id})`);
  res.status(201).json({
    client_id,
    client_name: st.oauth.clients[client_id].client_name,
    redirect_uris: st.oauth.clients[client_id].redirect_uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code']
  });
}

/* ── Authorization endpoint ──────────────────────────────────────────── */
function validateAuthParams(q) {
  const st = getState();
  const client = st.oauth.clients[q.client_id];
  if (!client) return { error: 'Unknown client_id — the client must register first (dynamic registration is enabled).' };
  if (!client.redirect_uris.includes(q.redirect_uri)) return { error: 'redirect_uri does not match the registered client.' };
  if (q.response_type !== 'code') return { error: "Only response_type=code is supported." };
  if (!q.code_challenge || (q.code_challenge_method || 'S256') !== 'S256') return { error: 'PKCE with S256 code_challenge is required.' };
  return { client };
}

export function handleAuthorize(req, res) {
  if (!oauthEnabled()) return res.status(404).send('OAuth is disabled — set PUBLIC_URL on the server.');
  const q = req.query;
  const v = validateAuthParams(q);
  if (v.error) return res.status(400).send(approvalPage({ error: v.error, q, hasSession: false, invalid: true }));
  const hasSession = Boolean(readSession(req));
  res.send(approvalPage({ q, client: v.client, hasSession }));
}

export function handleApprove(req, res) {
  if (!oauthEnabled()) return res.status(404).send('OAuth is disabled.');
  const q = req.body || {};
  const v = validateAuthParams(q);
  if (v.error) return res.status(400).send(approvalPage({ error: v.error, q, hasSession: false, invalid: true }));

  if (q.deny === '1') {
    const u = new URL(q.redirect_uri);
    u.searchParams.set('error', 'access_denied');
    if (q.state) u.searchParams.set('state', q.state);
    return res.redirect(302, u.toString());
  }

  const hasSession = Boolean(readSession(req));
  if (!hasSession) {
    const ip = req.ip || 'unknown';
    if (!checkRate(ip)) return res.status(429).send(approvalPage({ error: 'Too many attempts — wait a minute and try again.', q, client: v.client, hasSession: false }));
    if (!verifyPassword(q.password)) {
      noteFail(ip);
      return res.status(401).send(approvalPage({ error: 'Wrong password.', q, client: v.client, hasSession: false }));
    }
  }

  const st = getState();
  const code = randomToken(32);
  st.oauth.codes[code] = {
    clientId: q.client_id,
    redirectUri: q.redirect_uri,
    codeChallenge: q.code_challenge,
    scope: q.scope || 'mcp',
    resource: q.resource || '',
    expiresAt: Date.now() + CODE_TTL
  };
  save();
  log('oauth', `Authorization approved for client ${q.client_id}`);
  const u = new URL(q.redirect_uri);
  u.searchParams.set('code', code);
  if (q.state) u.searchParams.set('state', q.state);
  res.redirect(302, u.toString());
}

/* ── Token endpoint ──────────────────────────────────────────────────── */
export function handleToken(req, res) {
  const b = req.body || {};
  const st = getState();

  if (b.grant_type === 'authorization_code') {
    const rec = st.oauth.codes[b.code];
    if (!rec || rec.expiresAt < Date.now()) return tokenError(res, 'invalid_grant', 'Authorization code is invalid or expired.');
    delete st.oauth.codes[b.code]; // single use
    if (rec.clientId !== b.client_id) return tokenError(res, 'invalid_grant', 'client_id mismatch.');
    if (rec.redirectUri !== b.redirect_uri) return tokenError(res, 'invalid_grant', 'redirect_uri mismatch.');
    if (!b.code_verifier || sha256b64url(b.code_verifier) !== rec.codeChallenge) {
      return tokenError(res, 'invalid_grant', 'PKCE verification failed.');
    }
    return issueTokens(res, st, rec.clientId, rec.scope, rec.resource);
  }

  if (b.grant_type === 'refresh_token') {
    const rec = st.oauth.refresh[b.refresh_token];
    if (!rec || rec.expiresAt < Date.now()) return tokenError(res, 'invalid_grant', 'Refresh token is invalid or expired.');
    delete st.oauth.refresh[b.refresh_token]; // rotate
    return issueTokens(res, st, rec.clientId, rec.scope, rec.resource);
  }

  return tokenError(res, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

function issueTokens(res, st, clientId, scope, resource) {
  const access = randomToken(32);
  const refresh = randomToken(32);
  const now = Date.now();
  st.oauth.tokens[access] = { clientId, scope, resource, createdAt: now, expiresAt: now + ACCESS_TTL };
  st.oauth.refresh[refresh] = { clientId, scope, resource, createdAt: now, expiresAt: now + REFRESH_TTL };
  save();
  res.json({
    access_token: access,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TTL / 1000),
    refresh_token: refresh,
    scope
  });
}

function tokenError(res, error, description) {
  res.status(400).json({ error, error_description: description });
}

export function handleRevoke(req, res) {
  const t = (req.body || {}).token;
  const st = getState();
  if (t) {
    delete st.oauth.tokens[t];
    delete st.oauth.refresh[t];
    save();
  }
  res.status(200).json({});
}

/* ── Bearer gate for MCP endpoints (dual auth) ───────────────────────── */
export function requireBearer(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token) {
    if (cfg.mcpToken && timingEqual(token, cfg.mcpToken)) return next();
    const t = getState().oauth.tokens[token];
    if (t && t.expiresAt > Date.now()) return next();
  }
  const slug = req.params.slug || req.path.split('/')[1] || '';
  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource/${slug}"`);
  res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: bearer token required' }, id: null });
}

/* ── Approval page (no inline JS — plain form posts) ─────────────────── */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function approvalPage({ q = {}, client = null, error = '', hasSession = false, invalid = false }) {
  const hidden = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource']
    .map((k) => `<input type="hidden" name="${k}" value="${esc(q[k] || '')}">`)
    .join('');
  let host = '';
  try { host = new URL(q.redirect_uri).host; } catch { /* ignore */ }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MCP Station — Authorize</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0b0f14;color:#e6edf3;display:grid;place-items:center;min-height:100vh}
  .card{background:#111823;border:1px solid #1f2a37;border-radius:14px;padding:32px;max-width:400px;width:calc(100% - 48px);box-shadow:0 20px 60px rgba(0,0,0,.5)}
  h1{font-size:18px;margin:0 0 6px}.sub{color:#8b98a9;font-size:13px;margin:0 0 20px;line-height:1.5}
  .who{background:#0b1420;border:1px solid #1f2a37;border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:20px;line-height:1.6}
  .who b{color:#7cc4ff}
  label{display:block;font-size:12px;color:#8b98a9;margin-bottom:6px}
  input[type=password]{width:100%;box-sizing:border-box;background:#0b1420;border:1px solid #2a3846;border-radius:8px;color:#e6edf3;padding:10px 12px;font-size:14px;margin-bottom:16px}
  .err{background:#2a1215;border:1px solid #5c2b30;color:#ff9ea3;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:16px}
  .row{display:flex;gap:10px}
  button{flex:1;border:0;border-radius:8px;padding:11px 0;font-size:14px;font-weight:600;cursor:pointer}
  .ok{background:#1f6feb;color:#fff}.no{background:#1c2733;color:#8b98a9}
  .logo{display:flex;align-items:center;gap:8px;margin-bottom:18px;font-weight:700}.logo span{color:#1f6feb}
</style></head><body>
<div class="card">
  <div class="logo">⛽ MCP <span>Station</span></div>
  <h1>Authorize connection</h1>
  <p class="sub">A client is asking for access to the MCP servers hosted here.</p>
  <div class="who"><b>${esc(client?.client_name || 'Unknown client')}</b><br>redirects to <b>${esc(host)}</b><br>scope: <b>${esc(q.scope || 'mcp')}</b></div>
  ${error ? `<div class="err">${esc(error)}</div>` : ''}
  ${invalid ? '' : `<form method="POST" action="/oauth/approve">${hidden}
    ${hasSession ? '' : `<label for="pw">Station password</label><input id="pw" type="password" name="password" autofocus autocomplete="current-password">`}
    <div class="row">
      <button class="no" name="deny" value="1">Deny</button>
      <button class="ok" type="submit">Approve</button>
    </div>
  </form>`}
</div></body></html>`;
}
