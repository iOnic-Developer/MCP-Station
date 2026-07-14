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
import { verifyPassword, checkRate, noteFail } from './auth.js';
import { getModules, getModuleBySlug, getModuleToken } from './mcpHost.js';
import { log } from './log.js';

const CODE_TTL = 10 * 60_000;
// Access token is SHORT-LIVED (1h) to match the MCP SDK exactly — claude.ai's connector rejects
// implausibly long-lived access tokens and drives its own refresh cycle. The long-lived refresh
// token below is what keeps the connection permanent (claude.ai refreshes silently, hourly).
const ACCESS_TTL = 60 * 60_000;          // 1 hour (was 30 days — claude.ai refused it)
const REFRESH_TTL = 180 * 24 * 3600_000; // 180 days

export function baseUrl(req) {
  if (cfg.publicUrl) return cfg.publicUrl;
  return `${req.protocol}://${req.get('host')}`;
}

export const oauthEnabled = () => Boolean(cfg.publicUrl);

/* ── Per-MCP scoping ──────────────────────────────────────────────────────
 * A token is bound to ONE mcp slug ('' = every MCP, chosen explicitly on the
 * approval page). Clients that send RFC 8707 `resource` get bound automatically;
 * clients that don't, ask the human on the approval page. Enforced in requireBearer.
 */
export function slugFromResource(resource) {
  try {
    const u = new URL(String(resource));
    // The resource must name an MCP on THIS station (RFC 8707). A resource pointing at some other
    // host is not ours to interpret — ignore it and let the human choose on the approval page.
    if (cfg.publicUrl && u.origin !== new URL(cfg.publicUrl).origin) return '';
    const seg = u.pathname.replace(/^\/+/, '').split('/')[0] || '';
    return getModuleBySlug(seg) ? seg : '';
  } catch {
    return '';
  }
}

/** Short, stable handle for a token — lets the UI list and revoke without ever holding the secret. */
const tokenHandle = (t) => sha256b64url(t).slice(0, 12);

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
  // Echo the client's registered metadata back, as RFC 7591 §3.2.1 requires and as the MCP SDK's
  // own DCR handler does. Returning a lossy subset (dropping `scope`, omitting client_id_issued_at)
  // leaves the client with a different view of the registration than the server has.
  const client = {
    client_id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: String(b.client_name || 'MCP client').slice(0, 120),
    redirect_uris: redirectUris.slice(0, 10),
    grant_types: Array.isArray(b.grant_types) ? b.grant_types : ['authorization_code', 'refresh_token'],
    response_types: Array.isArray(b.response_types) ? b.response_types : ['code'],
    token_endpoint_auth_method: b.token_endpoint_auth_method === 'client_secret_post' ? 'client_secret_post' : 'none',
    ...(typeof b.scope === 'string' ? { scope: b.scope } : {}),
    ...(typeof b.client_uri === 'string' ? { client_uri: b.client_uri } : {}),
    ...(typeof b.logo_uri === 'string' ? { logo_uri: b.logo_uri } : {}),
    ...(typeof b.software_id === 'string' ? { software_id: b.software_id } : {}),
    ...(typeof b.software_version === 'string' ? { software_version: b.software_version } : {})
  };
  st.oauth.clients[client_id] = { ...client, createdAt: Date.now() };
  save();
  log('oauth', `DCR: registered '${client.client_name}' (${client_id}) scope='${b.scope || '-'}' redirect=${redirectUris[0]}`);
  res.status(201).json(client);
}

/* ── Authorization endpoint ──────────────────────────────────────────── */
/**
 * Two classes of failure, and OAuth 2.1 (§4.1.2.1) treats them very differently:
 *  - `fatal`: the client_id or redirect_uri is untrustworthy → we must NOT redirect (that would
 *    make this an open redirector). Render the error instead.
 *  - otherwise: the redirect_uri is verified, so we MUST bounce back to the client with
 *    ?error=… — a client left waiting on a 400 HTML page just hangs, which is what claude.ai's
 *    popup did.
 */
function validateAuthParams(q) {
  const st = getState();
  const client = st.oauth.clients[q.client_id];
  if (!client) return { fatal: 'Unknown client_id — the client must register first (dynamic registration is enabled).' };
  if (!client.redirect_uris.includes(q.redirect_uri)) return { fatal: 'redirect_uri does not match the registered client.' };
  if (q.response_type !== 'code') {
    return { client, error: 'unsupported_response_type', description: 'Only response_type=code is supported.' };
  }
  if (!q.code_challenge || (q.code_challenge_method || 'S256') !== 'S256') {
    return { client, error: 'invalid_request', description: 'PKCE with S256 code_challenge is required.' };
  }
  return { client };
}

/** Bounce back to the (already verified) redirect_uri with an OAuth error, preserving state. */
function redirectError(res, q, error, description) {
  const u = new URL(q.redirect_uri);
  u.searchParams.set('error', error);
  if (description) u.searchParams.set('error_description', description);
  if (q.state) u.searchParams.set('state', q.state);
  log('oauth', `Authorization error for client ${q.client_id}: ${error} — ${description || ''}`);
  return res.redirect(302, u.toString());
}

export function handleAuthorize(req, res) {
  if (!oauthEnabled()) return res.status(404).send('OAuth is disabled — set PUBLIC_URL on the server.');
  const q = req.query;
  log('oauth', `/authorize client=${q.client_id || '-'} resource='${q.resource || '-'}' scope='${q.scope || '-'}' pkce=${q.code_challenge_method || (q.code_challenge ? 'S256?' : 'NONE')}`);
  const v = validateAuthParams(q);
  if (v.fatal) return res.status(400).send(approvalPage({ error: v.fatal, q, invalid: true }));
  if (v.error) return redirectError(res, q, v.error, v.description);
  res.send(approvalPage({ q, client: v.client }));
}

export function handleApprove(req, res) {
  if (!oauthEnabled()) return res.status(404).send('OAuth is disabled.');
  const q = req.body || {};
  const v = validateAuthParams(q);
  if (v.fatal) return res.status(400).send(approvalPage({ error: v.fatal, q, invalid: true }));
  if (v.error) return redirectError(res, q, v.error, v.description);

  if (q.deny === '1') {
    log('oauth', `Authorization DENIED for client ${q.client_id}`);
    const u = new URL(q.redirect_uri);
    u.searchParams.set('error', 'access_denied');
    if (q.state) u.searchParams.set('state', q.state);
    return res.redirect(302, u.toString());
  }

  // Always re-confirm the password here, even with an admin session: this popup hands an
  // internet-exposed client 30 days of access to live data. An open admin tab is not consent.
  const ip = req.ip || 'unknown';
  if (!checkRate(ip)) return res.status(429).send(approvalPage({ error: 'Too many attempts — wait a minute and try again.', q, client: v.client }));
  if (!verifyPassword(q.password)) {
    noteFail(ip);
    log('oauth', `Authorization refused for client ${q.client_id}: ${q.password ? 'wrong password' : 'no password given'}`);
    return res.status(401).send(approvalPage({ error: q.password ? 'Wrong password.' : 'Enter your station password to approve.', q, client: v.client }));
  }

  const st = getState();
  const code = randomToken(32);
  // The client's own `resource` wins; otherwise the human picked one on the approval page.
  // '*' (or nothing selectable) means station-wide — an explicit choice, never a silent default.
  const asked = slugFromResource(q.resource);
  const picked = q.grant_slug === '*' ? '' : String(q.grant_slug || '');
  const slug = asked || (getModuleBySlug(picked) ? picked : '');
  st.oauth.codes[code] = {
    clientId: q.client_id,
    redirectUri: q.redirect_uri,
    codeChallenge: q.code_challenge,
    scope: q.scope || 'mcp',
    resource: q.resource || '',
    slug,
    expiresAt: Date.now() + CODE_TTL
  };
  save();
  log('oauth', `Authorization approved for client ${q.client_id} → ${slug ? `/${slug}` : 'ALL MCPs'}`);
  const u = new URL(q.redirect_uri);
  u.searchParams.set('code', code);
  if (q.state) u.searchParams.set('state', q.state);
  res.redirect(302, u.toString());
}

/* ── Token endpoint ──────────────────────────────────────────────────── */
export function handleToken(req, res) {
  const b = req.body || {};
  const st = getState();
  // Every real failure so far has been invisible: the client reports "authorization failed" and the
  // station said nothing. Log what actually arrived, so the Logs panel names the broken step.
  log('oauth', `/token grant=${b.grant_type || '-'} client=${b.client_id || '-'} redirect_uri=${b.redirect_uri ? 'sent' : 'omitted'} verifier=${b.code_verifier ? 'sent' : 'MISSING'}`);

  if (b.grant_type === 'authorization_code') {
    const rec = st.oauth.codes[b.code];
    if (!rec || rec.expiresAt < Date.now()) return tokenError(res, 'invalid_grant', 'Authorization code is invalid or expired.');
    delete st.oauth.codes[b.code]; // single use
    if (rec.clientId !== b.client_id) return tokenError(res, 'invalid_grant', 'client_id mismatch.');
    // redirect_uri is OPTIONAL on the token request (RFC 6749 §4.1.3 / the MCP SDK's own schema),
    // and claude.ai omits it. Only compare it when the client actually sends one — demanding it
    // unconditionally rejected every real connector with invalid_grant. PKCE is what binds the code.
    if (b.redirect_uri && rec.redirectUri !== b.redirect_uri) {
      return tokenError(res, 'invalid_grant', 'redirect_uri mismatch.');
    }
    if (!b.code_verifier || sha256b64url(b.code_verifier) !== rec.codeChallenge) {
      return tokenError(res, 'invalid_grant', 'PKCE verification failed.');
    }
    return issueTokens(res, st, rec);
  }

  if (b.grant_type === 'refresh_token') {
    const rec = st.oauth.refresh[b.refresh_token];
    if (!rec || rec.expiresAt < Date.now()) return tokenError(res, 'invalid_grant', 'Refresh token is invalid or expired.');
    // Bind the refresh token to the client it was issued to (RFC 6749 §6). Without this, any
    // registered client could redeem another client's refresh token.
    if (b.client_id && rec.clientId !== b.client_id) {
      return tokenError(res, 'invalid_grant', 'This refresh token was not issued to that client.');
    }
    delete st.oauth.refresh[b.refresh_token]; // rotate
    return issueTokens(res, st, rec);
  }

  return tokenError(res, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

function issueTokens(res, st, { clientId, scope, resource = '', slug = '' }) {
  const access = randomToken(32);
  const refresh = randomToken(32);
  const now = Date.now();
  st.oauth.tokens[access] = { clientId, scope, resource, slug, createdAt: now, expiresAt: now + ACCESS_TTL };
  st.oauth.refresh[refresh] = { clientId, scope, resource, slug, createdAt: now, expiresAt: now + REFRESH_TTL };
  save();
  log('oauth', `/token ISSUED for client ${clientId} → ${slug ? `/${slug}` : 'ALL MCPs'} (scope '${scope}')`);
  // OAuth 2.0 §5.1 REQUIRES Cache-Control: no-store on token responses. The MCP SDK sets it;
  // this hand-rolled endpoint didn't, and claude.ai's client enforces it — so it accepted a valid
  // token, refused to use it, and never made an authenticated call (issued but zero bearer calls in
  // the logs). curl ignores the header, which is why diagnose-connector.sh passed and hid this.
  // token_type lowercased to 'bearer' to mirror the working SDK response byte-for-byte.
  res.set('Cache-Control', 'no-store');
  res.json({
    access_token: access,
    token_type: 'bearer',
    expires_in: Math.floor(ACCESS_TTL / 1000),
    scope,
    refresh_token: refresh
  });
}

function tokenError(res, error, description) {
  log('oauth', `/token REJECTED: ${error} — ${description}`);
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

/* ── Bearer gate for MCP endpoints ────────────────────────────────────────
 * Three lanes, cheapest first:
 *   1. the station-wide MCP_TOKEN env var  — opens every MCP (the master key)
 *   2. this module's own token             — opens ONLY this MCP
 *   3. an OAuth access token               — opens the slug it was granted for
 * An OAuth token granted for /siyuan gets 403 on /telegram_mcp. That is the point.
 */
export function requireBearer(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const slug = req.params.slug || req.path.split('/')[1] || '';

  if (token) {
    if (cfg.mcpToken && timingEqual(token, cfg.mcpToken)) return next();

    const mod = getModuleBySlug(slug);
    const modToken = mod ? getModuleToken(mod.id) : '';
    if (modToken && timingEqual(token, modToken)) return next();

    const t = getState().oauth.tokens[token];
    if (t && t.expiresAt > Date.now()) {
      if (t.slug && t.slug !== slug) {
        log('oauth', `Token scoped to /${t.slug} was refused at /${slug}`);
        return res.status(403).json({
          jsonrpc: '2.0',
          error: { code: -32003, message: `This token is scoped to /${t.slug} and cannot access /${slug}.` },
          id: null
        });
      }
      // Cheap "is this connector still alive?" stamp — throttled so it isn't a write per call.
      const now = Date.now();
      if (!t.lastUsedAt || now - t.lastUsedAt > 60_000) {
        t.lastUsedAt = now;
        save();
      }
      return next();
    }
  }

  // Same shape the MCP SDK's bearer middleware sends (error + description + resource_metadata) —
  // some clients parse the error code, not just the metadata URL.
  const why = token ? 'invalid_token' : 'Missing Authorization header';
  res.setHeader(
    'WWW-Authenticate',
    `Bearer error="invalid_token", error_description="${why}", resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource/${slug}"`
  );
  log('oauth', `401 at /${slug}: ${token ? 'bearer token not recognised' : 'no Authorization header'}`);
  res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: bearer token required' }, id: null });
}

/* ── Connections (what can reach this MCP right now) ─────────────────── */
export function listConnections(slug) {
  const st = getState();
  const now = Date.now();
  return Object.entries(st.oauth.tokens)
    .filter(([, t]) => t.expiresAt > now && (!t.slug || t.slug === slug))
    .map(([tok, t]) => ({
      handle: tokenHandle(tok),
      clientName: st.oauth.clients[t.clientId]?.client_name || 'Unknown client',
      clientId: t.clientId,
      allMcps: !t.slug,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      lastUsedAt: t.lastUsedAt || null
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Revoke by handle: kills the access token AND that client's refresh tokens for the same scope. */
export function revokeConnection(handle) {
  const st = getState();
  const hit = Object.keys(st.oauth.tokens).find((t) => tokenHandle(t) === handle);
  if (!hit) throw new Error('No such connection');
  const { clientId, slug } = st.oauth.tokens[hit];
  delete st.oauth.tokens[hit];
  for (const [r, rec] of Object.entries(st.oauth.refresh)) {
    if (rec.clientId === clientId && (rec.slug || '') === (slug || '')) delete st.oauth.refresh[r];
  }
  save();
  log('oauth', `Revoked connection ${handle} (client ${clientId}${slug ? `, /${slug}` : ', all MCPs'})`);
}

/* ── Approval page (no inline JS — plain form posts) ─────────────────── */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function approvalPage({ q = {}, client = null, error = '', invalid = false }) {
  const hidden = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource']
    .map((k) => `<input type="hidden" name="${k}" value="${esc(q[k] || '')}">`)
    .join('');
  let host = '';
  try { host = new URL(q.redirect_uri).host; } catch { /* ignore */ }

  // The client named the MCP it wants (RFC 8707) → bind to it. Otherwise the human chooses,
  // so a token is never silently station-wide.
  const asked = slugFromResource(q.resource);
  const enabled = [...getModules().values()].filter((m) => m.manifest && !m.error);
  const grant = asked
    ? `<div class="who">access to <b>/${esc(asked)}</b> only</div><input type="hidden" name="grant_slug" value="${esc(asked)}">`
    : `<label for="gs">Which MCP may this client use?</label>
       <select id="gs" name="grant_slug">
         ${enabled.map((m) => `<option value="${esc(m.manifest.slug)}">${esc(m.manifest.icon)} ${esc(m.manifest.name)} — /${esc(m.manifest.slug)}</option>`).join('')}
         <option value="*">⚠ All MCPs on this station</option>
       </select>`;
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
  input[type=password],select{width:100%;box-sizing:border-box;background:#0b1420;border:1px solid #2a3846;border-radius:8px;color:#e6edf3;padding:10px 12px;font-size:14px;margin-bottom:16px}
  .err{background:#2a1215;border:1px solid #5c2b30;color:#ff9ea3;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:16px}
  .row{display:flex;flex-direction:row-reverse;gap:10px}
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
    ${grant}
    <label for="pw">Station password</label>
    <input id="pw" type="password" name="password" autofocus autocomplete="current-password">
    <div class="row">
      <!-- Approve is FIRST in the DOM so it is the form's default submit button; pressing Enter
           must never deny. row-reverse puts Deny back on the left visually. -->
      <button class="ok" type="submit">Approve</button>
      <button class="no" type="submit" name="deny" value="1" formnovalidate>Deny</button>
    </div>
  </form>`}
</div></body></html>`;
}
