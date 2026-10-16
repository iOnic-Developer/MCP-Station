# Product shell redesign — parent handoff

Branch: `feat-product-redesign`, based on clean `main`. No commit, push, release, version change or deployment.

## Scope and design

Original Station switchboard mark; ink/indigo operational console, maximum 4px corners on new UI. Desktop sidebar becomes five labelled mobile bottom-navigation destinations: Overview, Modules, Connections, Settings, Help. Self-hosted Manrope and JetBrains Mono copied unchanged with SIL OFL licenses. Old logo files remain untouched. No runtime dependencies added; no build step.

The design-system search bundle was unavailable as confirmed by the parent. Guidance is a fallback from the UI skill's accessibility/navigation priorities and professional-rules reference, not a claimed database palette match. Only font files/licenses were reused from OmniForge, not its layout, styles or brand.

## Files and DOM contracts

- `public/index.html`: stylesheet ordering `app.css`, `v2.css`, then `product.css`; manifest/icons, skip link and live toasts.
- `public/assets/js/app.js`: persistent shell, auth-generation and refresh-generation guards, refresh and hash routing.
- `public/assets/js/product.js`: shared decorative SVG icon helper, counts and content for Overview/Connections/Settings/Help.
- `public/assets/js/assistant-shell.js`: same `mountAssistant(ctx)` call contract, delegates conversation UI to the unchanged `chatPane`. Station conversation is **memory-only for this authentication session**. The old `views/assistant.js` is untouched and no longer imported by the shell. The legacy localStorage key is removed at startup/session end.
- `public/assets/js/views/login.js`: branded password form, required current-password autocomplete, disabled pending submit, inline role=alert failure. Normalizes the legacy api.js 401 message while api.js remains parent-owned.
- `public/assets/js/pwa.js`, `public/sw.js`: explicit public-asset caching and user-accepted updates.
- `public/assets/css/product.css`, `public/assets/brand/*`, `public/assets/fonts/{manrope.ttf,jetbrains-mono.ttf,OFL-*.txt}`, `public/assets/manifest.webmanifest`.
- `server/index.js`: only the explicit `/sw.js` route before static/module dispatch and static cache policy (HTML/JS `no-store`, decoration `no-cache`). Worker MIME, nosniff and root permission explicit.
- `server/lib/mcpHost.js`: only adds `sw.js` to reserved slugs. No module/auth/OAuth contract edits.

Preserved: `#app`, `#toasts`, `#listRoot`, `#bAdd`, `#bReload`, `#bBackup`, `#bLogout`; signatures `renderList(root, ctx)`, `openAddNew(ctx)`, `openBackup(ctx)`, `openStation(ctx)`, `mountAssistant(ctx)`. Station settings is opened by `[data-action=station]` rather than old `#bStation`.

New: `#main-content`, `.station-shell`, `.station-nav`, `.station-main`, `#route-label`, `#shell-status`, `#station-update`, `#station-assistant`, `#page-{overview,modules,connections,settings,help}`. Hidden pages remain mounted; do not use unscoped `h1` or button text selectors in tests.

Routes: `#/overview`, `#/modules`, `#/connections`, `#/settings`, `#/help`. A module link is `#/modules?module=<encoded-id>`; guide links use `#/help?section=workflow|scopes|contract|install`. Back/forward restores page scroll and focus. Skip link is intercepted so it does not overwrite the application hash.

## Refresh integration

`ctx.refresh()` fetches `/me` and `/mcps`, checks session and latest-refresh generation, and only updates page data/library. It does not remount the shell, assistant, drawers or dialogs. `ctx.listState` survives. Parent's `renderList` may set `ctx.renderModuleList = (root, ctx) => ...` to take control of subsequent library-only refreshes and preserve library search focus/expanded state. Without this hook the existing `renderList(root, ctx)` is called. This hook must update only the passed library root, not rebuild the shell.

Events:
- `station:mcps-changed`: existing trigger for data refresh.
- `station:data-refreshed`: after successful refresh, detail `{mcps}`.
- `station:shell-ready`: once per authenticated shell mount.
- `station:session-ended`: synchronous teardown hook for parent helpers/chat/editor resources.

Logout/401 clears sensitive DOM, ctx inventory and list state, closes/removes dialogs/drawers, aborts raw assistant fetch streams, and disposes the session-only assistant. The new adapter does not restore model messages into the next auth session. Fetch generation rejection prevents an old session response from recreating the authenticated shell. Raw `chatPane` requests receive the existing CSRF header unchanged.

## PWA safety

Only twelve exact public CSS/font/icon/manifest paths are intercepted for caching. No JS, dashboard HTML, admin API, OAuth endpoints, module endpoints, credentials, arbitrary assets or query-string requests are stored. Public fetches omit credentials, reject redirects, require a basic successful response and an expected MIME. Root navigations use the network without caching; a literal generic offline document is returned on failure. No OAuth/module navigation interception.

Worker activation never forces a page reload. Waiting updates are offered via `#station-update`, accepted by explicit confirmation (warns about open dialogs/drawers/assistant drafts). Only the accepting tab reloads. Increment `station-public-v1` when revising the cache inventory. HTTP LAN origins may not support workers/install; Help says trusted HTTPS or localhost and browser support are required.

## Checks run

- `npm ci --ignore-scripts --no-audit --no-fund` (no package-file changes).
- `node --check` on all owned/new JS plus the two server files.
- `npm test`: 36 passed.
- `npm run test:oauth`: 44 passed.
- `npm run test:scoping`: 15 passed.
- `node /workspace/scratch/station-shell-check.mjs`: fixture-only Playwright check. Tests worker response headers/manifest MIME, inline login error, shell and assistant DOM identity after refresh, draft retention, five nav destinations, hash/back, no horizontal overflow at 320/375/768/1440 across all pages, session cleanup, and public-only cache inventory. No real service/API credentials or live data used.
- Fixture screenshots: `/workspace/scratch/station-desktop.png`, `station-mobile.png`, `station-login.png`.

## Parent gates

Parent still owns library actions/layout, settings/add-new dialogs, UI/API helpers, tests and root design.md. Review the legacy library with the new 44px button defaults (its old action matrix hardcodes 30px rows). Preserve editor drafts/focus on refresh via the library hook. Wire editor/chat disposal to `station:session-ended` if those modules retain asynchronous callbacks or persistent per-module conversations. Existing `chatPane` remains unchanged; validate streamed assistant failure/cancellation and provider behavior in the final full integration suite. Review keyboard/dialog/focus/contrast, 200% zoom, landscape, reduced motion and user-accepted worker upgrade with an unsaved editor before release. Screenshots are generated, not a claim of human visual approval. No live public deployment testing performed.
