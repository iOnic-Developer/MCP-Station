# Changelog

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
