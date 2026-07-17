# Changelog

## v1.4.23 — 2026-07-17

**Sonarr becomes a bundled default module 📺 (sonarr v1.1.0, slug `sonarr_mcp`).**

- `mcps/sonarr` now ships with the station: 9 tools — list/lookup/add/delete series, episodes,
  download queue, disk space, profiles & root folders, and command triggers (SeriesSearch,
  SeasonSearch, EpisodeSearch, MissingEpisodeSearch, RefreshSeries, RescanSeries, RenameFiles,
  RssSync).
- Written against the current Sonarr v4 API (still served under `/api/v3`): the queue asks for
  `pageSize` + `includeSeries`/`includeEpisode` and surfaces `trackedDownloadState`, warning
  `statusMessages` and `errorMessage` (so "Severance S02E09 — importBlocked ⚠️ archive needs
  extracting", not just a release name); add-series drives `addOptions.monitor`
  (all/future/missing/firstSeason/…) plus `searchForCutoffUnmetEpisodes`; delete supports
  `addImportListExclusion`; the deprecated v4 `/languageprofile` stub is never auto-detected
  (a legacy `languageProfileId` arg remains for genuine v3 servers).
- Fixes vs the hand-built live version: `log.error()` crashed on every failed request (`log` is
  injected as a plain function) — the real API error now surfaces; adding a show that's already
  in the library returns a friendly notice instead of a Sonarr 400; `deleteFiles` defaults to
  **false** to match the API default (was true — it silently wiped files); `structuredContent`
  is always an object; series/episode lists get filter/pagination args and ~24k truncation.
- Verified end-to-end in a sandbox station against a mock Sonarr v4 (including the deprecated
  languageprofile stub and 401 handling): 15/15 MCP checks green, all three ▶ Test paths correct.

## v1.4.22 — 2026-07-16

**Gemini module v1.2.0 — image generation on the latest Gemini 3.1 model (Nano Banana 2).**

- `gemini_generate_image` now defaults to **`gemini-3.1-flash-image`** ("Nano Banana 2"), with
  `gemini-3-pro-image` ("Nano Banana Pro") selectable for higher fidelity, and an `aspect_ratio`
  arg (`1:1`/`3:4`/`4:3`/`9:16`/`16:9`) via `generationConfig.imageConfig.aspectRatio`. Added
  `gemini_generate_image_base64` (data-URI text output for clients that can't render native image
  blocks) and a `default_image_model` setting.
- The path is the native `…:generateContent` → `inlineData` flow. (A hand-edited live version was
  calling **Imagen 3** via a `:generateImages` endpoint — wrong model line, an unavailable default
  `imagen-3.0-generate-002`, and an endpoint Imagen doesn't even expose here, so it would have
  errored outright.) Verified live against the API: Nano Banana 2 + Pro both return images,
  16:9 aspect honored, both output tools work.

## v1.4.21 — 2026-07-16

**Gemini 3 support in the ✦ assistant — thoughtSignature round-trip.**

- Gemini 3 attaches a `thoughtSignature` to every function-call part and **requires** it echoed
  back on the next turn, or the request 400s "Function call is missing a thought_signature" — which
  broke the assistant's tool loop (create_module/reload_modules) the moment you pointed it at a
  Gemini 3 model. The Gemini adapter now stashes the signature off each returned part and
  re-attaches it to the exact part on the following turn (the same fix the SiYuan Companion
  shipped). The Anthropic adapter strips the internal `_sig`/`_toolName` markers so its strict
  content-block validation still passes. Verified both providers: signature round-trips on Gemini,
  nothing leaks on Anthropic, tool loop completes on both.
- Set your Gemini 3 model id in ⚙ Station → Assistant (or `GEMINI_MODEL`); the `gemini` module's
  own text/chat/image tools already accept any model id, so they needed no change.

## v1.4.20 — 2026-07-16

**Files module can store images and mint public share links — the "Gemini image → URL" flow.**

- **`save_base64`** — store binary (an image, PDF, audio) from base64 into the jail. Pass the
  Gemini image tool's output straight in; `share: true` also returns a public URL in the same call.
- **`create_share_link` / `list_shares` / `revoke_share`** — mint, list and revoke public links.
- **`GET /f/<token>`** (station core, unauthenticated by design) streams one shared file with the
  right `Content-Type` (browsers render images inline), `nosniff`, and `no-store` so revocation is
  instant. This is the only route that intentionally bypasses auth — registered before the static
  handler and the `/:slug` MCP catch-all.
- **Safe by default:** tokens are 128-bit unguessable (`crypto.randomBytes(16)`), links expire
  (default `7d`; `never` allowed), the resolver re-checks the file is still inside the recorded
  jail root, and shares are swept by the state GC. Verified end-to-end: base64 image saved →
  fetched by URL (exact bytes, correct magic) → bad token 404 → revoke → immediate 404; path
  traversal through `save_base64` refused.
- Modules now receive a `shareStore` in their `register()` context (`createShare`, `listShares`,
  `revokeShare`, `parseTtl`), so any module can offer share links.

## v1.4.19 — 2026-07-16

**📁 Files module — Claude gets a folder.**

- New bundled module `files` (endpoint `/files/mcp`): six tools — `list_files` (recursive,
  capped), `read_file` (text, size-capped, binary detected not dumped), `write_file`
  (auto-creates parents; `append` flag for large content), `move_file`, `make_dir`,
  `delete_file` (files or **empty** folders only, by design). Connect it to claude.ai and
  "save that as notes/report.md" just works.
- **Jailed to one root folder** (`root_dir` setting, default `/files`): absolute paths, drive
  letters, `..` traversal and symlink escapes are all refused — verified by test. Which host
  folder that is = your Docker volume mapping (`./volumes/files:/files` in compose; any Unraid
  share → `/files`). The module's **Test** button checks the root exists and is writable.
- Existing installs pick it up automatically: the entrypoint seeds missing module folders on the
  next container start — just add the `/files` volume mapping.

## v1.4.18 — 2026-07-16

**The ✦ assistant builds modules for real now — tools, not pasted code.**

- **Agent loop with real tools** (both providers): `create_module` writes `mcps/<id>/manifest.json`
  + `index.js` (+ optional `instructions.md`), validates the manifest against the schema, refuses
  reserved/colliding slugs, hot-reloads, and reports the load result — on a load error the
  assistant fixes the file and calls again with the same id until it's live. `reload_modules`
  re-scans everything. "Make one for Gmail" now ends with a working endpoint and its connector
  URL, not a wall of code. Hops are non-streamed per round (tool calls arrive whole) and the
  browser keeps the same SSE protocol, plus 🛠 tool status lines in the chat.
- **Two optional context boxes** above the ✦ composer — *API base URL* and *API docs link* —
  explicitly marked optional: the assistant knows most public APIs from the name alone; fill them
  only to pin it to a specific host or docs page. Values travel inside the message, so they
  persist in history and work on both providers.
- **The module list refreshes itself** when the assistant creates or reloads modules
  (`station:mcps-changed` event → cards re-render), and the seeded instructions teach the
  tool-first workflow; live stations get the same guidance injected via the per-message context.
- **Gemini module v1.1.0 — `gemini_generate_image` actually works now.** It called an
  `images:generate` endpoint that has never existed in Google's API (every call 404'd, found by
  using it). It now calls an image-capable model via `generateContent`
  (default `gemini-2.5-flash-image`) and returns the picture as real MCP image content that
  clients render inline. Live stations: paste the new `mcps/gemini/index.js` via the module's
  Code editor (the volume copy predates this fix).
- **A logo** (`public/assets/logo.png`, also atop the README) — a hexagonal docking hub with four
  module pods, generated by the station's own (freshly fixed) Gemini image tool chain. No gas pumps.

## v1.4.17 — 2026-07-16

**Every module now serves at `/<slug>/mcp` — the path shape the rest of the MCP world uses.**

- The canonical endpoint is `https://host/<slug>/mcp` (e.g. `/siyuan/mcp`); the admin UI's copy-URL,
  the 404 listing and the README all advertise it. Bare `/<slug>` keeps working as an alias, so
  existing tokens, Claude Code CLI configs and old connector URLs are unaffected.
- Protected-resource metadata exists for both forms and echoes the exact URL the client connected
  to (RFC 9728), and the 401 challenge points at the metadata for the exact path that was called.
  Token slug-scoping already parsed the first path segment, so scoped tokens work on both forms.
- Rationale: after v1.4.16 the *path name* was the last wire-visible difference from the working
  SiYuan Companion (`/mcp`) — every hosted endpoint now terminates in `/mcp` like the convention
  claude.ai's backend has always been pointed at.

## v1.4.16 — 2026-07-16

**The machine surface is now indistinguishable from the working Companion, header for header.**

The fresh-subdomain test (station.dbzocchi.app, v1.4.14) reproduced the failure on a hostname
claude.ai had never seen — killing the "claude.ai-side host state" theory and exonerating the
v1.4.14 scope/ASCII fixes in the same stroke. It also identified claude.ai's backend client
(python-httpx) and confirmed its pre-auth `initialize` arrives. What remained were structural
deltas, all removed:

- **The hand-rolled CORS layer is gone.** The Companion serves NO CORS headers on its MCP endpoint
  and only the SDK's own `cors()` on the OAuth routes — now the station is identical (verified
  header-for-header: `/siyuan` answers with no Access-Control headers at all, `/token` with only
  `Access-Control-Allow-Origin: *`). Preflights on the OAuth routes are still handled by the SDK's
  internal cors(); browsers were never the client that mattered here.
- **`trust proxy` removed and `x-powered-by` no longer suppressed** — the Companion sets neither.
  Also silences the per-request express-rate-limit `ERR_ERL_PERMISSIVE_TRUST_PROXY` spam.
- **The `mcp` slug is no longer reserved**, so a module can live at `/mcp` — after this release the
  connector *path name* is the single remaining wire-visible difference from the Companion, and
  renaming a module's slug to `mcp` eliminates even that.

**The /token endpoint can no longer fail silently, and the claude.ai flow is a one-command test.**

- **Every OAuth endpoint response is logged** — status, grant_type, client_id and the OAuth error
  code (never bodies, codes, secrets or token values). The SDK's handlers reject without logging, so
  a 400 from a second `/token` call was invisible: the log ended at "token ISSUED" and looked like
  claude.ai walked away, when it may have come back and been refused. The 2026-07-16 11:19 live
  attempt also showed **two DCR registrations one second apart** — claude.ai's backend makes more
  calls than the old logging showed; now they all leave lines.
- **`scripts/claude-flow-sim.mjs`** — a faithful re-enactment of claude.ai's connector flow
  (WWW-Authenticate discovery, PRM scope echo, DCR as a public client, PKCE S256, form-encoded token
  exchange with `resource`, authenticated initialize/tools, refresh rotation) runnable against the
  live station: `node scripts/claude-flow-sim.mjs https://mcp.example.com /siyuan '<password>'`.
  If it prints FLOW OK against production, the server and transport are exonerated end to end.
- Live probes this session confirmed the **OAuth store is being wiped at rebuild** on the production
  host (a client registered before the rebuild now answers `invalid_client`; the boot line read
  "0 client(s)"). That kills every existing connector on every redeploy — `/data` must map to a
  persistent host volume, exactly as the v1.4.10 notes warned.

## v1.4.14 — 2026-07-16

**The last two observable differences from the working Companion are gone.**

A field-by-field diff of both servers' full live OAuth surfaces (discovery, DCR, token, challenges —
host/path normalized) left exactly two content deltas, so they die on principle; this backend has
already rejected byte-level quirks (base64url token values) that curl and the RFC were fine with:

- **The scope literal `mcp` is out of the flow.** The per-slug protected-resource metadata now
  advertises the slug itself as the scope (`/siyuan` → `scopes_supported: ["siyuan"]`), which
  claude.ai echoes into its authorize request and token grant — for the SiYuan module the granted
  scope is now byte-identical to the working Companion's. The AS metadata no longer lists a global
  scope (modules aren't loaded when it's built; the PRM is the RFC 9728 source anyway).
- **`resource_name` is ASCII-only** (`MCP Station - siyuan`). The em dash was the single non-ASCII
  byte sequence anywhere in the OAuth surface.
- Log the last silent approve outcome: posting the password from a **stale authorize page** (older
  than the 5-minute login ticket, or spanning a restart) returned the "sign-in expired" page without
  logging anything — while claude.ai, never receiving its callback, timed out with the generic
  "Authorization with the MCP server failed". Every approve outcome now leaves a log line.

Live logs (23:49, first attempt on v1.4.13) confirmed the failure signature one more time: authorize →
approve → token ISSUED for `/siyuan` → zero further requests of any kind (the new 404 logging proves
nothing arrived on a wrong path either). Authenticated POSTs demonstrably traverse Cloudflare to this
origin (probed with a garbage bearer), so if this release still shows "token issued then silence", the
remaining variable is claude.ai-side state keyed to this hostname — test by serving the station at a
fresh subdomain (same proxy config, new PUBLIC_URL) and connecting to that.

## v1.4.13 — 2026-07-16

**Every connector was dying within 10 minutes of connecting: `gc()` compared seconds to milliseconds.**

- Access tokens store `expiresAt` in **seconds** (the OAuth wire format `requireBearerAuth` checks);
  `gc()` compared that against `Date.now()` — **milliseconds**. Seconds-epoch is always smaller, so the
  10-minute sweep deleted every live access token it saw, at most 10 minutes after issue. A connector
  would authorize, work briefly, then 401 — and a retry/refresh race on claude.ai's side lands it in
  "Connection issue". This never showed in any end-to-end test because the tests finish inside one
  sweep interval. Auth codes were the mirror image (stored `exp`, swept on `expiresAt`) so they leaked
  instead. Both fixed; refresh tokens keep no server-side expiry, exactly like the Companion.
- **Protected-resource metadata now 404s for unknown slugs.** It used to answer for *any* slug, so a
  typo'd or stale connector URL (an old `_mcp`-suffixed slug, a renamed module) sailed through the
  entire OAuth flow — password page, token, everything — and only failed at the final MCP call with
  claude.ai's generic "Couldn't connect to the server". Now the flow refuses at discovery, before the
  password page, and logs which slug was asked for.
- **The 404 catch-all logs now.** An authenticated call to a wrong path vanished without a trace —
  indistinguishable from "claude.ai never called". Every unmatched request now logs method, path,
  auth presence and user-agent, so the logs finally show what claude.ai does after the token.

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

- Fix: the ✦ popup could not be closed and floated over the settings drawer — `.assistant { display: flex }` overrode the `[hidden]` attribute, so the ✕ / FAB toggle had no visual effect; the panel now also sits below drawers and mo