# Security Policy

MCP Station sits between the public internet (claude.ai connectors) and services on your private
network, holding API keys for all of them. Security matters here. Thanks for helping keep it solid.

## Reporting a vulnerability

**Please don't open a public issue for a security problem.** Instead, use GitHub's private
**[Security Advisories](https://github.com/iOnic-Developer/MCP-Station/security/advisories/new)**
("Report a vulnerability") so it can be triaged privately.

Include: a description, the impact, reproduction steps (or a PoC), and the version/commit. You'll get
an acknowledgement as soon as possible; please allow reasonable time for a fix before any public
disclosure.

## What's in scope

- Authentication / authorization bypass (admin session, OAuth, bearer gate, per-MCP scoping).
- Secret disclosure (module settings, the encryption key, tokens) — at rest or over the wire.
- Path traversal in the module file editor, file shares, or backup/restore.
- CSRF on the admin API, or the OAuth flow being turned into an open redirector.
- Sandbox escape from a module's `index.js` affecting the host or other modules.

## What's *by design* (not a vulnerability)

- **A module's `index.js` runs with the station's privileges.** Modules are code you (or someone you
  trust) put in `mcps/`. Only import modules you trust — the same as any plugin system. Signed
  packages are on the [roadmap](docs/ROADMAP.md).
- **The station password gates everything.** A weak `APP_PASSWORD`, or exposing the admin UI to the
  public without one, is a deployment issue, not a station bug. Use a strong password.
- **Public file-share links (`/f/<token>`) are unauthenticated by design** — the 128-bit token *is*
  the credential. Only share what you mean to; revoke when done.
- **`PUBLIC_URL` behind a redirect / Cloudflare Access breaks connectors on purpose** — see the
  README and `docs/CLOUDFLARE.md`.

## Hardening checklist for operators

- Set a **strong, unique `APP_PASSWORD`**; never expose the admin UI without it.
- Serve over **HTTPS** and set `COOKIE_SECURE=1`.
- Keep `/data` on a **persistent, backed-up** volume (it holds the encryption key — losing it makes
  encrypted settings unreadable).
- Don't put Cloudflare Access (or any auth wall) in front of `PUBLIC_URL`.
- Only add modules from sources you trust; review a shared module's `index.js` before enabling it.
- Rotate `MCP_TOKEN` and per-module tokens periodically; revoke OAuth connections you no longer use
  from each module's 🔑 Access panel.

## Supported versions

This is an actively developed project; fixes land on the latest release. Run a recent
`dbzocchi/mcp-station` tag (or `:latest`) and keep `/data` persistent so upgrades are painless.
