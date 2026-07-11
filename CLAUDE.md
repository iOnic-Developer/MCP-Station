# CLAUDE.md — orientation for AI sessions on this repo

You are working on **MCP Station**, David's self-hosted MCP hub. Built by Claude (Cowork) on 2026-07-11. Read `docs/BUILD_JOURNAL.md` for the full design rationale before changing architecture.

## What this is

One Docker container (Node 22 + Express + `@modelcontextprotocol/sdk`, plain ESM JS, **no build step, no TypeScript, minimal deps**) that:

- hosts each folder in `mcps/` as an MCP endpoint at `PUBLIC_URL/<slug>` (stateless streamable HTTP, fresh `McpServer` per request)
- runs an OAuth 2.1 authorization server (DCR + PKCE S256, approval gated by `APP_PASSWORD`) so claude.ai connects permanently; static `MCP_TOKEN` bearer as the second lane — pattern cloned from the SiYuan Companion (see SiYuan KB → `/SiYuan Companion`)
- serves a vanilla-JS modular admin SPA (`public/`) with a ✦ Claude popup whose retained instructions live in state (`server/lib/seedInstructions.js` seeds them)
- persists everything in `/data/station.json` (atomic JSON store) — secrets AES-256-GCM encrypted (`server/lib/crypto.js`)
- import/export/backup: JSON config + tar.gz archives (system `tar`, installed in the image)

## Hard-won invariants — do not break

1. **`inputSchema` in `registerTool` is a plain object of zod fields**, never `z.object()` — the SDK wraps the raw shape.
2. Modules are **self-contained folders**, two-file contract (`manifest.json` + `index.js` exporting `register`, optional `test`). No npm deps inside modules; they get `fetchJson` injected. Changing the contract breaks the seed instructions, `docs/BUILDING_MCPS.md`, `_template`, and existing user modules — update all together or don't.
3. Reserved slugs live in `RESERVED_SLUGS` (`server/lib/mcpHost.js`) — any new top-level route must be added there.
4. MCP endpoints: bearer auth only, never cookies. Admin API: session cookie + `x-station-csrf: 1` header on mutations, never bearers.
5. Secrets: UI shows `••••••`; `'••••••'` sent back means *unchanged*; empty string means *clear*. Keep that round-trip intact.
6. Hot reload = cache-busted dynamic import (`?v=Date.now()`); `POST /api/reload` re-scans. Don't introduce anything that requires a process restart to pick up module changes.
7. `PUBLIC_URL` is the OAuth issuer — every advertised endpoint derives from it.
8. Port 8788 (Companion owns 8787 on the same box).

## Layout

```
server/index.js        all route wiring — read this first
server/lib/*.js        env, log, crypto, state, auth, oauth, mcpHost, assistant, seedInstructions, backup
mcps/{_template,telegram,gemini}/   modules (telegram ✈️ 5 tools, gemini ✨ 4 tools)
public/assets/js/      api.js, ui.js, app.js + views/{login,list,settings,editor,addNew,backup,station,assistant}.js
docs/                  BUILD_JOURNAL (design log), BUILDING_MCPS (module contract), OAUTH (flows)
```

## Working here

- **Test before claiming done**: `npm install && APP_PASSWORD=test PUBLIC_URL=http://localhost:8788 node server/index.js`, then the smoke script pattern in `scripts/smoke.sh` (login → PKCE round trip → MCP initialize/tools). No test framework — keep it curl-able.
- **Commit granularly** to `main`; David wants constant commits, branches only for risky rework.
- **Track in Todoist** (project `Claude`, ID `6h37qwfR8cChXRjh`) and log decisions in SiYuan (notebook doc `MCP Station`) — David runs on those two systems.
- Update `docs/BUILD_JOURNAL.md` work-log table when you ship something meaningful, and bump `cfg.version` (`server/lib/env.js`) + `CHANGELOG.md` on releases.
- The ✦ popup's seed instructions must stay truthful about the module contract — if you touch `mcpHost.js` context injection or the manifest schema, update `seedInstructions.js` and `docs/BUILDING_MCPS.md` in the same commit.

## Known gaps / next ideas (as of v1.0.0)

- No per-MCP OAuth scoping (any token reaches every enabled MCP) — fine single-user.
- Editor is a plain textarea; no lint-before-save beyond manifest zod validation.
- No scheduled backups (manual button only) — n8n could hit `POST /api/backup` on cron with the session… better: add a token-authed backup endpoint if David asks.
- Restore doesn't restart the process; if `SESSION_SECRET` differs from the archive's `secret.key` provenance, stored secrets won't decrypt (documented in README).
