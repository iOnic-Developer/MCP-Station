# Workflow regression QA

## Result — 2026-10-16

**68 / 68 named browser checks passed; zero failures.**
The final run exits **0** after fixing the one-time token route guard found in the first pass.

- `node --check scripts/test-workflows.mjs`: exit 0.
- `npm run test:workflows` with the dependency overrides below: exit 0.
- 19 axe audits completed: zero serious or critical WCAG 2 A/AA or 2.1 AA violations after entrance animations settled.
- `node scripts/test-instances.mjs`: exit 0.
- `node scripts/test-usage.mjs`: exit 0 (HTTP/persistence and retention/projection checks).
- No uncaught browser errors or third-party browser requests observed.
- Browser closed, isolated server exited, and temporary module/state directory removed.

Counts are named checks, not individual assertions. Several checks contain multiple assertions.
The final JSON report lists every check and its result. No expected failures were suppressed.

## Run

From `/workspace/mcp-station-public-product`, inside `LibreChat-Workspace`:

```sh
PLAYWRIGHT_MODULE=/workspace/omniforge/node_modules/playwright/index.mjs \
AXE_MODULE=/workspace/omniforge/node_modules/@axe-core/playwright/dist/index.js \
QA_SCREENSHOT_DIR=/workspace/scratch/station-workflow-qa \
node scripts/test-workflows.mjs
```

Both imports also support normal local package resolution when overrides are absent.
Axe is required; a missing installation cannot silently turn audits into passes.
Chromium is headless and uses Playwright's standard installed executable. An optional
`QA_BROWSER_EXECUTABLE` override is supported. No dependency installation is needed in
this workspace and no package or lockfile was modified.

Backend verification used a cleared environment, preserving only PATH, HOME and LANG:

```sh
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 node scripts/test-instances.mjs
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 node scripts/test-usage.mjs
```

## Isolation and evidence

The new script starts the real `server/index.js` subprocess on an ephemeral local port.
It generates 12 synthetic integrations under a temporary directory, not copies of installed
production integrations. The fixture tools only echo local values; setup tests make no
external requests. The application password and settings are public synthetic fixture values.
Server environment uses an explicit allowlist, separate DATA_DIR/MCPS_DIR, and a loopback
PUBLIC_URL. Inherited provider keys, MCP_TOKEN, production state, and live module paths are
not passed to the server. Browser traffic outside this fixture origin is blocked.

Browser/API operations are real, including login, account creation, settings persistence,
token issuance, MCP tools/call, and usage projection. Only the browser clipboard interface
is stubbed to capture values deterministically; OS clipboard permission behavior is not tested.
No production account or network integration is contacted.

Public-fixture screenshots and sanitized JSON:

- `/workspace/scratch/station-workflow-qa/report.json`
- `/workspace/scratch/station-workflow-qa/cards-375.png`
- `/workspace/scratch/station-workflow-qa/cards-768.png`
- `/workspace/scratch/station-workflow-qa/cards-1440.png`
- `/workspace/scratch/station-workflow-qa/account-settings.png`
- `/workspace/scratch/station-workflow-qa/account-activity.png`

Screenshots are prohibited while a one-time token reveal exists in the DOM. Playwright traces,
DOM dumps, raw request bodies, server logs, clipboard values and generated tokens are not
published. Failure records contain only check name, error type, and test source location.
Subprocess cleanup is in `finally`, with SIGTERM/SIGINT handling and a SIGKILL timeout fallback.

## Verified workflows

| Area | Coverage and observed result |
| --- | --- |
| Main routes | Overview, Integrations, Connections, Assistant, Settings, Backups: headings, title, active navigation, labelled controls, no dialogs, axe checks passed. |
| Mobile/tablet/desktop library | 12 mixed short/long-description cards: all 500px high at 375 and 768 widths; all 508px at 1440. No document horizontal overflow. |
| Upfront endpoint | Copy button visible without opening details at all three widths; click handler copied the selected endpoint. |
| Configure | Full-page routed settings, no dialog; labels wired for text, secret, textarea and select controls. |
| Account creation | Two new accounts created through the UI, blank and disabled; one source now has three independent configurations. Shared source remains byte-for-byte unchanged. |
| Account selection | Three-option dropdown switches endpoint, settings and actual test request target together; persisted values and test response checked. |
| Workspace tabs | Connect, Tools, Code and Activity route correctly without dialogs; tool name present; Code explicitly warns source is shared across every account while selector contains three accounts. |
| Connections | Selected-account Copy, Configure and Test target the same account and display its actual test result. |
| Library Back | Search and Setup-needed filter retained; departure scroll 1593px restored to 1593px. |
| Dirty settings | Route Cancel retains local edits; account-switch Cancel restores original selector and route; Accept leaves without persisting changes. |
| Dirty editor | Route Cancel preserves buffer; Accept leaves source unchanged. |
| Recovery | Unknown account, unknown source, unknown tab, unknown route, malformed encoding and duplicate account query recover using visible links. |
| Unauthenticated scope | Deep link shows login rather than source; admin listing/source/usage and MCP requests denied. |
| Token scope | Generated account token can list its own tools; other account returns 403; admin usage API returns 401. One-time output copy verified without logging its value. |
| Usage exclusion | Setup tests, unauthenticated tool requests and tools/list do not count as recorded calls. |
| Actual usage | Three real tool calls: two successes, one isError response. API totals: 3 calls, 1 error, success rate 2/3; measured average latency nonnegative (1.75ms in final run). Response bodies identify the intended account. |
| Usage UI | Overview: 3 / 1 / 66.7%; graph and daily table agree. Personal account: 2 / 1 / 50.0%, two recent rows; 30-day range retains actual totals. |

## Fixed during QA — one-time token leave protection

The first run found that leaving Connect destroyed a newly revealed, uncopied private token.
The page now implements `stationDirty` / `stationBeforeClose`: Cancel retains the route and
reveal; confirmed leave discards it. Actual successful clipboard copy, explicit secure-storage
acknowledgement or revocation clears that warning. The same hook covers browser unload and
sign-out. The final browser run verifies route Cancel and Accept plus successful token copying.

## Additional theme checks

All six main routes were checked in dark mode with reduced motion at 375, 768 and 1440px; no document overflow. Overview, Integrations and Connections also pass dark-mode axe audits.

## Backend review regressions

- Unknown, even syntactically valid tool names are stored as `(invalid)`; API/disk never retain
  arbitrary caller-supplied tool-name strings. Real registered tool names remain useful metadata.
- Restoring a legacy backup without `usage.json` clears destination activity and stays empty after
  restart. Full backups with recorded history continue to restore their matching activity.
- `npm run test:pwa`: 16/16 pass with the Ribbon S assets, scoped cache and forest theme.

## Boundaries and handoff

- This task created only `scripts/test-workflows.mjs` and `docs/QA_WORKFLOWS.md`.
- Existing product changes belong to the primary/frontend/backend agents and were not edited.
- No commit, push, deployment, production restart, or production credentials were used.
- No external provider integration, real OAuth consent UI, PWA/offline flow,
  destructive account deletion, public share-link issuance, or native clipboard permissions
  were exercised by this browser suite. Existing backend instance tests cover scoped OAuth.
- The first exploratory run contained harness-only failures (hidden private-token content,
  route-recovery timing, exact 401 versus valid 403 denial, toast entrance animation). These
  were corrected in the test, not the product; the final rerun passes all 68 checks after the product fix.

## Existing protocol suites

Final local results: smoke 36/36, OAuth 44/44, scoping 15/15, self-contained configuration 10/10, OpenAI mock 10/10 and Anthropic/Gemini assistant mock 57/57. The OpenAI suite was rerun independently after a concurrent run inherited conflicting provider test state; no product change was required. CI runs these suites sequentially. No live provider billing or service credentials are used.

## CI entry-point compatibility

The first GitHub run stopped before browser startup because the pinned Playwright package's
CommonJS entry did not expose `chromium` as a synthetic named ESM export. The harness now accepts
the named or default CommonJS export and asserts that a launcher exists. Reproduced locally using
CI-pinned Playwright 1.55.0 / axe 4.10.2: 68/68 checks and 19 audits pass. This local compatibility
run used the workspace's installed Chromium via QA_BROWSER_EXECUTABLE; GitHub installs the pinned
package's own browser and is the authoritative CI result.
