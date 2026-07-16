# ⛽ MCP Station

**Self-hosted multi-MCP server host.** Drop a module folder in `mcps/`, get a remote MCP endpoint
at `https://your-host/<module>/mcp` that connects to **claude.ai (web + mobile)** as a custom
connector, to **Claude Code** via bearer token, and to any other MCP client that speaks
streamable HTTP. One container, one password, unlimited MCPs.

```
https://mcp.example.com/siyuan/mcp        → SiYuan knowledge base MCP  📓
https://mcp.example.com/gemini_mcp/mcp    → Google Gemini MCP          ✨
https://mcp.example.com/telegram_mcp/mcp  → Telegram MCP               ✈️
https://mcp.example.com/<anything>/mcp    → whatever you build next    🪄
```

## 🪄 AI-generated MCPs — turn any API into a connector

You don't have to write modules yourself. The built-in **✦ assistant** (Claude or Gemini) lives
in the station UI, knows the exact module contract, and sees the station's live context — so you
can open ➕ Add MCP, describe what you want, and paste in whatever you have:

- a REST API's docs page, an OpenAPI spec, or just a couple of example `curl` calls
- a service you use (weather, home automation, your NAS, an RSS feed, a database…)
- an existing script you want claude.ai to be able to call

…and it writes the complete module — `manifest.json` with a settings form for the API keys,
`index.js` with typed tools, descriptions Claude understands — straight into the in-browser
editor. **⤵ Insert**, toggle it on, and it's a live MCP endpoint at `/<slug>/mcp` you can add to
claude.ai thirty seconds later. Hot reload, no rebuilds, no SDK boilerplate, no local tooling.
If it speaks HTTP, it can be an MCP.

- **Modules are folders** — `manifest.json` + `index.js` (+ optional `instructions.md`). Hot
  reload, no restarts. A `_template` module is included, and the ✦ assistant writes new modules
  for you in the browser (see above).
- **OAuth 2.1 authorization server built in** — discovery metadata, dynamic client registration,
  PKCE S256, rotating refresh tokens, all served by the official MCP SDK's own auth router. A
  single station password gates the consent page. This is what lets claude.ai connect by URL
  alone.
- **Three ways to authenticate**: claude.ai OAuth (per-MCP scoped tokens), a station-wide
  `MCP_TOKEN` (master key for Claude Code / scripts), and per-module tokens (hand one endpoint
  to a script without the keys to the station).
- **Admin SPA** — module cards with toggle/test/copy-URL, in-browser code editor, per-module
  settings with encrypted secrets (AES-256-GCM at rest, never echoed back), live logs of every
  OAuth and MCP request, capabilities inspector (see exactly what tools a module exposes before
  trusting it), import/export and one-click tar.gz backup/restore.

---

## Quick start (Docker Compose)

```yaml
services:
  mcp-station:
    image: dbzocchi/mcp-station:latest
    container_name: mcp-station
    restart: unless-stopped
    ports:
      - "8788:8788"
    environment:
      APP_PASSWORD: change-me                 # admin UI login + OAuth consent password
      PUBLIC_URL: https://mcp.example.com     # your public HTTPS hostname — see rules below
      MCP_TOKEN: ""                           # optional static bearer for Claude Code / scripts
      COOKIE_SECURE: "1"                      # you are behind HTTPS
    volumes:
      - ./data:/data                          # state, OAuth store, encryption key — MUST persist
      - ./mcps:/app/mcps                      # module folders (seeded on first boot)
```

```bash
docker compose up -d
curl http://localhost:8788/healthz   # → {"ok":true,"version":"…","modules":3,"oauth":true}
```

Open `http://host:8788`, log in with `APP_PASSWORD`, configure each module's settings
(e.g. the SiYuan module needs your SiYuan URL + API token — **settings live in the UI, not in
env vars**).

### The three `PUBLIC_URL` rules

`PUBLIC_URL` is the OAuth **issuer**. Connectors break in confusing ways when it's wrong:

1. It must be the **exact public HTTPS origin** clients connect to — scheme + hostname, no path.
   `https://mcp.example.com` ✅ · trailing slash is fine (stripped) · a different hostname than
   the one in the connector URL ❌
2. If you **change the hostname later**, change `PUBLIC_URL` and restart — a connector URL on
   host A with an issuer claiming host B fails authorization by design.
3. It must reach the station **directly** — no auth wall, no redirect in front of it. The
   station self-checks this at boot and logs the result.

---

## Connecting clients

**claude.ai (web / mobile / desktop) — permanent, OAuth:**
Settings → Connectors → **Add custom connector** → `https://mcp.example.com/<module>/mcp` →
a popup shows the station's consent page → enter `APP_PASSWORD` → connected. Tokens are scoped
to that one module and refresh automatically (1 h access, rotating refresh).

**Claude Code CLI — static token:**

```bash
claude mcp add --transport http siyuan https://mcp.example.com/siyuan/mcp \
  --header "Authorization: Bearer <MCP_TOKEN or per-module token>"
```

**Anything else** that speaks MCP streamable HTTP: same URL, same bearer header. The bare
`/<module>` path (no `/mcp` suffix) also works and is kept for backwards compatibility.

**Testing the full claude.ai flow without claude.ai** (discovery → registration → PKCE →
consent → token → tools):

```bash
node scripts/claude-flow-sim.mjs https://mcp.example.com /siyuan/mcp '<APP_PASSWORD>'
# FLOW OK — server + transport are healthy end to end
```

---

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

**Variables:**

| Variable | Required | Example / notes |
|---|---|---|
| `APP_PASSWORD` | ✅ | admin login + OAuth consent password |
| `PUBLIC_URL` | ✅ for claude.ai | `https://mcp.example.com` — see the three rules above |
| `PORT` | — | `8788` (match the port mapping) |
| `MCP_TOKEN` | — | static bearer for Claude Code / scripts |
| `COOKIE_SECURE` | — | `1` when served over HTTPS |
| `SESSION_SECRET` | — | leave **unset** (a key is generated and persisted in `/data`). If you set it, pick the final value **before** configuring modules — changing it later makes encrypted settings unreadable |
| `ASSISTANT_PROVIDER` | — | `anthropic` or `gemini` (the ✦ assistant popup) |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | — | assistant on Claude |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | — | assistant on Gemini |

> Module settings such as a SiYuan URL/token are **not** env vars — set them in the station UI
> per module. They're stored encrypted in `/data` and mirrored into the module folder.

After starting: browse to `https://<your-hostname>` (or `http://<unraid-ip>:8788`) → log in →
configure modules. Check the container log's boot line: if it says the OAuth store loaded
`0 client(s)` after you previously had working connectors, your `/data` mapping isn't
persisting.

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
      APP_PASSWORD: change-me
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

## Cloudflare — read this if connectors fail after the password page

If your station sits behind Cloudflare (orange-clouded DNS), one zone setting can silently kill
claude.ai connectors while every test you run passes:

**Symptom:** the connector flow works all the way through the password page, the station log
shows `token ISSUED`, and then… nothing. claude.ai shows *"Couldn't connect to the server"* or
*"Authorization with the MCP server failed."* Meanwhile curl works, browsers work, and even
claude.ai's *pre-auth* probe reaches your server.

**Cause:** Cloudflare's AI-bot blocking. claude.ai's OAuth calls go out with a generic client
(`python-httpx`) and pass — but its actual MCP data-plane calls identify as **`Claude-User`**,
which is on Cloudflare's AI-bots list. The managed rule **"Manage AI bots"** blocks them at the
edge with a 403 your origin never sees.

**Fix:**

1. Cloudflare dashboard → your zone → **Security → Settings → Configure AI bot policies** →
   set **Agent → Allow (do not block)**. (`Claude-User` is Agent-category: real-time actions on
   a person's behalf. Search/Training categories can stay blocked if you want.)
   On zones still showing the older one-click **"Block AI bots"** toggle: turn it **Off**.
2. Check **AI Crawl Control → Crawlers** → ensure `Claude-User` is **Allow** (a Block here
   creates hidden WAF custom rules — check **Security → WAF → Custom rules** too).
3. Verify in **Security → Events**: filter your hostname; connector attempts must stop logging
   `Manage AI bots / Block` for user-agent `Claude-User`.

**Also, when renaming hostnames:** DNS answers (including *negative* "no such host" answers) are
cached for ~5 minutes. A just-created record can look dead and a just-deleted one alive. Judge
DNS changes by an authoritative query (`nslookup <name> 1.1.1.1`), not by the browser, and give
changes five minutes.

**Reverse proxy (SWAG / NPM / Caddy / plain nginx):** nothing special — a standard HTTPS
`proxy_pass` to `:8788` is all the station needs. No websocket config, no buffering tweaks, no
`trust proxy` anywhere.

---

## Writing a module

A module is a folder in `mcps/`:

```
mcps/my-module/
├── manifest.json     # id, slug, name, icon, description, settings[]
├── index.js          # export function register({ server, z, getSettings, log, fetchJson })
└── instructions.md   # optional — served to every client as MCP instructions at initialize
```

`manifest.json` declares the URL slug and the settings form (types: `text`, `secret` —
secrets are encrypted at rest and masked in the UI). `register()` receives the MCP `server` to
add tools/prompts to, a zod instance `z` for schemas, `getSettings()` for live config, and
helpers. Copy `mcps/_template`, or open any module's ✦ Chat in the station UI and ask the
assistant to write one — it knows the contract.

Each module card shows 🧰 **Tools** (live capabilities inspection — what a client actually
sees), 🔑 **Access** (per-module token + connected clients with revoke), and the code editor.

---

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| Password page works, then "Couldn't connect" / auth failed; log ends at `token ISSUED` | Cloudflare blocking `Claude-User` — see the Cloudflare section above |
| "Authorization with the MCP server failed" immediately | Hostname in the connector URL ≠ `PUBLIC_URL`, or a stale authorize page (>5 min old) — fix `PUBLIC_URL`/restart, retry fresh |
| "Couldn't register with the sign-in service" | Hostname doesn't resolve (DNS caching after a rename), or `/register` rate-limited after many attempts (20/h — restarting the container resets it) |
| Connectors die whenever you redeploy | `/data` isn't on a persistent volume — boot log says `0 client(s)` |
| Connector connects but every tool call errors "not configured" | Module settings are blank — set them in the station UI (not env vars) |
| Connect flow 404s before the password page | Wrong module slug in the URL — the 404 body lists the hosted MCPs, and unknown slugs are refused at discovery on purpose |
| Module responds 404 with a valid token | Module is toggled off in the UI |

The **Logs panel** (admin UI) records every OAuth endpoint response and every MCP request with
status, auth mode and user-agent — whatever a client does, it leaves a line. For a full
client-side re-enactment, run `scripts/claude-flow-sim.mjs` (above).

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
modules in `/app/mcps`. Backup = tar of both (or use the UI's backup button).
