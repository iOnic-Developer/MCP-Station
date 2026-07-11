# Auth in MCP Station

Two independent ways into every hosted MCP endpoint, checked in this order:

1. **Static bearer** — `Authorization: Bearer <MCP_TOKEN>` where `MCP_TOKEN` is the env var. For Claude Code CLI, n8n, curl, cron. Constant-time compared. Unset = disabled.
2. **OAuth 2.1 access token** — issued by the built-in authorization server. For claude.ai web/phone custom connectors. Requires `PUBLIC_URL`.

The admin UI is separate: `APP_PASSWORD` login → HMAC-signed session cookie (7-day sliding) + CSRF header on mutations. MCP endpoints never accept cookies; the UI never accepts bearers.

## The claude.ai connect flow (what actually happens)

```
claude.ai                                MCP Station
   │  POST /gemini_mcp (no token)             │
   │ ◄─── 401 + WWW-Authenticate:             │
   │      resource_metadata=…/gemini_mcp      │
   │  GET /.well-known/oauth-protected-resource/gemini_mcp
   │ ◄─── { authorization_servers: [base] }   │
   │  GET /.well-known/oauth-authorization-server
   │ ◄─── endpoints, PKCE S256, DCR           │
   │  POST /register  {client_name,redirect_uris}
   │ ◄─── { client_id }                       │  (no secret — public client)
   │  browser → GET /authorize?client_id&code_challenge&state…
   │        David enters APP_PASSWORD, hits Approve
   │ ◄─── 302 redirect_uri?code&state         │  (code: 10 min, single use)
   │  POST /token {code, code_verifier}       │  PKCE: S256(verifier) == challenge
   │ ◄─── { access_token (30 d),              │
   │        refresh_token (180 d, rotates) }  │
   │  POST /gemini_mcp  Bearer access_token   │
   │ ◄─── MCP JSON-RPC responses              │
```

Refresh: `POST /token` with `grant_type=refresh_token` — the old refresh token is consumed, a new pair is issued. That's the "permanent" part: claude.ai keeps refreshing silently.

## Design choices

- **PKCE S256 only**, no implicit, no plain — OAuth 2.1 baseline.
- **Open dynamic registration** (anyone may register a client) but **tokens only exist after password-gated approval**, rate-limited 8 tries/min/IP. Same trust model as the SiYuan Companion.
- **Public clients** (`token_endpoint_auth_method: none`) — claude.ai's MCP client is a public client; possession of a valid code + PKCE verifier is the proof.
- Redirect URIs must be **https** (localhost exempt for dev tools).
- Tokens are opaque random 256-bit values stored server-side in `/data/station.json` — no JWTs, instantly revocable (`POST /revoke`, or delete from state).
- One authorization server covers **all** hosted MCPs; a token works on any enabled endpoint. Single-operator homelab trade-off, documented in the build journal.
- If an admin session exists in the browser, `/authorize` skips the password field (approval still explicit).

## Reverse proxy notes

- Forward `Authorization` headers (SWAG/NPM default configs do).
- `PUBLIC_URL` must exactly match the externally visible https origin — it's the OAuth `issuer` and the base of every advertised endpoint.
- Keep `/.well-known/*` unredirected and uncached.
