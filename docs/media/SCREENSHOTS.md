# Product screenshots and captions

Updated: **October 16, 2026**. The six captures under `docs/assets/product/` are real
application screenshots serving **all 18 actual bundled modules**, not the old
12-integration fixture. Integrations are alphabetically ordered with their real
names, categories and icons; desktop captures use the expanded navigation rail,
light theme and viewport-only crops. The install suggestion is session-dismissed.

## Release capture

**Captured application version: 2.7.0.** Both the actual health endpoint and
visible application version were verified. All 18 bundled sources loaded.
No application version or status was falsified.

## What the sample data means

- All 18 bundled sources are copied from this checkout using an allowlist:
  `index.js`, `bundle.js`, `manifest.json`, `about.md`, `instructions.md`.
  No runtime configurations, dotfiles, sessions or credentials are copied.
- Gmail has three actual local account entries: Default account,
  Personal (example), and Work (example). Work (example) is selected in its
  workspace and Integrations account picker; selectors remain closed.
- All accounts are disabled; settings are cleared through the real local API.
  Bundled source defaults may still be shown where the application reapplies
  manifest defaults. Gmail's example account fields are blank.
- No service is tested, no AI message is sent, no clients are authorized, and
  no upstream API credentials are configured. “Not tested yet” is genuine.
- Assistant shows its real greeting and missing-API-key warning. Usage shows
  its actual empty state, not invented traffic, charts or success rates.
- The small screenshot-only caption labels sample accounts and the observed
  application version. No tracked application source or CSS is changed.

| Asset (relative to repository root) | Pixels | Caption / alt text |
| --- | --- | --- |
| `docs/assets/product/integrations.png` | 1440 × 1000 | Real 18-module Integrations list, with the visible 18-integration count, service categories and icons, and honest untested setup states. Only the first cards fit in this viewport. |
| `docs/assets/product/workspace.png` | 1440 × 1000 | Gmail settings workspace with Work (example) selected among three local accounts, blank settings, disabled account and no completed test. |
| `docs/assets/product/assistant.png` | 1440 × 1000 | Full-page Assistant with its genuine greeting and missing-API-key warning; no simulated conversation. |
| `docs/assets/product/connections.png` | 1440 × 1000 | Real Connections page with disabled, untested service accounts and no authorized clients. The remaining sources continue below the viewport. |
| `docs/assets/product/usage.png` | 1440 × 1000 | Actual empty Usage panel on Overview, scrolled into view; zero tool calls and no artificial graph. |
| `docs/assets/product/mobile.png` | 375 × 900 | Mobile Integrations viewport showing the first service cards, real integration count and bottom navigation. |

The loaded sources are Cloudflare, Docker Hub, Files, Gemini, GitHub, Gmail,
Google Drive, n8n, OpenProject, Proton Pass, Pushover, Radarr, SiYuan, Sonarr,
Station, Telegram, Todoist and Xero. They are the shipped module implementations,
not claims of verified live upstream-service or AI-client compatibility.

## Reproduce safely

Run inside `LibreChat-Workspace`, from the repository root:

```sh
node scripts/capture-release.mjs
```

The script imports an installed Playwright (including its default export), or
uses `PRODUCT_BROWSER_MODULE`, then the existing OmniForge installation as a
fallback. No new dependency is installed. It uses temporary `MCPS_DIR` and
`DATA_DIR`, an ephemeral loopback port, a dummy local `APP_PASSWORD` and an
allowlisted child-process environment, never the live station's data.

Authentication happens through the normal browser login form and API session
cookie. Browser context routing permits only the temporary app's origin;
service workers are blocked. The temporary server also rejects non-loopback
sockets/fetches and module subprocess execution. No external service call is
needed. The successful capture reported **zero external browser requests and
zero browser application errors**. All six images are staged in temporary
storage and copied to their destination only after the assertions pass.
The browser, temporary server and temporary data are cleaned up in `finally`,
including handled termination signals. Live app state is never modified.

## Original artwork

- `public/assets/brand/station-wordmark.svg`: original forest-green Ribbon S wordmark.
- `docs/site/assets/product/brand-banner.png` and `.svg`: original brand artwork, not UI captures.
- `docs/site/assets/product/social-card.png` and `.svg`: original promotional artwork, not service evidence.

Suggested social-card description: “MCP Station — turn APIs and services into MCP
tools. Self-host integrations for compatible local and cloud AI clients.” Match
added text to the artwork. Version-neutral artwork is regenerated by
`docs/site/generate-media.mjs`. No provider logo implies endorsement.

## Publication checks

- Actual version 2.7.0 was verified during capture; rerun the generator after further visible UI changes.
- Replace any remaining “12 sanitized sample integrations” copy with the actual 18-module capture description.
- Preserve sample labels and truthful untested, missing-key and empty-usage states.
- Exclude tokens, one-time secret reveals, private URLs and customer information.
- Check crops, dimensions and alt text against the delivered images.
- Source links resolve to updated captures only after the parent publishes them.
- `docs/assets/screenshots/` remains the legacy archive, not current-product evidence.
