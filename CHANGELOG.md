# Changelog

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
