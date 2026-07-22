# Contributing to MCP Station

Thanks for taking a look. MCP Station is a small, deliberately dependency-light project — that makes
it easy to hack on, and easy to break in subtle ways. This guide keeps both of us happy.

## Ground rules

- **No build step, no TypeScript.** Plain ESM JavaScript, three runtime deps (`express`, `zod`, the
  MCP SDK). Please don't introduce a toolchain or a transpiler.
- **Modules take no npm dependencies.** A module is `manifest.json` + `index.js` (+ optional
  `instructions.md`) and gets `fetchJson` injected. Keep the two-file, zero-dep contract.
- **Test before you claim it works.** There's no test framework on purpose — the suites are curl-able
  bash. Run them (below) and keep them green.

## Getting set up

```bash
git clone https://github.com/iOnic-Developer/MCP-Station.git
cd MCP-Station
npm install
APP_PASSWORD=test PUBLIC_URL=http://localhost:8788 node server/index.js
# open http://localhost:8788, log in with "test"
```

## Running the tests

Each suite boots its own throwaway station on its own port — no setup, no teardown, safe to run from
the repo root:

```bash
npm test                    # smoke: auth, PKCE round-trip, MCP handshake, module lifecycle, backup
npm run test:oauth          # OAuth 2.1 conformance + abuse (replay, cross-client, PKCE, revocation)
npm run test:scoping        # per-MCP token + OAuth resource scoping
npm run test:selfcontained  # delete-a-module-and-restore drill
```

And the full claude.ai-style end-to-end flow against a running instance:

```bash
node scripts/claude-flow-sim.mjs http://localhost:8788 /siyuan/mcp test
```

A PR that touches auth, OAuth, or the module host should show all suites green in the description.

## The invariants (please don't break these)

These are load-bearing. `CLAUDE.md` has the full list; the ones that bite hardest:

1. **`inputSchema` in `registerTool` is a plain object of zod fields**, never `z.object()`.
2. **MCP endpoints: bearer auth only, never cookies.** Admin API: session cookie + `x-station-csrf: 1`
   on mutations, never bearers.
3. **The OAuth provider must throw the SDK's typed `OAuthError`s** (`InvalidGrantError`,
   `InvalidTokenError`, …), never a plain `Error` — the SDK maps plain throws to `500 server_error`.
4. **Secrets round-trip:** the UI shows `••••••`; sending `'••••••'` back means *unchanged*, empty
   string means *clear*. Keep it intact.
5. **Hot reload, no restarts.** Don't add anything that needs a process restart to pick up module
   changes.
6. `PUBLIC_URL` is the OAuth issuer — every advertised endpoint derives from it.
7. Reserved slugs live in `RESERVED_SLUGS` (`server/lib/mcpHost.js`) — add any new top-level route.

## Commits & PRs

- Small, focused commits with a clear message. The history uses `feat:` / `fix:` / `docs:` prefixes.
- Update `CHANGELOG.md` and bump `cfg.version` (`server/lib/env.js`) + `package.json` on a release.
- If you touch the module contract, update it *everywhere* it's described in the same PR:
  `seedInstructions.js`, `docs/BUILDING_MCPS.md`, `mcps/_template`.
- Describe what you tested. Screenshots for UI changes are appreciated.

## Sharing a module you built

The nicest kind of contribution for other users: export your module (📦 on the card), and open a PR
adding it under `mcps/` — or just attach the `.zip` to an issue so others can drop it in. Strip any
real endpoints/keys; the export already leaves secrets out.

## Reporting bugs

Open an issue with: what you did, what you expected, what happened, the relevant lines from the
**Logs panel**, and your deployment shape (Docker / Unraid / TrueNAS, behind Cloudflare or not).
For anything security-sensitive, see [SECURITY.md](SECURITY.md) instead of a public issue.
