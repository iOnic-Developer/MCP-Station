# MCP Station — Build Journal

*Written by Claude while building, 2026-07-11. This is the "why and how" record — the living design document. README.md covers usage; this covers thinking.*

---

## 1. The brief (David's words, distilled)

A Docker webapp with a modular front end. Loads a secure page listing MCPs with per-MCP settings (URLs, credentials), add-new, a Claude popup with retained instructions about the site and how to build MCPs that fit, Telegram + Gemini as starter MCPs, each hosted like `https://dbzocchi.app/gemini_mcp`, plus import/export/backup — and the OAuth pattern from the SiYuan ingestor so MCPs can be added to claude.ai permanently. No questions, build it, adjust after.

## 2. Design decisions and why

**One container, many MCPs, path-routed.** Each module gets `PUBLIC_URL/<slug>`. One reverse-proxy entry, one OAuth server, one UI — instead of a container per MCP. The host mounts modules dynamically, so adding an MCP never touches infrastructure.

**OAuth copied from the proven pattern.** The SiYuan Companion (documented in SiYuan → `/SiYuan Companion/Setup & Operating Guide`) already connects to claude.ai permanently. Same recipe here: OAuth 2.1 authorization server in-process — discovery metadata (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/<slug>`), dynamic client registration (`/register`), PKCE S256 only, approval page gated by `APP_PASSWORD`, tokens persisted in `/data`. Plus **dual auth**: a static `MCP_TOKEN` bearer for Claude Code CLI / scripts / n8n, checked before OAuth tokens. claude.ai gets a 401 with `WWW-Authenticate: resource_metadata=…` → discovers → registers → user approves once with the station password → refresh tokens keep it alive permanently.

**Plain ESM JavaScript, no build step.** TypeScript would force a compile on every module edit — and live-editing modules from the UI (paste code from the Claude popup → Save → Reload) is the core workflow of this product. Node 22 + Express 4 + `@modelcontextprotocol/sdk` + zod, nothing else. Every module gets `fetchJson` injected so modules need **zero dependencies of their own**.

**Stateless streamable HTTP.** A fresh `McpServer` per request (`sessionIdGenerator: undefined`, JSON responses). No session bookkeeping, no SSE state, scales trivially, survives restarts invisibly. Matches the current MCP spec's recommended remote transport.

**JSON file state, not a database.** `/data/station.json`, atomic tmp+rename writes, debounced. The Companion proved this at this scale ("keeps no database of its own"). Registry (enabled flags + settings), OAuth clients/codes/tokens, admin sessions, assistant instructions — all one file, trivially backed up, human-readable.

**Secrets encrypted at rest.** AES-256-GCM per value (`enc:v1:iv:tag:cipher`), key derived (scrypt) from `SESSION_SECRET` env or an auto-generated `/data/secret.key`. The UI never echoes secrets back — masked `••••••`, "leave unchanged" semantics on save.

**Modules are folders with a two-file contract.** `manifest.json` (identity + declared settings — the UI renders the settings form from this) and `index.js` (`export register({ server, z, getSettings, log, fetchJson })`, optional `export test(settings, helpers)` which powers the Test button). Hot reload via cache-busted dynamic import — no restart. The **Claude popup's retained instructions teach exactly this contract**, so the assistant always produces paste-ready modules that fit.

**Security model.** Admin UI + OAuth approval behind `APP_PASSWORD` (rate-limited, constant-time compare). Sessions: server-side records + HMAC-signed cookie, 7-day sliding. CSRF: SameSite=Lax + required `x-station-csrf` header on mutations. MCP endpoints: bearer-only, no cookies. Security headers on UI routes; CORS only on machine surfaces (OAuth + MCP endpoints).

## 3. Architecture

```
                        ┌─────────────────────────────────────────┐
 claude.ai  ──OAuth──►  │  MCP Station (Node 22, one container)   │
 Claude Code ─Bearer─►  │                                         │
                        │  /                admin UI (static SPA) │
 Browser ───session──►  │  /api/*           admin REST + SSE      │
                        │  /authorize …     OAuth 2.1 AS          │
                        │  /telegram_mcp    ┐ streamable HTTP     │
                        │  /gemini_mcp      ├ one McpServer per   │
                        │  /<your_mcp>      ┘ request, per module │
                        │                                         │
                        │  /data (volume)   station.json, secret  │
                        │                   key, backups/, trash/ │
                        │  /app/mcps (vol)  module folders        │
                        └─────────────────────────────────────────┘
```

**Request flow, MCP call:** `POST /gemini_mcp` → CORS headers → bearer check (`MCP_TOKEN` or OAuth token from state) → module lookup by slug → enabled? → fresh `McpServer` → `register()` wires tools with that module's decrypted settings → `StreamableHTTPServerTransport.handleRequest`.

**Request flow, claude.ai first connect:** `POST /gemini_mcp` (no token) → 401 + `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/gemini_mcp"` → client fetches resource metadata → AS metadata → `POST /register` (DCR) → browser to `/authorize` → David enters station password (or has an admin session) → code → `POST /token` (PKCE verified) → access + refresh tokens → tools flow.

## 4. Code map

```
server/
  index.js              route wiring, boot, health, 404, GC timer
  lib/env.js            all config from env, single cfg object
  lib/state.js          JSON store: load/save/persist/gc
  lib/crypto.js         key derivation, AES-GCM, HMAC cookies, PKCE sha256
  lib/auth.js           password check, rate limit, sessions, CSRF gate
  lib/oauth.js          full OAuth 2.1 AS + requireBearer + approval page
  lib/mcpHost.js        module scan/load/hot-reload, per-request server,
                        settings (encrypt/decrypt), create/delete module,
                        jailed file editor API, fetchJson helper
  lib/assistant.js      Claude popup backend: Anthropic SSE proxy,
                        system = retained instructions + live station context
  lib/seedInstructions.js  the popup's default brain (module contract,
                        house rules, workflow) — editable in UI
  lib/backup.js         config export/import (JSON), tar.gz backup/restore
mcps/
  _template/            what "➕ Add MCP" copies (placeholder-filled)
  telegram/             ✈️ 5 tools: get_me, send_message, send_photo,
                        get_updates, get_chat
  gemini/               ✨ 4 tools: generate_text, chat, list_models,
                        embed_text
public/                 modular vanilla-JS SPA (no framework, no build)
  index.html            shell
  assets/css/app.css    dark theme, CSS variables
  assets/js/api.js      fetch wrapper (CSRF header, 401 → login)
  assets/js/app.js      bootstrapping, view switching, toasts
  assets/js/views/      login, list, settings, addNew, editor, backup,
                        station (global settings), assistant (popup)
docs/
  BUILD_JOURNAL.md      this file
  BUILDING_MCPS.md      the module contract, human edition
  OAUTH.md              endpoint map + flow detail
CLAUDE.md               orientation for future Claude sessions
Dockerfile / docker-compose.yml / docker-entrypoint.sh
```

## 5. Conventions (tools inside modules)

Straight from the MCP builder guide, enforced by the seed instructions:

- Tool names `service_action` snake_case (`telegram_send_message`).
- `inputSchema` is a **plain object of zod fields** (the SDK wraps it — not `z.object()`).
- `.describe()` on every field; constraints; defaults.
- Annotations always: `readOnlyHint/destructiveHint/idempotentHint/openWorldHint`.
- Errors are instructions ("set bot_token in Settings"), never stack traces.
- Responses truncated ~25 000 chars with guidance; pagination where lists can grow.
- Secrets only via `getSettings()`; modules never log them.

## 6. Work log

| # | What | Commit |
|---|------|--------|
| 1 | Recon: repo empty (README stub), found SiYuan Companion OAuth pattern in SiYuan KB, Todoist plan created (Claude list, parent + 6 subtasks) | — |
| 2 | Scaffold: package.json (3 deps), .env.example, .gitignore, folders | `bf14711` |
| 3 | Core: env/log/crypto/state/auth/oauth libs — full OAuth 2.1 AS with approval page | `bf14711` |
| 4 | Host: module loader + hot reload, per-request McpServer, settings vault, module CRUD + jailed editor; assistant SSE backend + seed instructions; backup/restore; Telegram + Gemini + _template modules; index.js wiring | `8dca196` |
| 5 | Fought the mount: stale `.git/HEAD.lock` (sandbox couldn't unlink) — enabled cowork file-delete, cleared, committing clean since | — |
| 6 | Frontend SPA (login, cards, settings drawer, editor, add-new, backup, station modal) + ✦ popup with SSE streaming + retained instructions | `55e5a0c` |
| 7 | Docker packaging (alpine + tar, seeding entrypoint, healthcheck), README/BUILDING_MCPS/OAUTH/CLAUDE.md/CHANGELOG | `55e5a0c` |
| 8 | Docker Hub lane: no daemon/creds in the build sandbox → GitHub Actions workflow (amd64+arm64, pushes on main; needs `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` repo secrets), backup engine made busybox-pure (stage + plain tar; apk dropped from image), Unraid guide in README. Fought a mount-truncation gremlin on `backup.js`/`smoke.sh` (files stuck part-written on the VM view) — resolved by writing via shell + verifying byte-for-byte before commit | `cd9918c` |
| 9 | Trackers closed: SiYuan project set (hub + ⚙️ Setup & Operations + 🧱 Build Log, wired to 🗂 Projects — Index, orphan-check clean), Todoist build tasks completed + deploy task added (due 12 Jul). `git push` blocked in sandbox (no GitHub auth) — David pushes from his machine | — |
| 10 | **Verification: `scripts/smoke.sh` — 34/34 green.** Auth + rate limit + CSRF, secrets AES-GCM at rest + masked in API, MCP initialize/tools-list/tools-call on both auth lanes, 401 → resource-metadata discovery, DCR, approval → code → PKCE token exchange (bad verifier rejected), refresh rotation (old token consumed), created-module round trip (create → placeholders filled → reload → tools/call works), export secrets/masked, import, backup create/list, 404 fallthrough. Syntax sweep on every JS file clean | `16eae2a` |
| 11 | Sonarr promoted to bundled default module 📺 (sonarr v1.1.0, slug `sonarr_mcp`, station v1.4.23): rewrite of the live hand-built module against the current Sonarr v4 API — `log()` crash fixed (`log.error` on a plain function), queue with `includeSeries`/`includeEpisode` + tracked-state/warnings, `addOptions.monitor`, `addImportListExclusion`, deprecated `/languageprofile` stub skipped, already-added guard, `deleteFiles` default now false (API default), pagination + ~24k truncation. Smoke-tested through a sandbox station against a mock Sonarr v4: 15/15 MCP checks + 3 ▶ Test paths | — |
| 12 | Radarr joins as a bundled default module 🎬 (radarr v1.0.0, slug `radarr_mcp`, station v1.4.25): 9 tools mirroring the sonarr pattern, verified against current Radarr v5 source — `minimumAvailability` (default `released`) + `addOptions.monitor` (movieOnly/movieAndCollection/none) + `searchForMovie` on add; delete uses Radarr's `addImportExclusion` (≠ Sonarr's `addImportListExclusion`); queue with `includeMovie`; lookup accepts name / `tmdb:<id>` / `imdb:<ttid>`; `missing` filter on list. Sandbox station vs mock Radarr v5: 18/18 MCP checks + 3 ▶ Test paths | — |

## 7. Deliberate trade-offs

- **No per-MCP OAuth scoping** — any valid token reaches every enabled MCP. Fine for a single-operator homelab; revisit if the station ever serves multiple users.
- **Open dynamic registration** — anyone can register a client, but tokens only issue after the password-gated approval, same as the Companion. The rate limiter covers brute force.
- **Editor is a textarea, not Monaco** — zero dependencies beats syntax highlighting; the Claude popup writes the code anyway.
- **Restore replaces module folders present in the archive** but doesn't delete extras — safer default; delete manually if truly gone.
- **Port 8788** (Companion uses 8787) so both can run on the same box.

## 8. Status / next

- [x] Backend, frontend, popup, Docker, docs — complete
- [x] End-to-end verified: **34/34 smoke checks** (`bash scripts/smoke.sh`)
- [x] SiYuan project doc, Todoist closure
- [ ] David: `docker compose up -d --build`, set `APP_PASSWORD`/`PUBLIC_URL`/`SESSION_SECRET`/`MCP_TOKEN`, point the dbzocchi.app reverse proxy at :8788, add connectors in claude.ai
- [ ] Later ideas: per-MCP OAuth scopes, scheduled backups, Monaco editor, module marketplace/import-from-zip
