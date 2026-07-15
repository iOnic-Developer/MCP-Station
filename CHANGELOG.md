# Changelog

## v1.4.12 — 2026-07-15

**The full copy: OAuth now runs the MCP SDK's own handlers, exactly like the SiYuan Companion.**

Every hand-rolled fix (v1.4.6–v1.4.11) made this station's OAuth *output* byte-identical to the working
`sy.dbzocchi.app` — matching headers, trailing-slash issuer, 1h tokens, `no-store`, even hex token
values — and claude.ai still issued a token then made zero authenticated calls, on a never-cached slug
too. The remaining difference was never in the bytes; it was in the request *handling*. So `oauth.js`
now mounts the SDK's **`mcpAuthRouter`** (discovery / DCR / `/authorize` / `/token` / `/revoke`) and gates
each endpoint with the SDK's **`requireBearerAuth`** — the same code the Companion runs — with our
provider backed by `state.js`, a password-gated `/oauth/approve` consent step, per-slug protected-resource
metadata (RFC 9728), and per-slug token scoping via the RFC 8707 resource. Verified locally end to end:
register → authorize → approve → token → authenticated `tools/list` → 200.

## v1.4.11 — 2026-07-15

**OAuth tokens are now hex, not base64url — the real reason claude.ai rejected them.**

The token response was byte-identical to the working SiYuan Companion, yet claude.ai issued a token,
parsed the payload, rejected it, and made ZERO authenticated calls — the same silent failure across
v1.4.5–v1.4.10, and it failed on a never-cached slug too (ruling out stale cache). The one thing never
compared was the token VALUE's character set: `sy` generates hex (`randomBytes.toString("hex")`, pure
`[0-9a-f]`); this station generated base64url (`.toString("base64url")`, which includes `-` and `_`).
claude.ai's connector backend rejects those characters in the access/refresh token fields. The OAuth
code + access + refresh tokens now use a hex generator (`randomHex`); session/module tokens stay
base64url (they never leave the server). Verified: issued tokens are pure 64-char hex.

## v1.4.10 — 2026-07-15

**The actual root cause: OAuth state wasn't durable across restarts.**

A second opinion caught it live — a DCR client_id issued at 23:49:30, then a Cloudflare 502 (origin
down = container restart) 30s later, and afterwards that client_id was rejected as unknown. The full
flow always passed in isolation (both diagnostics confirmed) — it only failed when the container
restarted mid-handshake or after a connect, because:

- **`save()` was debounced by 150ms** — a registered client, auth code or issued token wasn't on disk
  when we responded to the client. A crash/redeploy/kill inside that window lost it silently. OAuth
  writes (DCR, auth code, token issue, revoke) now call **`persist()` synchronously** so the record is
  on disk *before* the response. claude.ai can no longer end up holding a token this server never saved.
- **Boot now logs the OAuth store size** loaded from `station.json`. If that reads `0 clients` right
  after you had a working connector, `DATA_DIR` is not on a persistent volume and every container
  recreate is wiping every connection — the real failure mode during the v1.4.5–v1.4.9 test cycle,
  where each redeploy recreated the container and erased the store mid-test.

Operational note: this needs `DATA_DIR` (`/data`) mapped to a **persistent** host volume, and the
container to **stop crash-looping**. Check the container logs if restarts continue.

## v1.4.9 — 2026-07-15

**Exhaustive line-by-line audit of the OAuth surface against the MCP SDK the working server runs.**

Read the SDK's own auth handlers (`server/auth/router.js`, `handlers/{token,authorize,register,metadata}.js`,
`middleware/bearerAuth.js`) and made this station's output byte-identical to them:

- **Discovery metadata field set + order** now mirror the SDK's `createOAuthMetadata` exactly: dropped
  `service_documentation` (the SDK omits it unless a docs URL is configured; the Companion doesn't),
  dropped `bearer_methods_supported` from the protected-resource metadata (not emitted by the SDK), and
  ordered `token_endpoint_auth_methods_supported` as `['client_secret_post','none']`.
- **`client_id` now `crypto.randomUUID()`** (was base64url), matching the SDK's DCR handler.
- Fixed a stale example URL in the assistant seed instructions (`dbzocchi.app` → `mcp.dbzocchi.app`).

Verified: no stored URLs in state, PKCE hashing is correct base64url, no hardcoded hosts in the OAuth
path. Combined with v1.4.6–v1.4.8, this station's registration, discovery, and token responses are now a
byte-for-byte match for the working `sy.dbzocchi.app`. The substantive fix was the trailing-slash issuer
in v1.4.8; this release removes every remaining cosmetic deviation so nothing is left to suspect.

## v1.4.8 — 2026-07-15

**The real one: the OAuth issuer was missing its trailing slash.**

- Diffing this station's *production* OAuth surface against the working SiYuan Companion
  (`sy.dbzocchi.app`, SDK-based) byte for byte — token response, DCR, discovery, CORS, WWW-Authenticate,
  hosting all identical — left exactly one difference: `issuer` and `authorization_servers` were
  `https://host` here vs `https://host/` there. The MCP SDK derives the issuer via `new URL(base).href`,
  which always ends in `/`; this station built it by concatenation and dropped the slash. claude.ai keys
  the issued token to the authorization-server identifier and resolves it by its own URL-normalised form
  (with slash), so a slash-less issuer meant it accepted a valid token, couldn't match it back to the
  server, and made **zero authenticated calls** — the exact symptom across v1.4.5–v1.4.7. `issuer` and
  `authorization_servers` now carry the trailing slash, mirroring the SDK. Also added
  `revocation_endpoint_auth_methods_supported` to match.

## v1.4.7 — 2026-07-15

**Access-token lifetime cut from 30 days to 1 hour — the last thing claude.ai rejected.**

- After matching the SDK's `Cache-Control: no-store` and `token_type` (v1.4.6), the token response
  was byte-identical to the working SiYuan Companion **except** `expires_in`: this station issued
  30-day access tokens, the SDK issues 1-hour ones. claude.ai's connector manages its own refresh
  cycle and refuses an implausibly long-lived access token — it accepted the token and still made
  zero authenticated calls. `ACCESS_TTL` is now 1 hour; the 180-day refresh token (rotated on use)
  keeps the connection permanent, exactly as the SDK does it. curl never cared about `expires_in`,
  so the diagnostic passed throughout.

## v1.4.6 — 2026-07-15

**The actual reason claude.ai connectors failed after approval — a missing response header.**

- **`/token` now sends `Cache-Control: no-store`** (OAuth 2.0 §5.1, which makes it a MUST). The
  hand-rolled token endpoint issued a perfectly valid token but omitted this header. claude.ai's
  client enforces it: it accepted the token, refused to cache/use it, and **never made a single
  authenticated call** — the station logs show the token ISSUED and then zero `auth=bearer` requests
  from claude.ai. The flow got all the way through the password page and token exchange, then died
  silently, surfacing as claude.ai's generic "authorization failed". `scripts/diagnose-connector.sh`
  passed throughout because curl ignores `Cache-Control` — which is exactly why this hid for so long.
  The MCP SDK sets this header, which is why the SiYuan Companion (SDK-based) always worked.
- `token_type` lowercased to `bearer` to mirror the working SDK response exactly.

Also corrected the repo's `PUBLIC_URL` (was the Cloudflare-Access-walled apex; now `mcp.dbzocchi.app`)
and added a boot-time self-check that warns if `PUBLIC_URL` doesn't reach the station.

## v1.4.0 — 2026-07-14

**Deep sweep of the auth flows, plus the conformance suite that should have existed from the start.**

- **`/authorize` now redirects errors back to the client** (OAuth 2.1 §4.1.2.1). A bad `response_type`, missing PKCE or `plain` PKCE used to render a 400 HTML page — leaving the client's popup hanging with no signal. Errors that *cannot* be trusted to redirect (unknown `client_id`, unregistered `redirect_uri`) still render, never bounce: an authorization endpoint must not become an open redirector.
- **Refresh tokens are bound to their client** (RFC 6749 §6). The refresh grant never checked `client_id`, so any registered client could redeem another's refresh token.
- **`resource` must name an MCP on *this* station** (RFC 8707). A `resource` pointing at another origin is now ignored rather than parsed for a slug.
- Removed a **duplicate CORS layer** added in v1.3.3 — the station has had CORS on its machine-facing surfaces since the first commit, so that change was redundant. (The actual connector bug was the `redirect_uri` one in v1.3.4.)
- **`scripts/smoke-oauth.sh` — 32 checks**: open-redirect refusal, error-redirect conformance, deny/state preservation, the three token shapes real clients send, code replay, cross-client code and refresh redemption, PKCE bypass by omission, refresh rotation and reuse, MCP 401/403/404/405 surfaces, `WWW-Authenticate` discovery, CORS present on machine surfaces and **absent** on `/api`, and the admin session + CSRF gate. Verified to fail loudly when the `redirect_uri` bug is reintroduced.

## v1.3.4 — 2026-07-14

**This is the bug that broke claude.ai connectors.**

- `/token` **demanded `redirect_uri`** on the authorization_code exchange and returned `invalid_grant` without it. But `redirect_uri` is *optional* there (RFC 6749 §4.1.3, and the MCP SDK's own token schema marks it `.optional()`) — and claude.ai omits it. Every real connector was rejected at the last step, surfacing as claude.ai's generic "Authorization with the MCP server failed". It is now only compared when the client sends one; a *wrong* one is still rejected, and PKCE is what actually binds the code. The SiYuan Companion works because the SDK router it uses tolerates the omission.
- Regression tests: token exchange **without** `redirect_uri` (claude.ai's exact shape) and with a **wrong** one. The old curl tests always sent it, which is exactly why the suite stayed green while every real client failed.

## v1.3.3 — 2026-07-14

**The real cause of claude.ai's "Authorization failed".**

- **No CORS headers on the OAuth/MCP surfaces.** claude.ai's client does discovery, dynamic registration and the token exchange from the browser; with no `Access-Control-Allow-Origin` the browser blocked every one of them and the connector died with a generic authorization error. The MCP SDK's own `mcpAuthRouter` wraps its metadata/register/token/revoke handlers in `cors()` — this hand-rolled OAuth server never did. (This is why the SiYuan Companion, which uses the SDK router, connects fine.)
- Discovery, `/register`, `/token`, `/revoke` and the hosted MCP endpoints now answer cross-origin, OPTIONS preflights return 204 **before** the bearer gate (a preflight carries no `Authorization` header), and `WWW-Authenticate` is exposed so the browser can read where to authenticate.
- `/api` is deliberately left same-origin-only — it is cookie-authenticated and its CSRF defence depends on that. Verified by test.

## v1.3.2 — 2026-07-14

**Fixes claude.ai connectors failing with "auth failed".**

- The approval form's **Deny button was first in the DOM, making it the default submit** — so any implicit submission (Enter key, or the popup's default action) sent `deny=1` and redirected back to the client with `error=access_denied`. Approve is now the default; Deny stays on the left visually (`row-reverse`).
- **The approval page always asks for the station password now.** It used to skip the field when you happened to have an admin session cookie in the same browser — so the popup showed no password box at all, which is both confusing and wrong: an open admin tab is not consent to give an internet-exposed client 30 days of access to live data.
- Approvals, denials and refusals are logged (`Authorization approved/DENIED/refused for client …`), so the Logs panel tells you what actually happened.

## v1.3.1 — 2026-07-14

- Per-MCP chat sits **beside** the code, not under it — the code drawer widens to 60% of the viewport when ✦ Chat is open and collapses back when it is closed (below 900px wide it stacks, where there is no room for two columns).

## v1.3.0 — 2026-07-14

**Per-MCP access control — this changes OAuth behaviour.**

- **OAuth tokens are now scoped to one MCP.** A token granted for `/siyuan` gets **403** on `/telegram_mcp`. The slug comes from the client's RFC 8707 `resource` param; a client that doesn't send one makes the *human* pick the MCP on the approval page (with an explicit "⚠ All MCPs" option). Previously any token opened every MCP.
- **Each MCP can have its own bearer token** — 🔑 Access on the card → Generate / Rotate / Clear. It opens only that MCP, so a script or n8n can be handed one endpoint without the keys to the whole station. Shown once, stored encrypted, mirrored into the module's `.config.json`. The station-wide `MCP_TOKEN` still works everywhere as the master key.
- **Connected clients, with Revoke** — 🔑 Access lists the live OAuth connectors that can reach this MCP, with last-used and expiry. Revoking kills the access token *and* that client's refresh tokens, so it can't quietly refresh back in.
- **🧰 Tools — capabilities view.** Every card can show exactly what its MCP exposes: tools with descriptions, argument tables (type, required, description) and behaviour hints (read-only / destructive), plus prompts and any house instructions. Introspected by *running* the module over an in-memory MCP transport — it's what a real client sees, not a guess parsed from the source. Drop a stranger's module into `mcps/` and read its capabilities before trusting it.
- `scripts/smoke-scoping.sh` — 15 checks: master token, per-module tokens, both scoping paths, cross-MCP 403, connections + revoke.

## v1.2.1 — 2026-07-14

- Fix: the SPA's assets were served with `maxAge: '1h'` but linked unversioned, so a redeploy left the browser running the previous `app.js`/`app.css` for an hour. Now `no-cache` + ETag (revalidate every load, cheap 304s).
- The ✦ popup names its provider and model, so "am I talking to Claude or Gemini?" is answerable at a glance.

## v1.2.0 — 2026-07-14

- **SiYuan module** (`mcps/siyuan/`, 📓 `/siyuan`) — the SiYuan Companion's 19 kernel tools + 2 prompts, ported to the module contract. Its own OAuth/transport layer is gone: the station already is that. Settings: `siyuan_url` + `siyuan_token`. Keeps the browser User-Agent (Cloudflare 1010) and both retry ladders; `replace_doc` still preserves the doc id.
- **Module `instructions.md`** — an optional file per module, handed to every client as the MCP `instructions` at `initialize()`. House style now applies on claude.ai web, phone, Desktop and Code automatically, without being restated. (`buildServerFor` previously passed no options, so modules could not set it at all.)
- **Modules are self-contained** — config is mirrored to `mcps/<id>/.config.json` (encrypted secrets, hidden from the file tabs). Delete a module folder and put it back — by hand, or UI-delete then restore from `data/trash/` — and the station adopts it and carries on. Previously the UI delete purged the settings for good.
- Prompts (`server.registerPrompt`) documented in the module contract — they already worked, nobody knew
- `scripts/smoke-selfcontained.sh` — 10 checks covering the delete/restore drill and encryption-at-rest of the mirror

## v1.1.0 — 2026-07-14

- **Per-MCP chat in the code drawer** — ✦ Chat button next to each module's files. The assistant sees *that module's* source (manifest.json + index.js, inlined into its system prompt) and answers with complete files; **⤵ Insert** drops a returned code block straight into the open editor tab.
- Per-module conversations persist in the module's own folder as `.chat.json` (hidden from the file tabs, travels with backups/exports)
- Streaming chat pane extracted to `public/assets/js/chat.js` and shared by the ✦ station popup and the per-MCP chat

## v1.0.3 — 2026-07-14

- Fix: the ✦ popup could not be closed and floated over the settings drawer — `.assistant { display: flex }` overrode the `[hidden]` attribute, so the ✕ / FAB toggle had no visual effect; the panel now also sits below drawers and modals

## v1.0.2 — 2026-07-14

- ✦ popup can run on **Gemini** as well as Claude — provider toggle in ⚙ Station settings, separate encrypted key + model per provider (`ASSISTANT_PROVIDER` / `GEMINI_API_KEY` / `GEMINI_MODEL` as env fallbacks)

## v1.0.1 — 2026-07-14

- Backup/restore uses busybox `tar`/`gzip` from the base image (stage + plain tar) — `apk add tar gzip` dropped from the Dockerfile
- GitHub Actions lane: multi-arch (amd64/arm64) build + push to Docker Hub on `main` and `v*` tags
- Unraid deployment guide in the README

## v1.0.0 — 2026-07-11

First release, built end-to-end by Claude (Cowork session).

- Modular MCP host: folders in `mcps/` → streamable-HTTP endpoints at `/<slug>`, hot reload, fresh server per request
- OAuth 2.1 authorization server (dynamic client registration + PKCE S256, `APP_PASSWORD`-gated approval, rotating refresh tokens) + static `MCP_TOKEN` dual auth — SiYuan Companion pattern
- Starter modules: Telegram ✈️ (get_me, send_message, send_photo, get_updates, get_chat) and Gemini ✨ (generate_text, chat, list_models, embed_text) + `_template`
- Admin SPA: login, MCP cards (toggle/status/test/copy-URL), manifest-driven settings with encrypted secrets, in-browser module code editor, add-new-from-template, logs panel
- ✦ Claude popup: SSE streaming chat, retained instructions (seeded with the full module-building contract, editable), live station context injection
- Import/export (JSON, optional secrets) · backup/restore (tar.gz of state + modules, server-side list + upload)
- Docker: node:22-alpine, `/data` + `/app/mcps` volumes, module seeding entrypoint, healthcheck; compose file for dbzocchi.app behind SWAG/NPM
