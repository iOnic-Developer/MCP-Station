# MCP Station identity · Ribbon S

Original custom curved S ribbon in forest `#116859`, with an ink `#172c25`
underside and pale `#f7f8fa` icon field. This replaces the former opposing rails;
there are no circles, network nodes, sparkles or hexagons in the symbol.

The favicon uses a separately drawn optical S for 16px legibility. All existing
public asset filenames are preserved. The wordmark retains licensed outlined
Plus Jakarta Sans lettering; see `../fonts/SOURCES.md` and its SIL OFL license.

See `docs/BRAND.md` at the repository root for design rationale, usage, asset
inventory, regeneration and verification notes. Run the build-time-only script
`scripts/generate-brand.mjs` with @resvg/resvg-js 2.6.2 available through
`BRAND_RESVG_MODULE`. No renderer or font is required by the running product.

## Interface integration contract

The application uses the artwork paths above and the font family `Plus Jakarta Sans`
(declared in app.css and pwa.css). app.js imports `initPwa` from `./pwa.js`;
repeated calls are safe. The module also exports `requestInstall` and
`applyUpdate` for optional interface actions. Give the primary main element
`id="main-content"` so the index skip link has its target.

PWA controls live in a separate, namespaced, in-flow aside: they do not alter the
app DOM or cover editor controls. Install dismissal lasts this browser tab's
session. An update must actually be waiting before its button appears, then the
user confirms a reload warning. First activation and other tabs' updates never
reload this tab. No dashboard content is available offline.

The worker only intercepts clean same-origin GETs on its explicit static list,
and clean dashboard navigations (`/` and `/index.html`) for a network-first public
offline fallback. Auth/OAuth/API/MCP/unknown navigations, query-bearing URLs,
Authorization headers, ranges and non-GET requests pass straight through.
Precache fetches omit credentials and reject redirects, HTML in asset responses,
private/no-store responses and cookie/authorization-varying responses. There are
no runtime cache writes. Bump the worker cache version when precached files change.

Install availability depends on HTTPS (localhost excepted), browser and device.
The install prompt is never simulated. iOS gets Share → Add to Home Screen
instructions. Offline browser status is not treated as evidence that the server
is healthy. Filenames containing dots cannot be MCP module slugs under the
existing slug validator; no reserved-slug or server changes were made.

Checks: `node scripts/test-pwa.mjs` (Node built-ins only).

## Primary implementation references (reviewed 2026-10-16)

- https://web.dev/articles/service-worker-lifecycle — waiting / activation / claim.
- https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event — deferred, browser-dependent native prompt.
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine — browser connectivity is not server reachability.
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable — manifest, HTTPS and platform install differences.

Verification includes a real Chromium two-version worker handoff: an unsaved draft
survives waiting and cancellation; consenting reloads only that tab, while the
second tab retains its draft. The retiring worker's `redundant` event must not be
mistaken for failure of the new waiting worker (covered by a regression test).
