# Quick Start

The shortest path to a running station and your first claude.ai connector.

## 1. Run it

```yaml
# docker-compose.yml
services:
  mcp-station:
    image: dbzocchi/mcp-station:latest
    container_name: mcp-station
    restart: unless-stopped
    ports:
      - "8788:8788"
    environment:
      APP_PASSWORD: change-me-to-something-strong
      PUBLIC_URL: https://mcp.example.com   # your public HTTPS hostname
      COOKIE_SECURE: "1"
    volumes:
      - ./data:/data
      - ./mcps:/app/mcps
```

```bash
docker compose up -d
curl http://localhost:8788/healthz    # → {"ok":true,"version":"…","modules":8,"oauth":true}
```

Not exposing it yet? Leave `PUBLIC_URL` unset to run local-only (OAuth off; the `MCP_TOKEN` bearer
still works). To expose a home box, a [Cloudflare Tunnel](../CLOUDFLARE.md) is the easiest route.

## 2. Log in & configure

Open `http://<host>:8788`, log in with `APP_PASSWORD`. Each module needs its settings (API keys,
service URLs) filled in from its ⚙ **Settings** panel — **not** env vars. Hit ▶ **Test** to confirm
it reaches the real service.

## 3. Connect claude.ai

In claude.ai: **Settings → Connectors → Add custom connector** →
`https://mcp.example.com/<module>/mcp` → a popup shows the station's consent page → enter your
`APP_PASSWORD` → connected. The token is scoped to that one module and refreshes automatically.

## 4. (Optional) grab the skill

On the module card, 📄 **Skill** downloads a Claude skill `.zip` (about + live tool list). Upload it
in claude.ai → Settings → Capabilities → Skills so Claude knows how to use the module well.

## 5. Add your own MCP

➕ **Add MCP** → describe what you want or paste an API's docs → the ✦ assistant writes the module →
Insert → toggle on. It's live at `/<your-slug>/mcp`.

That's it. See [Use Cases](Use-Cases) for ideas and [Building a Module](Building-a-Module) for the
contract.
