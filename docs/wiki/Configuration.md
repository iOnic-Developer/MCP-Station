# Configuration

**Applies to MCP Station 2.7.0.** Service credentials belong in the module/account
settings form. Station and Assistant configuration use environment variables or Station settings.

## Deployment settings

| Variable | Behavior |
| --- | --- |
| `APP_PASSWORD` | Admin and OAuth consent password. Use a strong private value. |
| `PUBLIC_URL` | Optional exact public HTTPS origin; unset disables OAuth, not bearer transport. |
| `COOKIE_SECURE` | Set `1` behind HTTPS; leave `0` for the local HTTP quick start. |
| `PORT` | Default `8788`; match the container mapping. |
| `MCP_TOKEN` | Optional station-wide bearer with access to all endpoints; prefer narrower tokens. |
| `SESSION_SECRET` | Optional fixed encryption/signing secret; otherwise generated into `/data/secret.key`. |
| `DATA_DIR` | Docker default `/data`. |
| `MCPS_DIR` | Docker default `/app/mcps`. |
| `FILES_DIR` | Files module root, default `/files`; its `root_dir` setting can override it. |

Use `${APP_PASSWORD:?set APP_PASSWORD in .env}` in Compose, not a committed password. Changing
`SESSION_SECRET` after storing settings can make them unreadable. If supplied through the environment,
it is not magically included in a filesystem backup: preserve it securely yourself.

## Public origin

The hostname must match the client URL and reach the station directly, without redirects to another
service or an upstream login wall. Update `PUBLIC_URL` and recreate the container when changing it.
The startup self-check is useful, but split-horizon DNS may require an external check too.

## Assistant

Choose `openai`, `anthropic`, or `gemini` with `ASSISTANT_PROVIDER` or Station settings.
Keys can be saved encrypted in the UI; a nonempty environment key takes precedence. The UI's
provider selection overrides the environment default.

| Variables | Purpose |
| --- | --- |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | OpenAI Responses API / compatible configured gateway. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL` | Anthropic messages API / configured gateway. |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_BASE_URL` | Gemini API / configured gateway. |
| `ASSISTANT_HEARTBEAT_MS` | Streaming keep-alive, default `15000` ms. |

Set a model your provider or gateway actually supports. The checked-in defaults are configuration
strings, not a guarantee of model availability or provider entitlement. Base URL overrides are
origins without endpoint paths. See [Assistant](Assistant) before sending private context.

## Persistent storage

| Path | Content |
| --- | --- |
| `/data` | State, OAuth store, persisted key, backups, trash; also stores bounded `usage.json`. |
| `/app/mcps` | Shared source folders and default-account encrypted configuration mirrors. |
| `/files` or configured Files root | User files; back up separately. |

New bundled folders are seeded if absent on start; existing folders are not overwritten.
Disable unwanted bundled modules rather than relying on deletion to survive a restart.
Secret-type fields are encrypted at rest; ordinary fields and source are not secret storage.
Modules still send credentials and request data to configured services. Assistant conversation,
context, source, and relevant tool output can go to the selected provider/gateway. Some privileged
service tools intentionally return secrets; protect those results too.

[Quick Start](Quick-Start) · [Backups](Backups) · [Accounts](Accounts)
