# FAQ

**What is MCP Station, in one line?**
A self-hosted container that turns folders in `mcps/` into remote MCP servers claude.ai can connect
to by URL, with OAuth 2.1 built in.

**Do I need to know how to code to add an MCP?**
No. Open ➕ Add MCP, describe what you want or paste an API's docs, and the built-in ✦ assistant
writes the module. You can also copy `_template` and edit two files.

**How does claude.ai connect — do I need a public URL?**
Yes, an HTTPS one (that's what OAuth needs). A [Cloudflare Tunnel](../CLOUDFLARE.md) is the easiest
way to expose a home box without port-forwarding. Set `PUBLIC_URL` to exactly that hostname.

**Is it safe to expose to the internet?**
The admin UI and OAuth consent are gated by `APP_PASSWORD` (use a strong one, serve over HTTPS). MCP
endpoints require a bearer token or a scoped OAuth token. Secrets are AES-256-GCM encrypted at rest.
See [SECURITY.md](../../SECURITY.md).

**Where do API keys / module settings live?**
In the station UI, per module — **not** in env vars. They're encrypted in `/data` and mirrored
(still encrypted) into the module folder. Keep `/data` on a persistent volume.

**Can I use it with Claude Code / other MCP clients, not just claude.ai?**
Yes. Add the same `/<slug>/mcp` URL with an `Authorization: Bearer <token>` header (the station-wide
`MCP_TOKEN` or a per-module token). Anything that speaks MCP streamable HTTP works.

**My connector reaches the password page, then fails. Why?**
Almost always Cloudflare's AI-bot blocking eating `Claude-User` requests at the edge. Full fix in
[docs/CLOUDFLARE.md](../CLOUDFLARE.md).

**Can I share a module I built?**
Yes — 📦 **Export** on the module card gives you a `.zip` (secrets stripped). The recipient unzips it
into their `mcps/`, hits Reload, and adds their own keys.

**Does it run on Unraid / TrueNAS / plain Docker?**
All three — see the README. It's one container plus two volumes (`/data`, `/app/mcps`).

**What are the requirements?**
Docker (or Node ≥ 20). Three runtime deps, no build step, no database — state is a JSON file in
`/data`.

**Can Claude break something with a module?**
A module does exactly what its `index.js` does. Money-touching or destructive modules should build in
confirmations (the bundled Xero module drafts, never auto-authorises, for example). Only enable
modules you trust.

**How do I back up?**
The UI's Backup button (or `POST /api/backup`) tars `/data` + `/app/mcps`. Restore re-imports it.
Keep `SESSION_SECRET`/`secret.key` stable or encrypted settings won't decrypt after a restore.
