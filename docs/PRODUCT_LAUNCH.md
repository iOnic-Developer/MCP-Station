# MCP Station 2.7.0 release preparation

## Status · 2026-10-16

**Stable release approved; publication pending parent verification after CI.** This documentation
pass prepares the complete 18-module release on `redesign/public-product` in
`/workspace/mcp-station-public-product`. It does not stage, commit, push, publish, merge or deploy.
No GitHub release, image tag/digest, wiki sync or revised-site publication is claimed here.

## Prepared surfaces

- `README.md`, `docs/wiki/**`, `docs/DOCKERHUB.md`: 2.7.0 stable setup and current features.
- `docs/media/RELEASE_NOTES_DRAFT.md`: complete stable release notes, pending publication verification.
- `docs/media/ANNOUNCEMENTS.md`: announcement copy ready after verification.
- `docs/media/SCREENSHOTS.md`: sample-data captions, not live-service evidence.
- `docs/site/**`, `scripts/test-product-page.mjs`: stable CTA, main links, pull/clipboard contract,
  and version-neutral regenerated artwork in `docs/site/assets/product/` (inside owned paths).
- Existing canonical product page retained: https://ionic-developer.github.io/MCP-Station/site/

## Release truth and limits

Pin `dbzocchi/mcp-station:2.7.0`; moving `:2.7` and `:latest` follow stable releases. All 18 service
modules are included, plus `_template`. A fresh module volume gets all folders; startup adds only
missing bundled folders and never overwrites existing sources. Persist state/source/Files storage.
Historical 2.4 and beta rollback context is retained in Versions and Images, not current feature labels.

ChatGPT, Claude, Claude Code and LibreChat are compatibility paths subject to transport, auth,
features, plan and admin policy—not newly certified live sessions. Local/cloud models require an
MCP client. APIs need usable authorized adapters; universal website automation is not promised.
One administrator controls service configurations, not separate human tenants. Modules are trusted
in-process code. Assistant context can leave the station for the selected provider or gateway.
The bundle audit's 274 offline checks are attributed prior results, not a new live-service test.

## Parent publication checklist

- [ ] Review this scoped diff alongside parent-owned code, package, workflow and changelog changes.
- [ ] Run required application suites/CI; choose and record final source commit.
- [ ] Publish and verify GitHub 2.7.0 release, Docker `2.7.0`, `2.7`, `latest` tags and digests.
- [ ] Merge/push approved source; verify all main documentation/raw-image links.
- [ ] Sync wiki and Docker Hub overview; deploy and verify revised Pages CTA and social image.
- [ ] Confirm sample-data captions, screenshot crops and live-service/client-test boundaries.
- [ ] Announce only after publication verification; record actual results separately.

## Scope boundaries

Backend, packages, workflows, changelog and parent-owned `docs/assets/product/**` remain untouched.
The old artwork there may retain preview lettering; current site metadata instead uses newly
regenerated artwork under `docs/site/assets/product/`, copied by the existing Pages assembly.
Other technical/design documents outside this task may contain historical channel statements;
the parent should audit those separately. No unsupported product domain is introduced.

## Validation record

Local checks passed on 2026-10-16:

- Full `scripts/test-product-page.mjs` run with `REQUIRE_PRODUCT_SCREENSHOT=1`, Playwright at
  `/workspace/omniforge/node_modules/playwright/index.mjs`, and axe at
  `/workspace/omniforge/node_modules/@axe-core/playwright/dist/index.js`.
- Stable CTA, exact 2.7.0 pull/clipboard, all 18 module names, main source links, canonical/social
  metadata, local font/license identity and outlined SVG/PNG dimensions.
- 375 × 812, 667 × 375, 768 × 1024 and 1440 × 1000: no horizontal overflow, CLS ≤ 0.01,
  44px targets and zero axe WCAG AA violations. Root/docs/project-prefixed paths, keyboard,
  reduced motion, clipboard success/failure, 200% text, no-JS and zero external requests passed.
- 24 Markdown files: 109 local/main-source link targets, balanced fences and final newlines.
- All 18 module manifest slugs documented; Docker Hub overview below 10,000 characters.
- Syntax checks for page test, media generator and site JS; `git diff --check`; changed/new-file
  ownership check passed. Four browser captures saved outside the repo at
  `/workspace/scratch/station-stable-product-validation/`.

The existing Pages location returned HTTP 200; that does not verify deployment of this local revision.
Application suites and CI are parent-owned and were not run/triggered by this scoped docs task.
No new live-service or client sessions were exercised.

## Remaining out-of-scope references for the parent

- `docs/PRODUCT_DESIGN.md:164` still says package version remains 2.4.0 until approved release.
- `docs/MODULE_BUNDLE_AUDIT.md:3` labels its original audit source-only; retain as audit history
  or add a parent-owned release-context note.
- `docs/BUILD_JOURNAL.md`, `docs/QA_NAVIGATION.md`, `docs/UX_REFINEMENT.md` and
  `docs/NAVIGATION_REFINEMENT.md` record historical branch work; distinguish history from current docs.
- `docs/REFERENCE_2_4.md` remains intentionally historical.
- Old SVG/PNG artwork under `docs/assets/product/` is parent-owned and may retain preview footer/title;
  current social metadata and tests use regenerated stable artwork in `docs/site/assets/product/`.
- Backend/package/workflow/changelog version alignment and publication verification remain with parent.
