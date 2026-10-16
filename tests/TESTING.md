# Isolated Station regression tests

Run from the repository root with Node 22:

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:contracts
npm run test:browser
```

`playwright` and `@axe-core/playwright` are exact-pinned dev dependencies. No
production dependency versions are changed. `node:test` is the runner; the suite
does not require `@playwright/test`, a live Station, provider keys or module APIs.

## Workspace invocation

The existing LibreChat-Workspace Chromium cache can be reused. Its supplementary
shared libraries require this environment setting on that particular container:

```sh
export LD_LIBRARY_PATH=/workspace/scratch/cjs-theft-browser/libs/usr/lib/x86_64-linux-gnu:/workspace/scratch/cjs-theft-browser/libs/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
npm run test:contracts
npm run test:browser
```

CI installs its own Chromium system dependencies instead. To run a focused check:

```sh
node --test --test-name-pattern='editor|secret' tests/browser/station.test.mjs
```

## Isolation and reproducibility

- Both suites spawn the real server on a dynamically selected loopback port.
  `DATA_DIR` and `MCPS_DIR` are new OS temporary directories; modules are empty.
  The directories and server are removed/stopped in teardown.
- `APP_PASSWORD` is synthetic. Real login, `/api/me`, session cookies and logout
  are exercised, not replaced by mocked successful authentication.
- Provider credentials and the station bearer are cleared; all provider origins
  point at the local fixture, not upstream services.
- Browser contexts are fresh for every check. Network routing blocks other
  origins. Protected module/provider/backup mutations are synthetic route mocks,
  and unhandled API operations fail the test instead of reaching the server.
- Contract tests exercise the real authentication gate, CSRF rejection, health,
  public OAuth discovery and static headers/manifest/icon contents. They are
  separate from the existing smoke scripts, which remain unchanged.
- Delayed responses use explicit gates, not timing guesses. Short negative waits
  check that disposed listeners and cancelled jobs do not produce late effects.
- Browser checks use the actual rendered HTML/CSS/JS. No production files are
  patched or replaced, and no axe rules or known failures are suppressed.

## Coverage and interpretation

The browser suite includes valid/invalid/pending login; five routes at 375, 768
and 1440 pixels under dark/light browser preferences; axe on every route and the
library-tools/add/configuration/access/backup/station/editor overlays; named dialogs and real
forward/reverse focus trapping; cancellation and opener focus restoration;
configuration/test/disabled/error library states; refresh/search/filter/caret
retention; explicit public-sharing consent; masked keep/clear/replace module and provider secrets;
unsaved editor close, snapshot saves with newer typing, overlapping file loads,
typing during loads, assistant Clear and disposal; inventory initial/stale
failures and recovery; deep links/back/focus; pending/failed logout and expiry;
and real service-worker public-only caches and generic offline navigation.

**A light browser preference is not evidence of a working light theme.** The
separate theme contract asserts a genuine rendered colour change, using an
accessible theme toggle if supplied. Until that passes, light-preference matrix
runs may still be rendering the same dark UI. Parent UI/helper work can make
these assertions fail; fix the app contract rather than deleting assertions.

`test-artifacts/` contains synthetic-fixture screenshots, per-surface axe JSON
and local TAP output, and is ignored by Git. Screenshots are also captured on
failure. CI uploads screenshots/axe files even when tests fail, retains them for
seven days, has read-only repository permissions and never builds/deploys an
image. Existing deployment workflows and smoke commands are not changed.

The original `/workspace/scratch/station-shell-check.mjs` supplied useful shell,
cache and offline checks; these are adapted here with real auth and checked-in
fixtures rather than relying on that scratch script. No editor scratch script
was found during the initial workspace inventory.

## Initial handoff run (in-progress product redesign)

Local clean dependency installation (`npm ci --no-audit --no-fund`) passed.
`npm run test:ui` passed. `npm run test:contracts` passed 3/3. The final browser
run completed 41 checks: 24 passed, 17 failed, none skipped or cancelled.

The remaining failures were intentionally retained:

- Six route matrices: Help's inline Modules link lacks sufficient distinction
  from surrounding text (`link-in-text-block`); all five routes were scanned.
- One theme contract: no functioning light theme.
- One invalid-login axe check: hovered sign-in button contrast is 4.01:1 rather
  than 4.5:1.
- Seven overlay contracts: missing accessible dialog names or drawer dialog
  semantics. Axe findings are saved even when the focus contract fails first.
- Two editor-close contracts: the old drawer helper does not consult the editor's
  close guard, so the expected confirmation never opens. The snapshot/newer-
  typing assertions before the close check passed.

Production lock entries were compared with the pre-install lockfile and were
unchanged. Existing `npm test`, `test:oauth`, `test:scoping`, `test:openai` and
`test:selfcontained` smoke commands were preserved but not run for this handoff.
The new GitHub workflow was authored locally, not executed on GitHub. Rerun the
suites after the parent finishes the UI/API helpers; no commits were created.
