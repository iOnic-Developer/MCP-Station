#!/usr/bin/env node
/**
 * Faithful simulation of claude.ai's custom-connector flow, including the details the old
 * curl diagnostics missed (PRM scope echo, form-encoded token exchange, refresh rotation).
 * Run it against the LIVE station — the password is a local argument, it goes only to your server:
 *
 *   node scripts/claude-flow-sim.mjs https://mcp.dbzocchi.app /siyuan 'your-station-password'
 *
 * Every step prints its status. If this says FLOW OK against the live host and claude.ai still
 * fails, the server and transport are exonerated end-to-end and the problem is on claude.ai's side.
 */
import crypto from "node:crypto";

const [base, mcpPath, password] = process.argv.slice(2);
if (!base || !mcpPath || !password) {
  console.error("usage: node scripts/claude-flow-sim.mjs <base-url> </slug> <station-password>");
  process.exit(2);
}
const mcpUrl = base.replace(/\/+$/, "") + mcpPath;
const redirectUri = "https://claude.ai/api/mcp/auth_callback";
const out = (step, ...rest) => console.log(step.padEnd(14), ...rest);
const b64url = (buf) => buf.toString("base64url");
const verifier = b64url(crypto.randomBytes(32));
const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());

async function jfetch(url, opts = {}) {
  const r = await fetch(url, { redirect: "manual", ...opts });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { r, text, json };
}

// 1. Unauthenticated initialize -> 401 + WWW-Authenticate (how claude.ai discovers auth)
const initBody = JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "0.1.0" } } });
const mcpHeaders = (tok) => ({ "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) });
const pre = await jfetch(mcpUrl, { method: "POST", headers: mcpHeaders(), body: initBody });
out("PRE-401", pre.r.status, JSON.stringify(pre.r.headers.get("www-authenticate") || ""));
const rm = (pre.r.headers.get("www-authenticate") || "").match(/resource_metadata="([^"]+)"/);

// 2 + 3. Discovery
const prm = await jfetch(rm ? rm[1] : `${base}/.well-known/oauth-protected-resource${mcpPath}`);
out("PRM", prm.r.status, prm.text.slice(0, 220));
const asBase = prm.json?.authorization_servers?.[0] || base;
const meta = (await jfetch(new URL("/.well-known/oauth-authorization-server", asBase).href)).json;
out("AS-META", meta ? "ok" : "MISSING", meta?.issuer || "");

// 4. DCR (public client + PKCE, like claude.ai)
const reg = await jfetch(meta.registration_endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
});
out("REGISTER", reg.r.status, reg.json?.client_id || reg.text.slice(0, 150));
const client = reg.json;

// 5. GET /authorize (echoing the PRM's advertised scope, as claude.ai does)
const authUrl = new URL(meta.authorization_endpoint);
for (const [k, v] of Object.entries({ response_type: "code", client_id: client.client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state: "st_" + b64url(crypto.randomBytes(8)), resource: mcpUrl })) authUrl.searchParams.set(k, v);
if (prm.json?.scopes_supported?.length) authUrl.searchParams.set("scope", prm.json.scopes_supported.join(" "));
const authz = await jfetch(authUrl.href);
const loginId = (authz.text.match(/name="login_id" value="([^"]+)"/) || [])[1];
out("AUTHORIZE", authz.r.status, "login_id=" + (loginId || "MISSING — " + authz.text.slice(0, 150)));

// 6. Approve with the password -> 302 with code
const approve = await jfetch(new URL("/oauth/approve", base).href, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ login_id: loginId || "", password }),
});
const loc = approve.r.headers.get("location") || "";
out("APPROVE", approve.r.status, loc ? loc.replace(/code=[^&]+/, "code=***") : approve.text.replace(/\s+/g, " ").slice(0, 140));
const code = loc ? new URL(loc).searchParams.get("code") : null;

// 7. Token exchange (form-encoded, resource + PKCE verifier, like claude.ai)
const tok = await jfetch(meta.token_endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", code: code || "", code_verifier: verifier, redirect_uri: redirectUri, client_id: client.client_id, resource: mcpUrl }),
});
out("TOKEN", tok.r.status, tok.json ? JSON.stringify({ ...tok.json, access_token: "***", refresh_token: "***" }) : tok.text.slice(0, 200));
const access = tok.json?.access_token;

// 8-9. Authenticated initialize + tools/list
const init = await jfetch(mcpUrl, { method: "POST", headers: mcpHeaders(access), body: initBody });
out("INITIALIZE", init.r.status, (init.json?.result?.serverInfo && JSON.stringify(init.json.result.serverInfo)) || init.text.slice(0, 160));
const tools = await jfetch(mcpUrl, { method: "POST", headers: mcpHeaders(access), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
const n = tools.json?.result?.tools?.length;
out("TOOLS-LIST", tools.r.status, n != null ? `${n} tools` : tools.text.slice(0, 160));

// 10. Refresh rotation (claude.ai does this hourly)
if (tok.json?.refresh_token) {
  const rt = await jfetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.json.refresh_token, client_id: client.client_id, resource: mcpUrl }),
  });
  out("REFRESH", rt.r.status, rt.json ? "rotated ok" : rt.text.slice(0, 140));
}

console.log(init.r.status === 200 && access ? "\nFLOW OK — server + transport are healthy end to end" : "\nFLOW FAIL — the failing step is above");
