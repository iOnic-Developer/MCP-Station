# MCP Station + Cloudflare

Three separate things get called "Cloudflare and MCP", and they're worth pulling apart:

1. **Exposing your self-hosted MCP Station through Cloudflare** (Tunnel or a proxied `A`/`CNAME`
   record) so claude.ai can reach a box at home without opening ports.
2. **The one Cloudflare setting that silently kills claude.ai connectors** — AI-bot blocking.
3. **Cloudflare's *own* MCP hosting** (Workers + the Agents SDK) and how it compares to running
   MCP Station — plus adding Cloudflare's hosted MCP servers to Claude alongside yours.

---

## 1. Exposing MCP Station with Cloudflare Tunnel

Cloudflare Tunnel (`cloudflared`) is the cleanest way to put MCP Station on the public internet from
a home lab: no port-forwarding, no static IP, the origin stays unreachable except through Cloudflare,
and you get HTTPS for free.

**The shape:** `claude.ai → https://mcp.example.com (Cloudflare edge) → cloudflared tunnel → http://mcp-station:8788`.

### Quick setup (Docker `cloudflared` sidecar)

1. In the Cloudflare dashboard: **Zero Trust → Networks → Tunnels → Create a tunnel** (Cloudflared).
   Name it, and copy the tunnel **token**.
2. Add a **public hostname** to the tunnel: `mcp.example.com` → service
   `http://mcp-station:8788` (the container name + port on your Docker network).
3. Run `cloudflared` alongside the station:

```yaml
services:
  mcp-station:
    image: dbzocchi/mcp-station:latest
    container_name: mcp-station
    restart: unless-stopped
    environment:
      APP_PASSWORD: change-me
      PUBLIC_URL: https://mcp.example.com   # the tunnel hostname, exactly
      COOKIE_SECURE: "1"
    volumes:
      - ./data:/data
      - ./mcps:/app/mcps
    # no ports: needed — cloudflared reaches it over the Docker network

  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: cloudflared
    restart: unless-stopped
    command: tunnel run
    environment:
      TUNNEL_TOKEN: <your-tunnel-token>
```

4. `docker compose up -d`, then from anywhere: `curl https://mcp.example.com/healthz` → the station's
   JSON. That's your connector base URL.

### Tunnel rules that matter for MCP

- **`PUBLIC_URL` must equal the tunnel hostname** (`https://mcp.example.com`), scheme + host, no path.
  It's the OAuth issuer — see the three rules in the README.
- **Do NOT put Cloudflare Access (the auth wall) in front of the tunnel hostname.** Access adds a
  login redirect that claude.ai can't pass — every connector fails with "authorization failed". The
  station gates itself with `APP_PASSWORD`; it doesn't need Access, and Access breaks it. (The
  station self-checks this at boot: a `PUBLIC_URL` that redirects is flagged loudly in the log.)
- A tunnel serves HTTPS on its own, so `COOKIE_SECURE: "1"`.

### Or: proxied DNS + your own reverse proxy

If you already expose services with SWAG / Nginx Proxy Manager / Caddy and just orange-cloud the DNS
record, that's fine too — a standard HTTPS `proxy_pass` to `:8788` is all the station needs (no
websocket config, no buffering tweaks, no `trust proxy`). You still have to deal with §2 below.

---

## 2. The AI-bot setting that silently kills connectors

This is the single most common "everything looks right but claude.ai won't connect" cause for anyone
behind Cloudflare.

**Symptom:** the connector flow works all the way through the password page, the station log shows
`token ISSUED`, and then… nothing. claude.ai shows *"Couldn't connect to the server"* or
*"Authorization with the MCP server failed."* Meanwhile curl works, browsers work, and even
claude.ai's *pre-auth* probe reaches your server.

**Cause:** Cloudflare's AI-bot blocking. claude.ai's OAuth calls go out with a generic client
(`python-httpx`) and pass — but its actual MCP data-plane calls identify as **`Claude-User`**, which
is on Cloudflare's AI-bots list. The managed rule **"Manage AI bots"** blocks them at the edge with a
403 your origin never sees.

**Fix:**

1. Cloudflare dashboard → your zone → **Security → Settings → Configure AI bot policies** → set
   **Agent → Allow (do not block)**. `Claude-User` is Agent-category (real-time actions on a person's
   behalf); Search/Training categories can stay blocked if you want. On zones still showing the older
   one-click **"Block AI bots"** toggle, turn it **Off**.
2. **AI Crawl Control → Crawlers** → ensure `Claude-User` is **Allow** (a Block here creates hidden
   WAF custom rules — check **Security → WAF → Custom rules** too).
3. Verify in **Security → Events**: filter your hostname; connector attempts must stop logging
   `Manage AI bots / Block` for user-agent `Claude-User`.

**Also, when renaming hostnames:** DNS answers (including *negative* "no such host" answers) are
cached ~5 minutes. A just-created record can look dead and a just-deleted one alive. Judge DNS by an
authoritative query (`nslookup mcp.example.com 1.1.1.1`), not the browser, and give it five minutes.

---

## 3. MCP Station vs Cloudflare's own MCP hosting

Cloudflare also lets you *build and host* remote MCP servers on **Workers**, using the **Agents SDK**
(`McpAgent` / `createMcpHandler`) and `workers-oauth-provider` for auth. The quickest path:

```bash
# authless starter
npm create cloudflare@latest -- my-mcp --template=cloudflare/ai/demos/remote-mcp-authless
cd my-mcp && npm start                      # local dev at http://localhost:8788/mcp
npx wrangler@latest deploy                  # → https://my-mcp.<account>.workers.dev/mcp

# with GitHub OAuth
npm create cloudflare@latest -- my-mcp-auth --template=cloudflare/ai/demos/remote-mcp-github-oauth
```

Streamable HTTP is the current transport; test either with `npx @modelcontextprotocol/inspector`.

### Which should you use?

They solve different problems — this isn't Station *or* Cloudflare, it's knowing which fits.

| | **MCP Station (self-hosted)** | **Cloudflare Workers MCP** |
|---|---|---|
| Runs where | Your box / home lab / VPS | Cloudflare's edge, globally |
| Reaches LAN services (Sonarr, NAS, SiYuan, a POS on your network) | ✅ directly — it's on the same network | ❌ your Worker is on the edge; needs a tunnel back to reach home services |
| Where your API keys live | On your hardware, encrypted at rest | Cloudflare secrets (their platform) |
| New MCP from an API | Paste API docs → assistant writes it → hot reload, seconds | Write a Worker, `wrangler deploy` |
| Multiple MCPs | Unlimited modules, one container, one password | One Worker per server (or route them) |
| Cost model | Your electricity / VPS | Workers requests + Durable Objects (stateful `McpAgent`) |
| Scaling / uptime | Your responsibility | Cloudflare's global network |
| Best for | Home-lab + business tools that live on your network, rapid iteration, data that must stay yours | Public, stateless, globally-distributed MCPs with no home-network dependency |

**Rule of thumb:** if the MCP needs to talk to something on *your* network, or the data must never
leave your hardware, self-host it in MCP Station. If it's a public tool that should run at the edge
with no home-network dependency, a Worker is a great fit. Plenty of people run both.

### Adding Cloudflare's hosted MCP servers to Claude (alongside Station)

Cloudflare also operates a fleet of ready-made remote MCP servers you can connect to Claude *as well
as* your station — they're just more custom connectors:

- **Documentation** (`https://docs.mcp.cloudflare.com/sse`) — up-to-date Cloudflare dev docs
- **Workers Bindings**, **Workers Observability** — build/debug Workers
- **Browser Rendering** — fetch pages, screenshot, HTML→markdown
- **Radar** — global internet traffic insights, URL scans
- **AI Gateway**, **AutoRAG**, **Logpush**, **DNS Analytics**, **Audit Logs**, **Container**,
  **Digital Experience Monitoring**, **Cloudflare One CASB**

Base URL pattern: `https://<name>.mcp.cloudflare.com/sse`. In claude.ai: Settings → Connectors → add
the URL and authenticate with your Cloudflare account. For clients without native remote-MCP support,
Cloudflare's own `mcp-remote` proxy bridges a local client to the remote server.

None of that competes with MCP Station — it's complementary. Station hosts *your* modules for *your*
services; Cloudflare's hosted servers give Claude a window into your Cloudflare account.

---

## Sources

- [Build and deploy Remote MCP servers to Cloudflare — Cloudflare blog](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/)
- [Build a Remote MCP server — Cloudflare Agents docs](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- [Thirteen new MCP servers from Cloudflare — Cloudflare blog](https://blog.cloudflare.com/thirteen-new-mcp-servers-from-cloudflare/)
