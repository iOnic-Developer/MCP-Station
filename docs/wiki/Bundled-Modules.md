# Bundled Modules

These ship in the image and are copied into `/app/mcps` on start whenever they're missing; a folder
that's already there is never overwritten, so your edits are safe. They're ordinary folders: edit
what you need, switch off what you don't (a deleted bundled module is copied back on the next
restart, so toggle it off instead), and build what's missing. Each one is served at `/<slug>/mcp` once it's
configured and switched on.

| Module | Slug | Tools | What it does |
|---|---|---|---|
| 📁 Files | `files` | 10 | Jailed file storage — read, write, move and delete inside one folder, save images from base64, mint public share links |
| ✨ Gemini | `gemini_mcp` | 6 | Google Gemini — text, chat, embeddings, native image generation |
| ⛽ MCP Station | `station` | 12 | The station managing itself — list, inspect, create, write, configure, enable and reload modules over MCP |
| 🔀 n8n | `n8n_mcp` | 66 | The whole n8n Public API — workflows, executions, credentials, tags, variables, users, projects, folders, data tables |
| ⚙️ OpenProject | `openproject_mcp` | 14 | Work packages (incl. parent nesting), projects & sub-projects, users, statuses, types |
| 🎬 Radarr | `radarr_mcp` | 9 | Movie library — search & add, queue with warnings, disk space, command triggers |
| 📓 SiYuan | `siyuan` | 19 | SiYuan knowledge base — read, search, create, edit, move and audit docs |
| 📺 Sonarr | `sonarr_mcp` | 9 | TV library — search & add shows, episodes, queue with warnings, disk space, command triggers |
| ✈️ Telegram | `telegram_mcp` | 5 | Send and read Telegram messages through a bot |
| 🧾 Xero | `xero_mcp` | 31 | Accounting + payroll — invoices, quotes, payments, credit notes, bank transactions, reports, employees, leave, timesheets, pay runs |

`_template` is the scaffold that ➕ Add MCP copies; it isn't served.

## Setting one up

1. ⚙ **Settings** on the module row — fill in its URL / API key. Secrets are encrypted and masked.
2. ▶ **Test** — checks it can reach the real service. The button turns green on success.
3. Toggle it on.
4. Add `https://<your-host>/<slug>/mcp` to claude.ai as a custom connector
   (see [Connecting Claude](Connecting-Claude)).
5. Optional: 📄 **Skill** downloads a Claude skill for the module — upload it to claude.ai and edit it
   to add your own rules.

## Notes on specific modules

- **MCP Station** won't modify, disable or delete itself, so you can't lock yourself out through it.
  Deleting another module needs `confirm: true`, and the folder goes to `DATA_DIR/trash`.
- **Xero** drafts invoices, payments and the like by default and never authorises on its own. It
  needs a Xero Custom Connection; payroll tools need a UK/NZ payroll subscription.
- **n8n** supports Cloudflare Access service-token headers if your instance sits behind Access.
  License-gated areas (variables, projects, folders…) return a readable error on unlicensed instances.
- **Files** is jailed to `FILES_DIR` (default `/files`) unless the module's `root_dir` setting
  overrides it. Share links are public — anyone with the URL can fetch the file.

## Sharing modules

📦 **Export** on any module row downloads a `.zip` of its folder without the encrypted settings or chat
history. Unzip it into another station's `mcps/`, hit ⟳ Reload, and add your own keys. More in
[Building a Module](Building-a-Module).
