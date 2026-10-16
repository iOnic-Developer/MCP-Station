# MCP Station 2.7.0 — stable release notes

**Approved release preparation · publication pending verification.** The parent release process
publishes GitHub and Docker images after CI, then verifies tags, digests and public surfaces.
This draft is not evidence that publication has completed.

## Turn your APIs and services into MCP tools

**One integration. Multiple accounts. Your local and cloud AI clients.**

MCP Station 2.7.0 brings a self-hosted integration workspace and the complete **18-module bundle**
into one stable release. Configure your services, inspect their tools, and connect compatible clients.

- Independent service-account settings, endpoints, tests, scoped tokens and OAuth grants share one
  module source. Additional accounts start blank, disabled and untested—not with copied credentials.
- Account-aware Integrations and Connections put configuration and authorization in context.
- Usage shows measured calls, errors and latency, without retaining tool arguments or results.
- The full-page Assistant and source conversations help build integrations from API documentation.
- PWA installation is supported where HTTPS, browser and device allow; private content is not offline.
- Updated README, wiki, Docker Hub overview and product page use stable setup guidance and labeled
  sample screenshots. Product page: https://ionic-developer.github.io/MCP-Station/site/

## All 18 modules included

Files · Gemini · MCP Station · n8n · OpenProject · Radarr · SiYuan · Sonarr · Telegram · Xero ·
Todoist · GitHub · Docker Hub · Pushover · Proton Pass · Gmail · Google Drive · Cloudflare.

`_template` is a scaffold, not a nineteenth integration. Eight additions contribute **185 tools**.
The [bundle audit](../MODULE_BUNDLE_AUDIT.md) records **274 offline checks passed**; that is prior
fixture/SDK/transport validation, not live-service, real credential, Proton CLI-session or AI-client
certification. Credentials and upstream permissions/plans are required. GitHub filesystem clone/pull
helpers are not bundled. Proton Pass requires explicit PAT configuration and the supported CLI.
Private business adapters, Unraid host-control modules and unreviewed agent packages remain deferred.

## Install and upgrade

Pin `dbzocchi/mcp-station:2.7.0`; moving `:2.7` and `:latest` track stable updates.
See [Quick Start](../wiki/Quick-Start.md).

A fresh install seeds all 18 service-module folders. Startup adds missing bundled folders to
`/app/mcps` but **never overwrites existing folders**, preserving edited sources. Updating the image
alone does not update existing module code. Back up and review source updates deliberately; disable
unwanted modules instead of deleting bundled folders, which are reseeded on restart.

Persist `/data` and `/app/mcps`; preserve Files storage and any environment-supplied `SESSION_SECRET`
separately. Validate full restore in an isolated deployment before upgrading production. Older stable
and beta tags remain historical rollback options, not the current install path. Older images require
matching validated state backups; switching images alone is not a verified downgrade.

## Compatibility and trust boundaries

ChatGPT, Claude, Claude Code and LibreChat are compatible MCP connection paths subject to transport,
authentication, product features, plan and admin policy—not endorsements or new live-client test
claims. Local/cloud models need an MCP-capable client. A successful setup Test or tool listing is
not proof of a successful client tool call. Websites need usable APIs or authorized adapters;
universal browsing is not promised.

One administrator controls service accounts: multi-account is **not multi-user hosting**. Modules
run as trusted code in the station process; source changes affect every account. Modules contact
configured services, and Assistant conversations/context/source/tool output can go to the selected
provider or gateway. Keep secrets in settings, not chat or source. Privileged tools may return secrets.

Usage retains bounded metadata for at most 30 days or 5,000 events globally, not full auditing or
billing. Full private backups preserve accounts and usage; portable JSON is default-account
configuration only, while ZIP exports share source. No built-in background scheduler is promised.

## Publication handoff

After CI, the parent must record the final approved commit, verify the GitHub release and Docker
`2.7.0`, `2.7`, `latest` tags/digests, sync wiki/overview/site, and confirm public links before
announcing completion. No commit, push or publication is performed by this documentation task.
