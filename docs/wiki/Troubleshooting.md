# Troubleshooting

Most connector problems are one of a handful of things. Work top-down.

## The connector won't connect

| Symptom | Cause → fix |
|---|---|
| Password page works, then "Couldn't connect" / auth failed; log ends at `token ISSUED` | **Cloudflare AI-bot blocking** eating `Claude-User` requests at the edge. See [Cloudflare](../CLOUDFLARE.md). The #1 cause behind a proxy. |
| "Authorization with the MCP server failed" immediately | Hostname in the connector URL ≠ `PUBLIC_URL`, or a stale authorize page (>5 min). Fix `PUBLIC_URL`, restart, retry fresh. |
| "Couldn't register with the sign-in service" | Hostname doesn't resolve (DNS caching after a rename), or `/register` rate-limited (20/h — restart resets it). |
| Connectors die every redeploy | `/data` isn't a persistent volume — boot log says `0 client(s)`. Mount it. |
| Tool calls error "not configured" | Module settings are blank — fill them in the UI (not env vars). |
| Connect flow 404s before the password page | Wrong module slug in the URL — the 404 body lists the hosted MCPs. |
| Module 404s with a valid token | Module is toggled off. Enable it. |

## Diagnosing from the inside

- **Logs panel** (admin UI) records every OAuth endpoint response and every MCP request with status,
  auth mode and user-agent. Whatever a client does leaves a line — including the misses.
- **Boot line** in the container log tells you if `/data` is persisting (`N client(s)` after you've
  connected) and whether `PUBLIC_URL` actually reaches the station (a redirect is flagged loudly).
- **`scripts/claude-flow-sim.mjs`** re-enacts the whole claude.ai flow against your instance — if it
  says `FLOW OK`, the server side is healthy and the problem is upstream (DNS, proxy, Cloudflare).
- **`scripts/diagnose-connector.sh`** runs external checks (CORS preflight, discovery, DCR) against a
  live URL.

## The `PUBLIC_URL` rules (cause of most silent failures)

1. Exact public HTTPS origin clients connect to — scheme + host, no path.
2. Change the hostname → change `PUBLIC_URL` and restart.
3. It must reach the station **directly** — no auth wall / redirect (no Cloudflare Access) in front.

## Still stuck?

Open an issue with the relevant **Logs panel** lines, your deployment shape (Docker / Unraid /
TrueNAS, behind Cloudflare or not), and what `claude-flow-sim.mjs` reports. Security-sensitive?
[SECURITY.md](../../SECURITY.md).
