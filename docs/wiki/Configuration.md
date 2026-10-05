# Configuration

Everything about the station itself is set with environment variables. **Module settings** (API keys,
service URLs) are not — they live in each module's ⚙ Settings panel, encrypted in `/data`.

## Required

| Variable | Notes |
|---|---|
| `APP_PASSWORD` | Admin login **and** the password on the OAuth consent page. Use a strong one. |
| `PUBLIC_URL` | The exact public HTTPS origin, e.g. `https://mcp.example.com`. It's the OAuth issuer — needed for claude.ai. Leave unset for local-only use (OAuth off, bearer tokens still work). |

### The `PUBLIC_URL` rules

1. Scheme + hostname only, no path. It must match the host in your connector URLs.
2. Change the hostname → change `PUBLIC_URL` and restart.
3. It must reach the station **directly** — no auth wall or redirect (no Cloudflare Access) in front.
   The station checks this at boot and logs a warning.

## Recommended

| Variable | Default | Notes |
|---|---|---|
| `COOKIE_SECURE` | off | Set `1` when served over HTTPS. |
| `MCP_TOKEN` | — | Station-wide bearer that opens every module (Claude Code, scripts). Unset = OAuth and per-module tokens only. |
| `SESSION_SECRET` | generated | Leave unset and a key is generated in `/data/secret.key`. If you set it, choose the final value **before** configuring modules — changing it later makes encrypted settings unreadable. |
| `FILES_DIR` | `/files` | Folder the 📁 Files module is jailed to. Map a host folder here. |

## ✦ assistant

The assistant can use OpenAI, Claude or Gemini. Keys can be set here **or** saved (encrypted) in
⚙ Station settings; an env var wins when both are set. The UI provider toggle overrides
`ASSISTANT_PROVIDER`.

| Variable | Default | Notes |
|---|---|---|
| `ASSISTANT_PROVIDER` | `openai` (2.x) | `openai`, `anthropic` or `gemini`. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | — / `gpt-6-astra` | OpenAI, via the Responses API. |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | — / `claude-sonnet-4-6` | Claude. |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | — / `gemini-2.5-flash` | Gemini. |
| `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` / `GEMINI_BASE_URL` | vendor APIs | Origin only, no path — route through a gateway such as OmniRoute or LiteLLM. |
| `ASSISTANT_HEARTBEAT_MS` | `15000` | Keep-alive interval for the streaming reply. Lower it if a proxy closes idle responses sooner. |

## Tuning

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8788` | Match your port mapping. |
| `DATA_DIR` | `/data` | State, OAuth store, encryption key, backups, trash. |
| `MCPS_DIR` | `/app/mcps` | Module folders. |

## Volumes

| Container path | Holds | Must persist? |
|---|---|---|
| `/data` | `station.json` (state + OAuth store), `secret.key`, `backups/`, `trash/` | **Yes** — or every connector dies on redeploy |
| `/app/mcps` | Module folders (seeded on first boot) | Yes, to keep your own modules and edits |
| `/files` | The 📁 Files module's storage | If you use it |

## Example

```yaml
services:
  mcp-station:
    image: dbzocchi/mcp-station:2.4.0
    restart: unless-stopped
    ports: ["8788:8788"]
    environment:
      APP_PASSWORD: change-me
      PUBLIC_URL: https://mcp.example.com
      COOKIE_SECURE: "1"
      MCP_TOKEN: ""
      ASSISTANT_PROVIDER: openai
      OPENAI_API_KEY: ""
    volumes:
      - ./data:/data
      - ./mcps:/app/mcps
      - ./files:/files
```
