# Navigation QA and product screenshot provenance

Scope: `redesign/public-product`, shared checkout
`/workspace/mcp-station-public-product`. All commands run inside
`LibreChat-Workspace`. No production state, backend edits, commits, pushes or
publication are part of this task.

## Canonical real-server regression

`scripts/test-workflows.mjs` starts its existing isolated loopback server with
12 dummy modules and disposable state. Playwright uses the actual served HTML,
CSS, routing, authentication, PWA controls and API handlers. API responses and
navigation geometry are not mocked. External browser requests are blocked and
counted; the run must have no external requests or uncaught browser errors.

Added coverage:

- Both 216px expanded and 72px collapsed rails across Overview, Integrations,
  Connections, Assistant, Settings, Backups and an account Settings workspace.
- On every route/state pair, the real **Not now** button is right of the rail;
  `elementFromPoint` at its center hits the button or a descendant. Real Tab
  traversal reaches it, a Playwright pointer click sets its actual `hidden`
  property, and session dismissal survives reload. Session storage is cleared
  between cases; the real PWA module is remounted by a full reload.
- The toggle has its accessible name, `aria-controls`, `aria-expanded` and a
  minimum 44px target. Enter and Space change state. Local storage and reload
  retain the selected rail width.
- Collapsed navigation shows a keyboard-focus tooltip outside the scrollable
  rail, with successful center hit-testing. Escape dismisses it without changing
  collapse state; renewed keyboard focus restores it.
- At 375px and 720px, a saved desktop collapse preference reserves no workspace
  rail margin. All tested routes avoid horizontal document overflow. The full
  mobile drawer exposes all six accessible route names and each link navigates
  and closes the drawer.
- Source category, source-ID-derived tone and monogram remain unchanged after
  account selection, enablement, a real fixture connection test and theme changes.
  Known workflow and unknown/custom categories are asserted. All 12 cards retain
  equal heights at 375/768/1440px in light and dark themes.
- Logout from the collapsed Assistant removes authenticated/collapsed/Assistant
  layout classes and restores the login PWA gutter to 16px; login restores the
  saved desktop preference.
- Four additional serious/critical axe audits cover both mobile widths and
  collapsed light/dark layouts. Existing audits and workflow checks remain.

## Run

```sh
export PLAYWRIGHT_MODULE=/workspace/scratch/station-ci-browser/node_modules/playwright/index.js
export AXE_MODULE=/workspace/scratch/station-ci-browser/node_modules/@axe-core/playwright/dist/index.js
export QA_BROWSER_EXECUTABLE="$(node -e "console.log(require('/workspace/omniforge/node_modules/playwright').chromium.executablePath())")"
export QA_SCREENSHOT_DIR=/workspace/scratch/station-navigation-qa
npm run test:workflows
```

Normal run: **102/102 checks, 27 axe audits**. With optional product capture:
**103/103 checks, 27 axe audits**. Original baseline: 81 checks, 23 audits.
The sanitized report is `$QA_SCREENSHOT_DIR/report.json`; browser, isolated
server and temporary module/state directories are cleaned in `finally`.
Axe acceptance means zero serious/critical violations, not a claim of complete
accessibility conformance. This checks Chromium, not every browser or device.

## Explicit, opt-in product screenshots

```sh
PRODUCT_SCREENSHOT_DIR=/workspace/mcp-station-public-product/docs/assets/product npm run test:workflows
```

Supply the same browser environment as above. Product capture runs only after
all main assertions pass, so existing QA-name/search expectations are unchanged.
Without `PRODUCT_SCREENSHOT_DIR`, no product PNG is written or overwritten.
Regular QA evidence still goes to `QA_SCREENSHOT_DIR`.

The capture phase changes only `name` and `description` in each disposable
fixture manifest through the existing authenticated file API, then reloads
modules. IDs, slugs, code, settings schema and account/source relationships stay
unchanged. It does not edit production manifests or repository modules.

Sample display names: Files, Gemini, Telegram, SiYuan, n8n, Radarr, Sonarr,
OpenProject, Xero, Station, Weather and Calendar. **All twelve are illustrative
custom fixtures in these captures**, not proof of bundled availability or live
connections to those services. Categories/tone follow the unchanged QA source
IDs, not the sample display names. The local fixture has one echo tool, not the
named providers' real tools.

Every PNG visibly says **Illustrative workspace · sample integrations**.
This small provenance annotation is the only injected display element; app
screens, controls and data are rendered by the real served app. No fabricated
chat, authentication status, service health, usage counters or charts are added.
Any visible configuration/test state comes from the actual isolated workflow
calls. Existing usage evidence comes from three real local tool calls (two
successes, one error), not activity at the named third-party services. The
Assistant is intentionally unconfigured: no provider key or invented reply.

Captures reject any revealed one-time token control, visible password field,
or visible fixture password, fixture secret or private token. No production
credentials are loaded. Endpoint URLs use the disposable loopback origin.

| File | Viewport | Suggested alt text |
| --- | --- | --- |
| `docs/assets/product/integrations.png` | 1440 × 1000 | MCP Station integration library with sample services, account selectors and upfront connection actions; illustrative workspace. |
| `docs/assets/product/assistant.png` | 1440 × 1000 | MCP Station Assistant before provider configuration, with its greeting, message composer and settings warning; illustrative workspace. |
| `docs/assets/product/workspace.png` | 1440 × 1000 | Sample integration account workspace on the Connections tab, with account selection and connection controls; illustrative workspace. |
| `docs/assets/product/mobile.png` | 390 × 844 | MCP Station sample integration library reflowed for mobile with labelled bottom navigation; illustrative workspace. |

These are real browser viewport captures, not mockups or stitched screenshots.
The library images show the visible portion of the 12-card library. Publication,
README/website caption placement and deployment remain the parent agent's work.

## Verification recorded on 16 October 2026

- `node --check scripts/test-workflows.mjs`: exit 0.
- `npm run test:ui`: 21 frontend modules, exit 0.
- `npm run test:pwa`: 16/16 tests, exit 0.
- Canonical workflow run without product output: 102/102 checks, 27 axe audits,
  exit 0. Report: `/workspace/scratch/station-navigation-ci-qa/report.json`.
- Explicit product-capture run: 103/103 checks, 27 axe audits, exit 0.
  Report: `/workspace/scratch/station-navigation-qa/report.json`.
- SHA-256 before/after another normal run confirms all four product PNGs are
  unchanged when `PRODUCT_SCREENSHOT_DIR` is unset.
- Both reports confirm browser/server cleanup, temporary-state removal, zero
  blocked external requests and zero uncaught browser errors.

No GitHub CI was triggered and no commit or PR was created. Website QA and
publication are intentionally left to the parent agent. No claim is made that
these fixtures validate real third-party authentication or provider behavior.
