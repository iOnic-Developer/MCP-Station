# Stable 2.4 technical reference

Retained from the previous README so the product rewrite does not discard operational guidance.
This is historical stable documentation, not evidence that the branch preview is published.
Provider/model defaults below are application configuration strings, not availability guarantees.
Use the current [Quick Start](wiki/Quick-Start.md), [Configuration](wiki/Configuration.md),
[Connections](wiki/Connecting-Claude.md), and [Backups](wiki/Backups.md) first.
Proxy troubleshooting is a diagnostic starting point, not a guarantee about the cause of a failure.
The Compose password example has been hardened; keep secrets out of version control.

## Unraid

Docker tab → **Add Container**:

| Field | Value |
|---|---|
| Repository | `dbzocchi/mcp-station:latest` |
| Network Type | Bridge |
| Port | `8788` → container `8788` |

**Paths** (add both — without persistent `/data` every connector dies on redeploy):

| Host path | Container path | Purpose |
|---|---|---|
| `/mnt/user/appdata/mcp-station/data` | `/data` | OAuth store, encrypted settings, key, backups |
| `/mnt/user/appdata/mcp-station/mcps` | `/app/mcps` | module folders (seeded on first boot) |
| `/mnt/user/mcp-files` (anywhere you like) | `/files` | the 📁 Files module's storage root — where Claude saves things |

**Variables:**

| Variable | Required | Example / notes |
|---|---|---|
| `APP_PASSWORD` | ✅ | admin login + OAuth consent password |
| `PUBLIC_URL` | ✅ for claude.ai | `https://mcp.example.com` — see the three rules above |
| `PORT` | — | `8788` (match the port mapping) |
| `MCP_TOKEN` | — | static bearer for Claude Code / scripts |
| `COOKIE_SECURE` | — | `1` when served over HTTPS |
| `SESSION_SECRET` | — | leave **unset** (a key is generated and persisted in `/data`). If you set it, pick the final value **before** configuring modules — changing it later makes encrypted settings unreadable |
| `FILES_DIR` | — | container path the 📁 Files module is jailed to (default `/files`); the module's `root_dir` UI setting overrides it. Map a host folder to this path |
| `ASSISTANT_PROVIDER` | — | `openai` (default on 2.x), `anthropic` or `gemini` — the ✦ assistant popup; the UI toggle overrides it |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | — | assistant on OpenAI (default model `gpt-6-astra`) |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | — | assistant on Claude |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | — | assistant on Gemini |
| `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` / `GEMINI_BASE_URL` | — | API origin overrides — route the assistant through a gateway such as OmniRoute or LiteLLM |

> Assistant keys can also be saved (encrypted) in **⚙ Station** settings instead of env vars; an env
> var wins when both are set.

> Module settings such as a SiYuan URL/token are **not** env vars — set them in the station UI per
> module. Secret-type fields are encrypted in `/data` and mirrored into the module folder; ordinary fields are not secret storage.

After starting: browse to `https://<your-hostname>` (or `http://<unraid-ip>:8788`) → log in →
configure modules. Check the container log's boot line: if it says the OAuth store loaded
`0 client(s)` after you previously had working connectors, your `/data` mapping isn't persisting.

---

## TrueNAS SCALE (custom app YAML)

Apps → **Discover Apps** → ⋮ → **Install via YAML**:

```yaml
services:
  mcp-station:
    image: dbzocchi/mcp-station:latest
    container_name: mcp-station
    restart: unless-stopped
    ports:
      - "8788:8788"
    environment:
      APP_PASSWORD: ${APP_PASSWORD:?set APP_PASSWORD in .env}
      PUBLIC_URL: https://mcp.example.com
      COOKIE_SECURE: "1"
      MCP_TOKEN: ""
    volumes:
      - /mnt/tank/apps/mcp-station/data:/data
      - /mnt/tank/apps/mcp-station/mcps:/app/mcps
```

Create the two datasets/directories first (`…/data`, `…/mcps`) and point the volumes at them.
Everything from the Unraid variable table applies unchanged.

---

## Cloudflare

Two things people ask about — putting the station behind Cloudflare, and how it relates to
Cloudflare's own MCP hosting. Both are covered in depth in **[Cloudflare](CLOUDFLARE.md)**
(Cloudflare Tunnel setup, the AI-bot-blocking gotcha, and MCP Station vs Workers-hosted MCPs). The
one that bites everyone:

**If connectors fail *after* the password page** and the station log shows `token ISSUED` then
silence, it's almost always Cloudflare's **AI-bot blocking**. claude.ai's OAuth calls go out as a
generic client and pass, but its actual MCP data-plane calls identify as **`Claude-User`**, which
Cloudflare's managed "Manage AI bots" rule blocks at the edge with a 403 your origin never sees.

**Fix:** Cloudflare dashboard → your zone → **Security → Settings → Configure AI bot policies** → set
**Agent → Allow**. Then check **AI Crawl Control → Crawlers** (allow `Claude-User`) and
**Security → WAF → Custom rules**. Verify in **Security → Events** that connector attempts stop
logging `Manage AI bots / Block` for user-agent `Claude-User`. Full walkthrough in the Cloudflare
doc.

**Reverse proxy (SWAG / NPM / Caddy / plain nginx):** nothing special — a standard HTTPS `proxy_pass`
to `:8788` is all the station needs. No websocket config, no buffering tweaks, no `trust proxy`.

---

## Writing a module

A module is a folder in `mcps/`:

```
mcps/my-module/
├── manifest.json     # id, slug, name, icon, description, settings[]
├── index.js          # export function register({ server, z, getSettings, log, fetchJson })
└── instructions.md   # optional — served to every client as MCP instructions at initialize
```

`manifest.json` declares the URL slug and the settings form (types: `text`, `secret`, `select`,
`textarea` — secret fields are encrypted at rest and masked in the UI). `register()` receives the MCP
`server` to add tools/prompts to, a zod instance `z` for schemas, `getSettings()` for live config,
and helpers. Copy `mcps/_template`, or open any module's ✦ Chat in the station UI and ask the
assistant to write one — it knows the contract. Full contract in
**[Module contract](BUILDING_MCPS.md)**.

Each module card shows 🧰 **Tools** (live capabilities inspection — what a client actually sees),
🔑 **Access** (per-module token + connected clients with revoke), and the code editor.

---

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| Password page works, then "Couldn't connect" / auth failed; log ends at `token ISSUED` | Cloudflare blocking `Claude-User` — see the Cloudflare section / doc |
| "Authorization with the MCP server failed" immediately | Hostname in the connector URL ≠ `PUBLIC_URL`, or a stale authorize page (>5 min old) — fix `PUBLIC_URL`/restart, retry fresh |
| "Couldn't register with the sign-in service" | Hostname doesn't resolve (DNS caching after a rename), or `/register` rate-limited after very many attempts (200/h — restarting the container resets it) |
| "You have exceeded the rate limit for token requests" / `too_many_requests` on every connect | Fixed in v2.4.0: `2.2.0_alpha` builds made some clients refresh in a loop, and the SDK's `/token` limit (50 per 15 min) is shared by the whole station behind a proxy. Update to `2.4.0` and restart — a restart also clears the limit |
| Connector keeps asking you to sign in again | It was approved with a 1 day / 1 week / 1 month lifetime, or on a 1.x image (1-hour tokens that depended on the client refreshing). Reconnect on `2.4.0` and leave *Stay signed in for* on **Unlimited** |
| Connectors die whenever you redeploy | `/data` isn't on a persistent volume — boot log says `0 client(s)` |
| Connector connects but every tool call errors "not configured" | Module settings are blank — set them in the station UI (not env vars) |
| Connect flow 404s before the password page | Wrong module slug in the URL — the 404 body lists the hosted MCPs, and unknown slugs are refused at discovery on purpose |
| Module responds 404 with a valid token | Module is toggled off in the UI |

The **Logs panel** (admin UI) records every OAuth endpoint response and every MCP request with
status, auth mode and user-agent — whatever a client does, it leaves a line. For a full client-side
re-enactment, run `scripts/claude-flow-sim.mjs` (above). More diagnostics in
**[OAuth](OAUTH.md)**.

---

## Endpoints reference

| Surface | Path |
|---|---|
| MCP (canonical) | `POST /<slug>/mcp` — stateless streamable HTTP; `/<slug>` kept as alias |
| OAuth discovery | `/.well-known/oauth-authorization-server` · `/.well-known/oauth-protected-resource/<slug>/mcp` |
| OAuth flow | `/register` · `/authorize` · `/oauth/approve` · `/token` · `/revoke` |
| Health | `GET /healthz` → `{ok, version, modules, oauth}` |
| Admin UI / API | `/` · `/api/*` (session cookie, same-origin) |

Data lives in `/data` (`station.json` state + OAuth store, `secret.key`, `backups/`, `trash/`);
modules in `/app/mcps`. Use the full station backup for account instances and usage. Back up external Files storage separately; see [Backups](wiki/Backups.md).

---

## Development & testing

No build step, no TypeScript — plain ESM, three runtime deps (`express`, `zod`, the MCP SDK).

```bash
npm install
APP_PASSWORD=test PUBLIC_URL=http://localhost:8788 node server/index.js

npm test                 # full smoke suite (auth, PKCE round-trip, MCP handshake, lifecycle)
npm run test:openai      # ✦ assistant on the OpenAI Responses API, against a mock
npm run test:ui          # dashboard JavaScript syntax checks
npm run test:oauth       # OAuth 2.1 conformance + abuse suite, incl. sign-in lifetimes
npm run test:scoping     # per-MCP token / OAuth scoping
npm run test:selfcontained  # delete-a-module-and-restore drill
```

Contributions welcome — see **[Contributing](../CONTRIBUTING.md)**. Security reports:
**[Security](../SECURITY.md)**. Roadmap: **[Roadmap](ROADMAP.md)**.

## License

[MIT](../LICENSE).
