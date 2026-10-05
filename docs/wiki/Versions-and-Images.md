# Versions & Images

MCP Station ships as one multi-arch image (`linux/amd64`, `linux/arm64`) on Docker Hub:
**[`dbzocchi/mcp-station`](https://hub.docker.com/r/dbzocchi/mcp-station)**.

## Which tag?

| Tag | What it is | Built from |
|---|---|---|
| `latest` | Newest stable release (currently **v2.4.0**) | `main` |
| `2.4.0` | v2.4.0, fixed — pin it if you don't want `latest` to move | `main` at v2.4.0 |
| `<sha>` | The build of one specific commit on `main` | `main` |
| `1.x.y`, `2.0.0`, `2.1.0_alpha`, `2.2.0_alpha` | Earlier releases and alphas, kept for rollback | — |

## What's new in 2.4.0

Compared with v1.8.0:

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

**Fixed**
- `2.2.0_alpha` builds told clients a token lasted 10 years; some clients then refreshed in a loop and
  drained the station-wide `/token` limit ("You have exceeded the rate limit for token requests").
  2.4.0 advertises at most 7 days (the token itself still lasts the whole sign-in) and raises the
  limits.

The full list is in [CHANGELOG.md](https://github.com/iOnic-Developer/MCP-Station/blob/main/CHANGELOG.md).

## Upgrading

1. Change the image to `dbzocchi/mcp-station:latest` or `:2.4.0` (or an older tag to roll back).
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
cd MCP-Station && git checkout main
docker build -t mcp-station:2.4.0 .
```
