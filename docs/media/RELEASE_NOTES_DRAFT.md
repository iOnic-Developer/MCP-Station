# Upcoming product preview — release-note draft

**Source preview, not a new image or published GitHub release.** Stable is 2.4.0 / `latest` on
main. Published `2.7.0_beta` comes from `7945275` and reports `2.6.0-beta` internally; it does not
include the new eight-module expansion, newer workspace refinements, or new product site source.

## Turn your APIs and services into MCP tools

One integration. Multiple accounts. Your local and cloud AI clients.

- Reuse one module source with independent service-account settings, endpoints, tests, scoped
  tokens, and OAuth grants. New accounts start blank, disabled, and untested.
- Manage setup in account workspaces and Connections; inspect measured tool activity and use a
  full-page Assistant to help build integrations from API documentation.
- Connect compatible MCP features in ChatGPT, Claude, Claude Code, and LibreChat. Local/cloud
  models require an MCP-capable client; plan and admin restrictions apply.
- Explore a refreshed README, wiki, Docker Hub overview, real sample-data screenshots, and a
  ready-to-host product-site source. No hosted product URL is announced.

## Expanded public bundle

18 modules plus `_template`: ten retained and eight added. New additions are Todoist, GitHub,
Docker Hub, Pushover, Proton Pass, Gmail, Google Drive, and Cloudflare, contributing **185 tools**.
The source audit records **274 offline checks passed**, including actionable blank-configuration
failures, real SDK discovery/calls against fixtures, credential-isolated Google caches, and scoped
transport tests. No live services, real credentials, Proton CLI sessions, or AI-client sessions
were tested by that audit.

All new credentials are blank. Fresh-install imports may be discoverable before authentication;
disable unwanted modules. Gmail/Drive's alternative auth requirements may outstrip the simple
configured badge: use Test and a small read-only call. GitHub clone/pull filesystem tools are not
bundled. Proton Pass requires explicit Settings PAT and the supported CLI executable.

18 of 30 supplied NAS services are included. Private business adapters, deployment-specific
Unraid REST/SSH/USB administration, and unreviewed agent packages remain deferred. See
[the bundle audit](../MODULE_BUNDLE_AUDIT.md) for exact decisions and verification boundaries.

## Operations

One administrator controls service accounts; modules remain trusted in-process code. Shared
source edits affect every account. Modules send requests to configured services; Assistant context,
source, and relevant tool output can go to the chosen provider/gateway. Secret settings encryption
is not a no-egress guarantee, and privileged service tools can intentionally return secrets.

Usage keeps bounded metadata, not arguments/results: at most 30 days or 5,000 events globally.
Full private backups preserve additional accounts and usage; portable JSON is default-account
configuration only. Preserve environment secrets and external Files storage separately.
PWA installation depends on HTTPS/browser/device support, not private offline access.

## Publication gate

Record the approved source commit, verify image tag/digest after a new build, and validate the
intended clients and restore flow before an image/release announcement. Use separate evaluation
volumes and a full backup; switching images is not a verified beta downgrade path. The parent
owns approved commit/push, page publication, wiki sync, image publishing, and release creation.
