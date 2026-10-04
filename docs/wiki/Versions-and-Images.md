# Versions & Images

MCP Station ships as one multi-arch image (`linux/amd64`, `linux/arm64`) on Docker Hub:
**[`dbzocchi/mcp-station`](https://hub.docker.com/r/dbzocchi/mcp-station)**.

## Which tag?

| Tag | What it is | Built from |
|---|---|---|
| `latest` | Stable release (currently **v1.8.0**) | `main` |
| `2.2.0_alpha` | Newest features. Rebuilt on every push to the branch | `alpha/2.2.0` |
| `2.2.0_alpha-<sha>` | One specific alpha build, pinned to a commit | `alpha/2.2.0` |
| `2.1.0_alpha`, `2.0.0`, `1.x.y` | Older releases, kept for rollback | — |

Alpha builds never move `latest`. If you want an alpha build that won't change under you, use the
`-<sha>` tag.

## What's in 2.2.0 alpha

Compared with v1.8.0 (`latest`):

**Sign-ins you control — Unlimited by default**
- The OAuth consent page asks *Stay signed in for*: 1 day, 1 week, 1 month or **Unlimited**
  (preselected).
- The access token lasts for the whole period you choose instead of one hour, so a connector no
  longer drops out when the client misses a refresh. Refreshing never extends a limited sign-in.
- Generating or rotating a per-module token offers the same choice.
- 🔑 Access shows each connection's real end date ("never" for unlimited).
- Connections made on an older image become unlimited the next time they refresh.

**✦ assistant**
- OpenAI is the default provider (GPT-6 Astra over the Responses API). Claude and Gemini remain
  available — see [Configuration](Configuration).
- No fixed limit on tool rounds, so long build sessions don't stop part-way.

**Image**
- Based on `node:22-bookworm-slim` (Debian) instead of Alpine.
- Ships the **Proton Pass CLI** (`pass-cli`) plus `bash`, `curl` and `jq`.
- Healthcheck uses `curl`.

**Dashboard**
- Module filters and tidier, uniform action rows.

The full list is in [CHANGELOG.md](https://github.com/iOnic-Developer/MCP-Station/blob/alpha/2.2.0/CHANGELOG.md).

## Upgrading (or trying the alpha)

1. Change the image to `dbzocchi/mcp-station:2.2.0_alpha` (or back to `:latest`).
2. Pull and recreate the container — on Unraid, edit the container and hit *Apply*.
3. Keep the same `/data` and `/app/mcps` volumes. Settings, modules and connections carry over.

Things to know:

- **Keep `/data` persistent.** It holds the OAuth store and the encryption key; without it every
  connector dies on redeploy.
- **Don't change `SESSION_SECRET`** between versions if you set one — encrypted settings won't decrypt.
- On every start, any bundled module missing from `/app/mcps` is copied in — so new bundled modules
  appear after an upgrade. Folders already there, including your edits, are never overwritten.

## Building it yourself

```bash
git clone https://github.com/iOnic-Developer/MCP-Station.git
cd MCP-Station && git checkout alpha/2.2.0
docker build -t mcp-station:2.2.0_alpha .
```
