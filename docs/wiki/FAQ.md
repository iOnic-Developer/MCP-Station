# FAQ

## What is MCP Station?

A self-hosted workspace that turns APIs and services into MCP tools. Build an integration once,
configure multiple service accounts, and connect compatible local and cloud AI clients.

## Which version should I use?

Use stable `2.7.0`; `latest` and `2.7` are moving stable tags.
See [Versions and Images](Versions-and-Images) for historical tags and safe rollback.

## Why do I not see all 18 modules after upgrading?

A fresh 2.7.0 install seeds all 18 service-module folders into `/app/mcps`. On restart, missing
bundled folders are added, but existing folders are never overwritten. Check your running image,
volume mount, startup logs and enabled filters. Preserve custom sources before deliberately updating
them; deleting a bundled folder alone makes it return at the next startup.

## Are multiple human users supported?

No. MCP Station supports independently configured service accounts controlled by one administrator.
Modules are trusted in-process code, not tenant-isolated workloads. [Accounts](Accounts).

## Do keys and data always stay on my server?

No. Secret settings fields are encrypted at rest, but modules call upstream services. Assistant
conversations/context/source and relevant tool output go to the selected provider or gateway.
Do not paste secrets into chat or source. [Assistant](Assistant).

## Can I build without writing everything by hand?

The Assistant can scaffold and edit module source from documentation. You must still review,
configure, and test it. No automatic compatibility, safety, completeness, or timing guarantee applies.

## Is Gmail bundled? What about NAS services?

Gmail and Google Drive are included in the 2.7.0 stable 18-module bundle. The bundle covers 18 of 30 supplied NAS service modules; private business and
Unraid host-control modules remain deferred. See [Bundled Modules](Bundled-Modules). There is no
app-store service or built-in scheduler; schedules can run in a separately configured n8n instance.

## Can it turn any website into tools?

A usable API can be wrapped in a module with the right authentication and permissions. A site
without an API needs an appropriate authorized adapter. Universal website access and built-in
browser automation are not promised.

## Can I use ChatGPT, Claude, Claude Code, or a local model?

Use their compatible MCP features: ChatGPT custom apps where available, Claude remote connectors,
Claude Code HTTP transport, or LibreChat with local/cloud models. Models require a tool-capable
client. Plan/admin policy and supported app features vary. [Connecting AI Clients](Connecting-AI-Clients).

## What does Usage store?

Usage stores bounded tool-call metadata, not arguments/results. Retention is at most 30 days or
5,000 events globally. This is not complete auditing or billing. [Usage](Usage).

## Is a JSON export a complete backup?

No. JSON is default-account configuration, not additional accounts, usage, or source. Full private
backups preserve station recovery state; external Files storage and environment secrets need separate
backup. [Backups](Backups).

## Can I install it on my phone?

The PWA can be installed where HTTPS, browser, and device permit. The service must
still be reachable; private dashboard content is not available offline.

## What about Unraid, TrueNAS, or ordinary Docker?

Use Docker with persistent `/data` and `/app/mcps`, plus any external file storage. See the
[Quick Start](Quick-Start). Choose the image/channel explicitly. The preserved 2.4 technical reference is historical and may
contain outdated claims; use this wiki for current setup guidance.
