# MCP Station — roadmap & feature ideas

A living list of what MCP Station could grow into, grouped by value and risk. Nothing here is a
promise; it's the backlog of good ideas, so contributors and future-you have a map. Ordered roughly
by "how much value per unit of work."

## ✅ Shipped in v1.5.0

- **Module sharing** — export any module as a `.zip` (code + docs, secrets/chat stripped) and drop it
  into another station.
- **Deny on the consent page** — refusing a connector bounces back with `access_denied` + state
  instead of hanging the popup.
- **RFC-correct OAuth error surfaces** — typed `OAuthError`s so bad codes/tokens return 400/401, not
  500 (regression from MCP SDK 1.29's error handling).
- **Global JSON error handler** — no more HTML stack traces leaking on malformed requests.

## 🎯 Near-term — high value, low risk

- **Import a module from `.zip` in the UI** — the natural counterpart to 📦 Export. Today you unzip
  into `mcps/` by hand; a drag-and-drop importer (with a diff/preview and a "this module wants these
  settings" summary) closes the loop and makes sharing one click on both ends.
- **Import-by-URL** — paste a link to a module `.zip` (or a raw GitHub folder) and pull it in. The
  seed of a community module ecosystem.
- **OpenAPI / Swagger import** — point the ✦ assistant at an OpenAPI spec URL and auto-scaffold typed
  tools for each operation, instead of describing them in prose. Turns "any documented API" into a
  first-class one-click flow.
- **Lint-before-save in the editor** — right now only `manifest.json` is validated (zod). Run a JS
  parse/`node --check`-style pass on `index.js` before save and surface errors inline, so a typo
  can't take a module offline until the next reload.
- **Token-authed backup endpoint + scheduled backups** — a bearer-gated `POST /api/backup` so n8n /
  cron can snapshot state on a schedule (today backup is a manual UI button / session-only endpoint).
- **Per-module health card** — last test result, last error, last-used timestamp, request count, all
  on the module card, so a broken upstream is visible at a glance without opening logs.

## 🔧 Medium-term

- **Module versioning + update nudges** — record a module's version on export/import and flag when a
  shared module has a newer upstream. Pairs with import-by-URL.
- **Metrics / observability** — a `/metrics` (Prometheus) endpoint: requests per module and per tool,
  OAuth issue/refresh counts, error rates. Feeds a Grafana panel or an n8n alert.
- **Multi-user / roles** — the station is single-password today. Named users, per-user tokens, and an
  audit trail of who connected which client would make it team-safe.
- **External secret backends** — optionally store module secrets in HashiCorp Vault / Infisical /
  Doppler instead of (or alongside) the local AES key, for shops that centralise secrets.
- **First-class MCP resources** — prompts are already supported; add resources (read-only data a
  client can list/fetch) to the module contract and the capabilities inspector.
- **Per-module egress allowlist** — declare in the manifest which hosts a module's `fetchJson` may
  reach, and enforce it. A shared module then can't quietly call somewhere it shouldn't.

## 🌱 Community / polish

- **Module template gallery** — ready-to-fill scaffolds (weather, RSS, Home Assistant, a generic REST
  wrapper, a Postgres reader) beyond the single `_template`.
- **A public module directory** — a browsable index of community `.zip` modules with screenshots and
  tool lists (the export feature is the foundation; this is the storefront).
- **Light theme + theme toggle**, and small a11y passes on the admin SPA.
- **i18n** for the admin UI and consent page.

## 🔒 Security backlog

- **TOTP / 2FA on the admin login** (and optionally on the OAuth consent step).
- **Signed module packages** — sign an exported `.zip` so an importer can verify author + integrity
  before running someone else's `index.js`.
- **Audit-log export** — the Logs panel is in-memory; add durable, exportable audit records for
  OAuth grants, revokes, and settings changes.
- **Session hardening** — optional IP-binding on admin sessions; configurable session TTL.

## 🚫 Deliberately out of scope (for now)

- **Arbitrary npm dependencies inside modules.** The two-file, dependency-free contract (modules get
  `fetchJson` injected) is what keeps the security and hot-reload story simple. Kept on purpose.
- **Becoming a general reverse proxy / ingress.** MCP Station hosts MCP modules; it isn't trying to
  be Traefik.
- **A build step / TypeScript.** Plain ESM, three runtime deps, no toolchain — intentionally.

---

Have an idea or want to pick one up? Open an issue or a PR — see
[CONTRIBUTING.md](../CONTRIBUTING.md).
