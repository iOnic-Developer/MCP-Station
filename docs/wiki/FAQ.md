# FAQ

**What is MCP Station, in one line?**
A self-hosted container that turns folders in `mcps/` into remote MCP servers claude.ai can connect
to by URL, with OAuth 2.1 built in.

**Do I need to know how to code to add an MCP?**
No. Open ➕ Add MCP, describe what you want or paste an API's docs, and the built-in ✦ assistant
writes the module. You can also copy `_template` and edit two files.

**How does claude.ai connect — do I need a public URL?**
Yes, an HTTPS one (that's what OAuth needs). A [Cloudflare Tunnel](https://github.com/iOnic-Developer/MCP-Station/blob/main/docs/CLOUDFLARE.md) is the easiest
way to expose a home box without port-forwarding. Set `PUBLIC_URL` to exactly that hostname.

**Is it safe to expose to the internet?**
The admin UI and OAuth consent are gated by `APP_PASSWORD` (use a strong one, serve over HTTPS). MCP
endpoints require a bearer token or a scoped OAuth token. Secrets are AES-256-GCM encrypted at rest.
See [SECURITY.md](https://github.com/iOnic-Developer/MCP-Station/blob/main/SECURITY.md).

**Where do API keys / module settings live?**
In the station UI, per module — **not** in env vars. They're encrypted in `/data` and mirrored
(still encrypted) into the module folder. Keep `/data` on a persistent volume.

**Can I use it with Claude Code / other MCP clients, not just claude.ai?**
Yes. Add the same `/<slug>/mcp` URL with an `Authorization: Bearer <token>` header (the station-wide
`MCP_TOKEN` or a per-module token). Anything that speaks MCP streamable HTTP works.

**My connector reaches the password page, then fails. Why?**
Almost always Cloudflare's AI-bot blocking eating `Claude-User` requests at the edge. Full fix in
[docs/CLOUDFLARE.md](https://github.com/iOnic-Developer/MCP-Station/blob/main/docs/CLOUDFLARE.md).

**Why did my connectors keep expiring, and how do I stop it?**
Before 2.2.0 the access token lasted an hour and the connection depended on claude.ai refreshing it
on time. On 2.2.0+ the consent page asks how long to stay signed in, with **Unlimited** as the
default — pick that and the connection lasts until you revoke it. See
[Connecting Claude](Connecting-Claude).

**Which Docker tag should I run?**
`latest` for the stable release, `2.2.0_alpha` for the newest features. Both use the same volumes, so
you can switch back and forth. See [Versions & Images](Versions-and-Images).

**Which AI powers the ✦ assistant?**
Your choice: OpenAI (the 2.x default), Claude or Gemini — set a key in ⚙ Station or via env vars. See
[Configuration](Configuration).

**Can I share a module I built?**
Yes — 📦 **Export** on the module card gives you a `.zip` (secrets stripped). The recipient unzips it
into their `mcps/`, hits Reload, and adds their own keys.

**Does it run on Unraid / TrueNAS / plain Docker?**
All three — see the README. It's one container plus two volumes (`/data`, `/app/mcps`), and a third
(`/files`) if you use the 📁 Files module. Images are multi-arch (amd64 + arm64).

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
