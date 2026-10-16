# Bundled Modules

**Upcoming source bundle: 18 service modules plus `_template`.** Ten original modules are
retained and eight general-purpose modules add **185 tools**. This expansion is not in the
published `2.7.0_beta` image at `7945275`. Installed capabilities depend on image, persisted source,
credentials, upstream API version, and plan. These are project-maintained integrations.

| Module | Slug | Intended use |
| --- | --- | --- |
| Files | `files` | Read/write/move/delete within a configured root, image/file saving, public share links. |
| Gemini | `gemini_mcp` | Text, chat, embeddings, model listing, and image tools. |
| MCP Station | `station` | Privileged module inspection, creation, editing, configuration, and reload. |
| n8n | `n8n_mcp` | Workflow, execution, credential, and instance API operations; some require licensing or elevated roles. |
| OpenProject | `openproject_mcp` | Work packages, projects, and users. |
| Radarr | `radarr_mcp` | Movie lookup/library, queue, profiles, and commands. |
| SiYuan | `siyuan` | Knowledge-base search, reading, writing, and organization. |
| Sonarr | `sonarr_mcp` | TV library, episodes, queue, profiles, and commands. |
| Telegram | `telegram_mcp` | Bot messages, photos, and chat lookup. |
| Xero | `xero_mcp` | Accounting/payroll APIs using a Xero Custom Connection; entitlement and region apply. |
| Todoist | `todoist_mcp` | Tasks and projects; API key required. |
| GitHub | `github_mcp` | Repository/API operations; scoped PAT; no clone/pull filesystem tools. |
| Docker Hub | `dockerhub_mcp` | Images, tags, and repository administration; username/PAT; token management may need stronger auth. |
| Pushover | `pushover_mcp` | Real notifications and glance updates; app token and user/group key. |
| Proton Pass | `protonpass_mcp` | Vaults, credentials, TOTP, and keys; explicit PAT and supported `pass-cli`. |
| Gmail | `gmail_mcp` | Mail, threads, drafts, labels; access token or complete OAuth refresh setup. |
| Google Drive | `gdrive_mcp` | Files and sharing across configured account slots; access token or client credentials plus enabled account refresh token. |
| Cloudflare | `cloudflare_mcp` | Zero Trust and tunnels; scoped API token and account ID; zone where needed. |

`_template` is a scaffold, not another integration. Inspect the running Tools view for actual
capabilities. The [bundle audit](https://github.com/iOnic-Developer/MCP-Station/blob/redesign/public-product/docs/MODULE_BUNDLE_AUDIT.md)
records **274 offline checks passed**, including blank-configuration errors, SDK discovery/calls,
mocked account isolation, and scoped transport checks. It does not certify live upstream services.

## Blank by default, ready to configure

New modules contain no account credentials or personal defaults. Callbacks reject incomplete
configuration with actionable guidance before service I/O. The existing loader can enable imports
for discovery on a fresh install: discovered does not mean authenticated. Additional beta accounts
start blank, disabled, and untested, separately from fresh-install default-module discovery.

Gmail and Drive accept alternative auth setups, which the host's simple required-field badge may
not represent correctly. Use Test and a real read-only call, not that badge alone. Gmail's cache is
keyed by its complete OAuth credential tuple; Drive uses bounded, credential-hashed cache keys.
The offline audit checks distinct credential tuples cannot reuse another account's cached token;
this is not a claim of process isolation or a live Google auth test.

## Most NAS service modules, not NAS host administration

The bundle covers **18 of 30 service modules** in the supplied NAS snapshot. Twelve remain deferred:
private/business adapters (`booker`, `lottery`, `payroll`, `planday`, `pos_companion`, `stockmanager`),
Unraid REST/SSH/USB modules (`unraid`, `unraid2`, `unraid_ssh`, `unraid_usb`), and unreviewed agent
packages (`code_review_mcp`, `design_mcp`). Deployment-specific APIs, missing dependencies, broad host
powers, and provenance review need explicit decisions—not silent default installation.

## Enable only what you need

Bundled folders missing from `/app/mcps` are seeded on startup. Existing folders are not overwritten,
so image updates do not automatically replace your edited modules. Disable unwanted modules;
deleting a bundled folder alone does not stop it being seeded again on restart.

Configure required settings, inspect the available operations, run the source's real connection test
if it has one, and enable deliberately. Beta additional accounts reuse one source but require their
own settings, tests, endpoint access, and explicit enablement.

## Permission-sensitive operations

- Files share URLs are public to anyone holding the link; the Files root is an application boundary,
  not a sandbox for other trusted module code.
- Proton Pass can return passwords, TOTP, and private keys. GitHub/Drive/Gmail/Cloudflare and other
  write tools can change real account state. Scope credentials and confirm destructive actions.
- Station management can modify other source/settings; grant it only to trusted clients.
- Xero and other write-capable tools can affect business records. Review actual tool behavior,
  service permissions, and confirmations before use.
- n8n executes and schedules work in **n8n**, not a built-in Station job scheduler.

[Accounts](Accounts) · [Building a Module](Building-a-Module) · [Backups](Backups)
