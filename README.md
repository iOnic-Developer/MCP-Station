# ⛽ MCP Station

Self-hosted hub that **builds, configures and serves MCP servers** — each one at its own URL on your domain, connectable to claude.ai permanently via OAuth, manageable from a secure web UI with a built-in Claude assistant that knows how to write modules for it.

```
https://dbzocchi.app/             → admin UI (password-gated)
https://dbzocchi.app/telegram_mcp → Telegram MCP  ✈️
https://dbzocchi.app/gemini_mcp   → Gemini MCP    ✨
https://dbzocchi.app/<yours>      → anything you add next
```

## Features

- **Modular MCP hosting** — every folder in `mcps/` becomes a streamable-HTTP MCP endpoint at `/<slug>`. Hot reload, no restarts.
- **OAuth 2.1 built in** (dynamic client registration + PKCE, password-gated approval) so claude.ai web/phone can add each MCP as a custom connector — plus a static `MCP_TOKEN` bearer for Claude Code CLI, n8n and scripts. Same proven pattern as the SiYuan Companion.
- **Secure admin UI** — list MCPs, toggle, per-MCP settings rendered from each module's manifest (secrets AES-256-GCM encrypted at rest, never echoed back), connectivity **Test** buttons, in-browser code editor, logs.
- **➕ Add MCP** — scaffolds a new module from the template; the **✦ Claude popup** (retained, editable instructions — it knows this station and the exact module contract) writes complete paste-ready modules on request.
- **Import / export / backup** — portable JSON config export/import, one-click tar.gz backups (state + module code) kept server-side and downloadable, restore from list or upload.

## Quick start

```bash
git clone https://github.com/iOnic-Developer/MCP-Station.git
cd MCP-Station
# edit docker-compose.yml: APP_PASSWORD, PUBLIC_URL, SESSION_SECRET, MCP_TOKEN
docker compose up -d --build
```

Open `http://host:8788`, sign in with `APP_PASSWORD`. Put it behind your reverse proxy (SWAG / Nginx Proxy Manager) as `dbzocchi.app` with HTTPS and set `COOKIE_SECURE=1`.

## Unraid (Docker Hub image)

CI builds `<dockerhub-user>/mcp-station:latest` (amd64 + arm64) on every push to main — see `.github/workflows/docker.yml`; it needs two repo secrets on GitHub: `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (a hub.docker.com PAT with Read & Write).

Unraid → Docker → **Add Container**:

| Field | Value |
|---|---|
| Repository | `<dockerhub-user>/mcp-station:latest` |
| Port | `8788` → `8788` |
| Path `/data` | `/mnt/user/appdata/mcp-station/data` |
| Path `/app/mcps` | `/mnt/user/appdata/mcp-station/mcps` |
| Env | `APP_PASSWORD`, `PUBLIC_URL=https://dbzocchi.app`, `SESSION_SECRET`, `MCP_TOKEN`, `COOKIE_SECURE=1`, optional `ANTHROPIC_API_KEY` |

Then point the reverse proxy (SWAG/NPM) for `dbzocchi.app` at `:8788`. Port 8788 because the SiYuan Companion already owns 8787.

No Docker Hub? Build straight from the repo on any box with Docker: `docker compose up -d --build`.

## Environment

| Variable | Default | What it does |
|---|---|---|
| `APP_PASSWORD` | *(required)* | Admin UI login + OAuth approval gate |
| `PUBLIC_URL` | *(unset → OAuth off)* | Public https base, e.g. `https://dbzocchi.app` — enables the OAuth server |
| `SESSION_SECRET` | *(auto-generated)* | Fixed random string: sessions + encrypted secrets survive container rebuilds (otherwise a key is persisted at `/data/secret.key`) |
| `MCP_TOKEN` | *(unset)* | Static bearer accepted on every MCP endpoint |
| `ANTHROPIC_API_KEY` | *(unset)* | Powers the ✦ popup (or set it in the UI, stored encrypted) |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Popup model |
| `PORT` | `8788` | Listen port |
| `COOKIE_SECURE` | `0` | Set `1` behind HTTPS |
| `DATA_DIR` / `MCPS_DIR` | `/data` / `/app/mcps` | Volumes |

## Connecting MCPs to Claude

**claude.ai (permanent, OAuth):** Settings → Connectors → **Add custom connector** → paste e.g. `https://dbzocchi.app/gemini_mcp` → the browser lands on the station's approval page → enter `APP_PASSWORD` → done. Tokens refresh automatically (access 30 d, refresh 180 d, rotating).

**Claude Code CLI (static bearer):**
```bash
claude mcp add --transport http gemini https://dbzocchi.app/gemini_mcp \
  --header "Authorization: Bearer $MCP_TOKEN"
```

## Endpoint map

| Group | Endpoints |
|---|---|
| UI / API | `/` · `/api/login` · `/api/mcps` · `/api/assistant` (SSE) · `/api/export` · `/api/import` · `/api/backup(s)` · `/api/restore` · `/api/logs` · `/healthz` |
| MCP | `POST /<slug>` (stateless streamable HTTP) |
| OAuth | `/.well-known/oauth-authorization-server` · `/.well-known/oauth-protected-resource/<slug>` · `/register` · `/authorize` · `/oauth/approve` · `/token` · `/revoke` |

## Building your own MCP

Read **[docs/BUILDING_MCPS.md](docs/BUILDING_MCPS.md)** — or just ask the ✦ popup, that's what it's for. Short version: `➕ Add MCP` → open **Code** → fill `manifest.json` (declares settings the UI renders) and `index.js` (`export function register({ server, z, getSettings, log, fetchJson })`) → **Save & reload** → **Settings** → **Test** → connect.

## More docs

- [docs/BUILD_JOURNAL.md](docs/BUILD_JOURNAL.md) — design decisions, architecture, work log
- [docs/BUILDING_MCPS.md](docs/BUILDING_MCPS.md) — the module contract
- [docs/OAUTH.md](docs/OAUTH.md) — auth flows in detail
- [CLAUDE.md](CLAUDE.md) — orientation for AI sessions working on this repo

## Ops notes

- **Backups** land in `/data/backups` (last 20 kept). They include `secret.key` — restoring on a box with a *different* `SESSION_SECRET` env means stored secrets can't decrypt; keep the same secret or re-enter credentials.
- Deleted modules go to `/data/trash`, not oblivion.
- `GET /healthz` for uptime checks.
