# MCP Station

**Turn your APIs and services into MCP tools.**

**One integration. Multiple accounts. Your local and cloud AI clients.**

Self-host your integrations and connect them to ChatGPT, Claude, Claude Code, and LibreChat through
compatible MCP features. Use local or cloud models through an MCP client such as LibreChat.
Build from API documentation with the optional Assistant, reuse a module across service accounts,
and manage tools, endpoints, and access in one workspace. Client availability depends on supported
features, plans, and admin policy; these are compatibility targets, not certified integrations.
Websites without usable APIs require an authorized adapter, not a promise of universal browsing.

[GitHub](https://github.com/iOnic-Developer/MCP-Station) ·
[Review branch](https://github.com/iOnic-Developer/MCP-Station/tree/redesign/public-product) ·
[Documentation source](https://github.com/iOnic-Developer/MCP-Station/tree/redesign/public-product/docs/wiki) ·
[Product page](https://ionic-developer.github.io/MCP-Station/site/)

> **Image channels:** stable **2.4.0** (`latest` / `main`). Published **`2.7.0_beta`**
> comes from **`7945275`** and reports **`2.6.0-beta`** internally. The upcoming source adds the
> 18-module bundle, newer workspace and product site; **that beta image does not contain them**.
> Screenshots below show the source preview with sample data. An image tag is not a GitHub release.

## Choose your channel

| Image | Use |
| --- | --- |
| `dbzocchi/mcp-station:2.4.0` | Explicit stable version selection. |
| `dbzocchi/mcp-station:latest` | Moving stable tag, currently 2.4.0. |
| `dbzocchi/mcp-station:2.7.0_beta` | Published beta built from `7945275`; evaluate on separate volumes. |

For exact reproducibility, record a verified image digest. A version-looking tag can be republished.
The `redesign/public-product` source is the upcoming product preview; use the published source
commit when building your own image. Do not assume beta state can be used
by an older image without restoring a matching validated backup.

## The review workspace

The following is branch-preview imagery—not stable 2.4 and not a guarantee that the published beta
image contains the latest layout. Review screenshots use demonstration configuration, not customer data.

![Branch-preview Integrations workspace with service account selection and endpoint actions](https://raw.githubusercontent.com/iOnic-Developer/MCP-Station/refs/heads/redesign/public-product/docs/assets/product/integrations.png)

New beta capabilities include separately configured service accounts sharing one source module,
account-aware Connections, measured tool-usage metadata, a full-page Assistant, and PWA installation
where browser/device/HTTPS support it. Private dashboard content is not available offline.
The latest visual refinements are branch-only until another image is built and verified.

## Run stable locally first

Create a private `.env` with a strong `APP_PASSWORD`, keep it out of Git, and restrict its file
permissions. Save this as `compose.yaml`:

```yaml
services:
  mcp-station:
    image: dbzocchi/mcp-station:2.4.0
    restart: unless-stopped
    ports:
      - "127.0.0.1:8788:8788"
    environment:
      APP_PASSWORD: ${APP_PASSWORD:?set APP_PASSWORD in .env}
      PUBLIC_URL: ${PUBLIC_URL:-}
      COOKIE_SECURE: ${COOKIE_SECURE:-0}
      MCP_TOKEN: ${MCP_TOKEN:-}
    volumes:
      - ./data:/data
      - ./mcps:/app/mcps
      - ./files:/files
```

```sh
docker compose up -d
curl --fail http://127.0.0.1:8788/healthz
```

Sign in at `http://127.0.0.1:8788`. Configure required module settings, inspect its tools, run its
connection test, and enable deliberately. If a source has no real `test()` function, Test may only
confirm that it loads; a copied endpoint or green test is not proof of a working client connection.

### Remote HTTPS and OAuth

For remote connectors, configure your reverse proxy/tunnel, set `PUBLIC_URL` to the exact public
HTTPS origin without a path, and use `COOKIE_SECURE=1`. The public origin must reach the station
without an intervening login wall. The local loopback port above needs deliberate networking if
your proxy is in another container or host.

Copy `https://your-station.example/<slug>/mcp` into a compatible custom connector and approve its
OAuth consent. Bearer clients use that URL with `Authorization: Bearer <token>`; prefer a scoped
module/account token. The optional master `MCP_TOKEN` reaches all endpoints. Client support and
product/plan availability vary.

### Persistent state is required

Persist `/data` and `/app/mcps`. Leave `SESSION_SECRET` unset to use `/data/secret.key`, or choose a
strong fixed value before storing settings and preserve it separately. Changing it later can make
encrypted settings unreadable. Back up external Files storage separately.

[Setup and configuration](https://github.com/iOnic-Developer/MCP-Station/tree/redesign/public-product/docs/wiki) ·
[Historical 2.4 technical archive](https://github.com/iOnic-Developer/MCP-Station/blob/redesign/public-product/docs/REFERENCE_2_4.md)

## Bundled source modules

**Upcoming source: 18 service modules plus a template.**

GitHub · Docker Hub · Cloudflare · n8n · Gmail · Google Drive · Files · SiYuan · Todoist · Telegram ·
Pushover · Radarr · Sonarr · Gemini · OpenProject · Xero · Proton Pass · MCP Station.

The eight additions contribute **185 tools**, with **274 offline checks recorded in the bundle
audit**, not live-service certification. They ship with empty credentials and actionable preflight
errors. Fresh installs may discover modules before they are authenticated; disable what you do not
need. Gmail/Drive accept access-token or refresh-token setups; run Test rather than relying on the
optional-field configuration badge. Existing source folders are not overwritten on startup.

The expanded bundle covers 18 of 30 supplied NAS service modules. Private business adapters,
Unraid host-control/execution modules, and unreviewed agent packages remain deferred. `_template`
is a scaffold. Upstream permissions/plans apply; these are project-maintained integrations.
[Bundle audit](https://github.com/iOnic-Developer/MCP-Station/blob/redesign/public-product/docs/MODULE_BUNDLE_AUDIT.md) ·
[AI-client setup](https://github.com/iOnic-Developer/MCP-Station/blob/redesign/public-product/docs/wiki/Connecting-AI-Clients.md)

## Account boundaries and data flow

- **Beta service accounts are not human-user accounts.** One administrator controls all of them.
- Additional accounts start blank, disabled, and untested; each has its own endpoint, settings,
  tokens, tests, and scoped grants. Shared source edits affect every account using it.
- Secret settings fields are AES-256-GCM encrypted at rest and masked in ordinary settings responses;
  ordinary fields and source are not encrypted secret storage.
- Modules execute as trusted in-process code, **not** a tenant sandbox. Station management and
  station-wide credentials retain broad privileges.
- Modules call configured external services. Assistant conversation, context, relevant source,
  and tool output go to the selected AI provider or gateway; provider charges/policies apply.
  Never paste real keys into chat or hard-code them in source.

## Usage and recovery

**Beta usage** retains only time, account/source IDs, registered tool name, duration, and outcome.
It does not retain tool arguments/results, bodies, credentials, or client identifiers. History is
bounded globally to **30 days / 5,000 events**, not a complete billing/audit ledger. Setup tests,
initialization, tool listing, denied requests, and aborted responses do not count as recorded calls.

Use a **full private `.tar.gz` backup** for station recovery, including beta account registry and
usage. It contains sensitive state and the persisted encryption key. Save externally supplied
`SESSION_SECRET` and Files storage separately. Portable JSON covers default-account configuration,
not additional accounts, usage, or source. Module ZIPs share source without managed settings/chat;
review them for manually embedded secrets before sharing.

## Project and support

[Source and issues](https://github.com/iOnic-Developer/MCP-Station) ·
[Security policy](https://github.com/iOnic-Developer/MCP-Station/blob/main/SECURITY.md) ·
[MIT license](https://github.com/iOnic-Developer/MCP-Station/blob/main/LICENSE)

The public main README stays stable until an approved merge. The
[GitHub Wiki](https://github.com/iOnic-Developer/MCP-Station/wiki) may still show older stable pages
until an approved sync. This copy does not announce a hosted website or stable redesign release.
Original Ribbon S artwork belongs to the project; third-party names imply no affiliation.
