/**
 * OAuth 2.1 for the hosted MCP endpoints — a faithful copy of the SiYuan Companion's setup, which
 * connects to claude.ai reliably where every hand-rolled equivalent (byte-identical output and all)
 * did not. The MCP SDK's own `mcpAuthRouter` drives discovery / DCR / authorize / token / revoke, and
 * `requireBearerAuth` gates each endpoint — i.e. claude.ai talks to the SDK's actual handlers, not our
 * re-implementation. We only supply the provider (backed by state.js) and a password-gated consent
 * step, and adapt for MCP Station's multi-MCP layout with per-slug protected-resource metadata and
 * per-slug token scoping (bound via the RFC 8707 resource claude.ai sends).
 *
 * MCP endpoints also accept the static MCP_TOKEN env value or a per-module token (Claude Code / scripts).
 */
import crypto from 'node:crypto';
import express from 'express';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { cfg } from './env.js';
import { getState, save, persist } from './state.js';
import { sha256b64url, timingEqual } from './crypto.js';
import { verifyPassword, checkRate, noteFail } from './auth.js';
import { getModuleBySlug, getModuleToken } from './mcpHost.js';
import { log } from './log.js';

const CODE_TTL_MS = 5 * 60 * 1000; // auth code + pending login live 5 min
const ACCESS_TTL_S = 60 * 60;      // access token lives 1 hour; refresh keeps the connection permanent
const rand = (n = 32) => crypto.randomBytes(n).toString('hex'); // hex tokens, exactly like the Companion

export function baseUrl(req) {
  if (cfg.publicUrl) return cfg.publicUrl;
  return `${req.protocol}://${req.get('host')}`;
}
export const oauthEnabled = () => Boolean(cfg.publicUrl);

/* A token is bound to ONE mcp slug (derived from the RFC 8707 `resource` claude.ai sends); '' = all. */
export function slugFromResource(resource) {
  try {
    const u = new URL(String(resource));
    if (cfg.publicUrl && u.origin !== new URL(cfg.publicUrl).origin) return '';
    const seg = u.pathname.replace(/^\/+/, '').split('/')[0] || '';
    return getModuleBySlug(seg) ? seg : '';
  } catch {
    return '';
  }
}

const tokenHandle = (t) => sha256b64url(t).slice(0, 12);

// Pending logins live in memory (like the Companion) — a redeploy mid-login just means retry.
const pending = new Map();
function sweepPending() {
  const now = Date.now();
  for (const [k, v] of pending) if (v.exp < now) pending.delete(k);
}

let provider = null;

function issueTokens(clientId, scopes = [], resource) {
  const st = getState();
  const access = rand(32);
  const refresh = rand(32);
  const now = Date.now();
  const expiresAt = Math.floor(now / 1000) + ACCESS_TTL_S; // SECONDS — requireBearerAuth compares to Date.now()/1000
  const slug = slugFromResource(resource) || '';
  st.oauth.tokens[access] = { clientId, scopes, resource: resource || '', slug, createdAt: now, expiresAt };
  st.oauth.refresh[refresh] = { clientId, scopes, resource: resource || '', slug, createdAt: now };
  persist(); // durable before we hand the token back
  log('oauth', `/token ISSUED for client ${clientId} → ${slug ? `/${slug}` : 'ALL MCPs'}`);
  return {
    access_token: access,
    token_type: 'bearer',
    expires_in: ACCESS_TTL_S,
    scope: scopes.length ? scopes.join(' ') : undefined,
    refresh_token: refresh,
  };
}

/* Mount the SDK auth router + our consent step. Call once at boot when PUBLIC_URL is set. */
export function mountOAuth(app) {
  const base = cfg.publicUrl;

  provider = {
    clientsStore: {
      getClient: (id) => getState().oauth.clients[id],
      registerClient: (client) => {
        const st = getState();
        st.oauth.clients[client.client_id] = { ...client, createdAt: Date.now() };
        persist();
        log('oauth', `DCR: registered '${client.client_name || 'MCP client'}' (${client.client_id})`);
        return client;
      },
    },

    // Renders our password-gated consent page; it posts to /oauth/approve to mint the code.
    async authorize(client, params, res) {
      sweepPending();
      const loginId = rand(16);
      pending.set(loginId, {
        clientId: client.client_id,
        clientName: client.client_name,
        codeChallenge: params.codeChallenge,
        redirectUri: params.redirectUri,
        state: params.state,
        resource: params.resource ? params.resource.href : undefined,
        scopes: params.scopes || [],
        exp: Date.now() + CODE_TTL_MS,
      });
      log('oauth', `/authorize client=${client.client_id} resource='${params.resource?.href || '-'}'`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(loginPage(loginId, client.client_name));
    },

    async challengeForAuthorizationCode(client, code) {
      const c = getState().oauth.codes[code];
      if (!c || c.clientId !== client.client_id) throw new Error('invalid authorization code');
      return c.codeChallenge;
    },

    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
      const st = getState();
      const c = st.oauth.codes[code];
      if (!c || c.clientId !== client.client_id || c.exp < Date.now()) throw new Error('invalid or expired authorization code');
      if (redirectUri && redirectUri !== c.redirectUri) throw new Error('redirect_uri mismatch');
      delete st.oauth.codes[code]; // one-time use
      return issueTokens(client.client_id, c.scopes, c.resource || (resource && resource.href));
    },

    async exchangeRefreshToken(client, refreshToken, scopes, resource) {
      const st = getState();
      const r = st.oauth.refresh[refreshToken];
      if (!r || r.clientId !== client.client_id) throw new Error('invalid refresh token');
      delete st.oauth.refresh[refreshToken]; // rotate
      return issueTokens(client.client_id, scopes && scopes.length ? scopes : r.scopes, r.resource || (resource && resource.href));
    },

    async verifyAccessToken(token) {
      const t = getState().oauth.tokens[token];
      if (!t) throw new Error('invalid token');
      if (t.expiresAt * 1000 < Date.now()) { delete getState().oauth.tokens[token]; save(); throw new Error('expired token'); }
      return {
        token,
        clientId: t.clientId,
        scopes: t.scopes || [],
        expiresAt: t.expiresAt,
        resource: t.resource ? new URL(t.resource) : undefined,
        extra: { slug: t.slug || '' },
      };
    },

    async revokeToken(_client, request) {
      const st = getState();
      const tok = request.token;
      let hit = false;
      if (st.oauth.tokens[tok]) { delete st.oauth.tokens[tok]; hit = true; }
      if (st.oauth.refresh[tok]) { delete st.oauth.refresh[tok]; hit = true; }
      if (hit) persist();
    },
  };

  // Outcome log for every OAuth endpoint response — the SDK's handlers reject silently (a 400
  // from /token never logged), which left "token ISSUED" as the last line even when the client
  // came straight back with a failing second call. Discovery fetches are included so the log
  // finally shows claude.ai's WHOLE server-side conversation, including any post-token
  // re-validation of the metadata. Logs status + grant_type + client_id + the OAuth error code
  // only; never bodies, codes, secrets or token values.
  app.use(['/token', '/register', '/authorize', '/revoke', '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'], (req, res, next) => {
    const json = res.json.bind(res);
    let errCode;
    res.json = (body) => { errCode = body && body.error; return json(body); };
    res.on('finish', () => {
      const q = { ...(req.query || {}), ...(req.body || {}) };
      const fullPath = `${req.baseUrl || ''}${req.path === '/' ? '' : req.path}` || req.path;
      const bits = [
        `${req.method} ${fullPath} → ${res.statusCode}`,
        q.grant_type ? `grant=${q.grant_type}` : '',
        q.client_id ? `client=${q.client_id}` : '',
        errCode ? `error=${errCode}` : '',
      ].filter(Boolean);
      log('oauth', bits.join(' '));
    });
    next();
  });

  // Consent target — must be registered before mcpAuthRouter so it wins at /oauth/approve.
  app.post('/oauth/approve', express.urlencoded({ extended: false }), handleApprove);
  // Per-slug PRM (RFC 9728) — registered before the router so /:slug resolves to the module resource.
  app.get('/.well-known/oauth-protected-resource/:slug', protectedResourceMetadata);
  // Root PRM: the station root is not an MCP, so don't advertise it as one (shadows the SDK's
  // root handler). A connector added with the bare station URL now fails at discovery, not after
  // the password page. The AS metadata at /.well-known/oauth-authorization-server is unaffected.
  app.get('/.well-known/oauth-protected-resource', (_req, res) => {
    log('oauth', 'PRM refused for the station root — connectors must use a module URL like /siyuan');
    res.status(404).json({ error: 'The station root is not an MCP. Connect to a module URL, e.g. /siyuan' });
  });

  // No scopes_supported at the AS level: modules aren't loaded yet when this mounts, and the
  // per-slug PRM (above) is the RFC 9728 source clients take resource scopes from. This keeps
  // the literal scope value 'mcp' out of the flow entirely — for /siyuan the scope claude.ai
  // requests and is granted is now 'siyuan', exactly like the working Companion.
  app.use(mcpAuthRouter({
    provider,
    issuerUrl: new URL(base),
    resourceServerUrl: new URL(base),
    resourceName: 'MCP Station',
  }));

  return provider;
}

/* Consent form target: verify the station password, mint a one-time code, redirect back. */
export function handleApprove(req, res) {
  sweepPending();
  const { login_id: loginId, password } = req.body || {};
  const p = pending.get(loginId);
  if (!p) {
    // The one approve outcome that used to log nothing — a stale authorize page (>5 min old,
    // or a restart in between) swallows the password and claude.ai times out with its generic
    // "Authorization with the MCP server failed". Now it's in the logs.
    log('oauth', 'Approve with expired/unknown login_id — stale authorize page; the client must restart the connect flow');
    return res.status(400).send(errPage('This sign-in expired or was already used. Start again from your client.'));
  }

  const ip = req.ip || 'unknown';
  if (!checkRate(ip)) return res.status(429).send(errPage('Too many attempts. Wait a minute and try again.'));
  if (!password || !verifyPassword(password)) {
    noteFail(ip);
    log('oauth', `Authorization refused for client ${p.clientId}: ${password ? 'wrong password' : 'no password'}`);
    return res.status(401).send(loginPage(loginId, p.clientName, 'Wrong password.'));
  }

  pending.delete(loginId);
  const st = getState();
  const code = rand(24);
  st.oauth.codes[code] = {
    clientId: p.clientId,
    codeChallenge: p.codeChallenge,
    redirectUri: p.redirectUri,
    resource: p.resource,
    scopes: p.scopes,
    exp: Date.now() + CODE_TTL_MS,
  };
  persist(); // durable before the redirect — the code must survive a restart before the token exchange
  log('oauth', `Authorization approved for client ${p.clientId}`);
  const u = new URL(p.redirectUri);
  u.searchParams.set('code', code);
  if (p.state) u.searchParams.set('state', p.state);
  res.redirect(302, u.href);
}

/* Per-slug protected-resource metadata (RFC 9728) — the SDK router is single-resource, so we serve
 * these ourselves so claude.ai's `resource` (the URL it connected to) matches exactly.
 * Unknown slugs get 404, like the Companion's single-resource router: serving metadata for a
 * nonexistent endpoint let claude.ai run the WHOLE OAuth flow (password page and all) against a
 * typo'd or stale URL and only fail at the final MCP call — "password worked, then it failed". */
export function protectedResourceMetadata(req, res) {
  const base = baseUrl(req);
  const slug = req.params.slug || '';
  if (slug && !getModuleBySlug(slug)) {
    log('oauth', `PRM refused for unknown slug '/${slug}' — connector URL doesn't match a hosted MCP`);
    return res.status(404).json({ error: `No MCP is hosted at /${slug}` });
  }
  // Mirror the Companion's PRM byte-for-byte in kind: per-resource scope named after the
  // resource (claude.ai echoes this value into its authorize request and token grant), and an
  // ASCII-only resource_name — the em dash here was the single non-ASCII byte sequence in the
  // whole OAuth surface, and this backend has already rejected byte-level quirks (base64url
  // tokens) that curl and the spec were both fine with.
  res.json({
    resource: slug ? `${base}/${slug}` : base,
    authorization_servers: [`${base}/`],
    scopes_supported: [slug || 'mcp'],
    resource_name: slug ? `MCP Station - ${slug}` : 'MCP Station',
  });
}

/* ── Bearer gate for /:slug ──────────────────────────────────────────────
 * Static MCP_TOKEN (all MCPs) → module token (this MCP) → OAuth token via the SDK's requireBearerAuth,
 * then a per-slug scope check. */
export function bearerGate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const slug = req.params.slug || req.path.split('/')[1] || '';

  if (token && cfg.mcpToken && timingEqual(token, cfg.mcpToken)) return next();
  const mod = getModuleBySlug(slug);
  const modToken = mod ? getModuleToken(mod.id) : '';
  if (token && modToken && timingEqual(token, modToken)) return next();

  const gate = requireBearerAuth({ verifier: provider, resourceMetadataUrl: `${baseUrl(req)}/.well-known/oauth-protected-resource/${slug}` });
  return gate(req, res, () => {
    const t = req.auth;
    if (t && t.extra && t.extra.slug && t.extra.slug !== slug) {
      log('oauth', `Token scoped to /${t.extra.slug} was refused at /${slug}`);
      return res.status(403).json({ jsonrpc: '2.0', error: { code: -32003, message: `This token is scoped to /${t.extra.slug} and cannot access /${slug}.` }, id: null });
    }
    if (t) {
      const rec = getState().oauth.tokens[t.token];
      const now = Date.now();
      if (rec && (!rec.lastUsedAt || now - rec.lastUsedAt > 60_000)) { rec.lastUsedAt = now; save(); }
    }
    next();
  });
}

/* ── Connections (admin UI) ─────────────────────────────────────────────── */
export function listConnections(slug) {
  const st = getState();
  const now = Date.now() / 1000;
  return Object.entries(st.oauth.tokens)
    .filter(([, t]) => t.expiresAt > now && (!t.slug || t.slug === slug))
    .map(([tok, t]) => ({
      handle: tokenHandle(tok),
      clientName: st.oauth.clients[t.clientId]?.client_name || 'Unknown client',
      clientId: t.clientId,
      allMcps: !t.slug,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt * 1000,
      lastUsedAt: t.lastUsedAt || null,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function revokeConnection(handle) {
  const st = getState();
  const hit = Object.keys(st.oauth.tokens).find((t) => tokenHandle(t) === handle);
  if (!hit) throw new Error('No such connection');
  const { clientId, slug } = st.oauth.tokens[hit];
  delete st.oauth.tokens[hit];
  for (const [r, rec] of Object.entries(st.oauth.refresh)) {
    if (rec.clientId === clientId && (rec.slug || '') === (slug || '')) delete st.oauth.refresh[r];
  }
  persist();
  log('oauth', `Revoked connection ${handle} (client ${clientId}${slug ? `, /${slug}` : ', all MCPs'})`);
}

/* ── Consent page (password only; plain form post to /oauth/approve) ─────── */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loginPage(loginId, clientName, error) {
  const who = clientName ? `<p class="who"><b>${esc(clientName)}</b> wants to connect to your MCP servers.</p>` : '';
  const err = error ? `<p class="err">${esc(error)}</p>` : '';
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MCP Station — Authorize</title>
<style>body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0b0f14;color:#e6edf3;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#111823;border:1px solid #1f2a37;padding:28px;border-radius:16px;width:min(92vw,340px);box-shadow:0 20px 60px rgba(0,0,0,.5)}
h1{font-size:17px;margin:0 0 4px}.who{color:#8b98a9;font-size:13px;margin:0 0 16px;line-height:1.5}
input{width:100%;box-sizing:border-box;padding:11px;border-radius:10px;border:1px solid #2a3846;background:#0b1420;color:#e6edf3;font-size:15px}
button{width:100%;margin-top:12px;padding:11px;border:0;border-radius:10px;background:#1f6feb;color:#fff;font-weight:600;font-size:15px;cursor:pointer}
.err{color:#ff9ea3;font-size:13px;margin:10px 0 0}</style>
<form method="post" action="/oauth/approve"><h1>⛽ MCP Station</h1>${who}
<input type="hidden" name="login_id" value="${esc(loginId)}">
<input type="password" name="password" placeholder="Station password" autofocus autocomplete="current-password">
<button type="submit">Authorise</button>${err}</form>`;
}

function errPage(msg) {
  return `<!doctype html><meta charset="utf-8"><title>Sign-in error</title><body style="font-family:system-ui,sans-serif;background:#0b0f14;color:#e6edf3;display:grid;place-items:center;min-height:100vh;margin:0"><p style="max-width:360px;text-align:center;padding:0 20px">${esc(msg)}</p>`;
}
