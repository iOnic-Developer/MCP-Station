# Focused workspace UX refinement

Working branch: `redesign/public-product`, based on `e83c04e`.
Frontend-only refinement on the existing PR branch. No version bump, backend change, Docker publication or deployment is part of this pass.

## Decisions

- Remove the numbered setup strips entirely from module and add-account views, including their obsolete CSS and refresh selectors. Setup state remains truthful in settings, test results and the account switch; enabling is not represented as verification.
- Replace the module's stacked header controls with one compact account action surface. Account picker/add, endpoint/copy, test, enable and status have explicit grid areas through normal grid placement. Desktop uses one action row plus status; narrower workspaces deliberately stack account and endpoint rows, then align test and enable together.
- Keep endpoint text to one ellipsized line. The complete value remains in the DOM, accessible label and title; the focusable value and existing Copy/manual fallback keep long endpoints usable.
- Use six equal module links, in a single desktop row and an intentional three-by-two mobile grid. Each has a minimum 44px target. The current section is solid with an underline treatment, not a subtle tint alone.
- Add a first-class Assistant section and an explicit Ask assistant link on every library card. Account context stays in the URL, but chat GET/PUT and assistant `mcpId` always use the source ID, never the selected account ID.
- The scoped assistant is inline, not an overlay. It loads the existing source conversation, persists via the existing backend, warns that code changes affect every account, handles load failure/retry and disposes the streaming pane on `station:dispose`.
- Preserve mounted panes and drafts on metadata refresh. Scoped refresh updates provider availability without rebuilding chat; station refresh updates provider/model information without rebuilding chat.
- Promote editor assistant controls to its upfront toolbar, with a direct Assistant workspace link. Open the split by default at desktop widths of at least 1200px; keep it opt-in on narrower devices. Existing editor IDs, data attributes, save/reload behavior, dirty guards and code-replacement confirmations remain intact.
- Replace the station assistant's fixed height deduction and large minimum with a flex/min-height-zero chain from body through app/shell/main/route/content/chat. Transcript scrolls; composer stays in the pane. Limit message reading width rather than squeezing the pane.
- Use `100dvh` with a visualViewport height enhancement at normal zoom, leaving pinch zoom alone. Reserve mobile navigation and safe-area space; accommodate the existing installation rail in normal flow without editing PWA files. Optional expanded API context is internally scrollable and bounded.
- Underline ordinary text links, retain button/navigation exceptions, use selective accented actions rather than globally green buttons, and give selects explicit theme-aware chevrons. Retain existing input boundary tokens and 44px control minimums.
- Make each mounted transcript keyboard-focusable so keyboard users can scroll the log. Existing stream Stop, provider warning, clear confirmations, scope and token controls remain in place.

## Verification and parent QA handoff

All project commands ran only inside `LibreChat-Workspace` using the Unraid docker-exec tool.

- `npm run test:ui`: passed, 21 frontend modules checked with Node syntax validation.
- `git diff --check`: passed.
- Focused browser regression: `/workspace/scratch/station-usability/refinement.mjs`.
  Run: `node /workspace/scratch/station-usability/refinement.mjs`.
  Uses a local static HTTP fixture and intercepted APIs, not production credentials or a live model.
  Checks direct library navigation, source GET/PUT and assistant scope, metadata draft retention, route-leave stream abort, removed progress strips, six equal 44px tabs, one-line endpoint, no horizontal overflow, station document height/composer clearance at 375/768/1280/1600px, a shorter 375x520 viewport, desktop editor split and unsaved-edit navigation guard.
- Axe WCAG A/AA checks passed for station and module Assistant at 375/1440px in both light/dark themes (eight combinations). A transcript keyboard-scroll violation found during QA was fixed before rerunning.
- Existing usability fixture rerun passed: `/workspace/scratch/station-usability/check-refined-legacy.mjs`. Only scratch test expectations changed: assert absence of removed progress UI and explicitly accept the existing uncopied-token leave confirmation. Covers secret sentinel saves, source-only editor, dirty navigation/file/account guards, token rotation, failed tests, actual usage/error behavior, blank account creation/removal, filter/scroll restoration and malformed routes.
- Fixture screenshots: `/workspace/scratch/station-usability/refined-{light,dark}-{375,1440}.png` (module Assistant). Browser fixture scripts and screenshots are external scratch artifacts, not added to the repository.

## Limitations / follow-up

- Canonical isolated real-server suite now passes 81/81 browser checks and 23 axe audits. It includes account/protocol integration, the new Assistant route, one-click module entry, uniform mobile tabs, compact action bars, removal of setup strips, viewport/composer geometry and draft preservation at 375/768/1440px and 520/900px heights. No live assistant-provider call is claimed.
- Chromium viewport resize is not a physical iOS/Android soft-keyboard test. Parent should check real-device keyboard open/close, orientation, safe areas, very short landscape viewports, optional context expanded and installed-PWA mode.
- The station assistant is viewport-contained. Module Assistant deliberately remains a bounded work surface below account controls in the scrolling module page, not a second fixed full-screen shell.
- Conversations remain source-shared using the existing backend. Simultaneous chat tabs retain the existing last-write persistence behavior; this change does not add concurrency coordination.
- Unsaved typed drafts survive metadata refresh, not deliberate route changes/reloads. Navigating away aborts active streaming; completed tool changes are not undone.
- The scoped assistant's selected-account action bar does not imply per-account code isolation. Shared-code warning and source-scoped request IDs are intentional.

## Short-phone follow-up and final verification

The first added geometry check caught a 375×520 viewport with too little space for chat.
Short-screen rules now compact secondary chrome and bound the scrollable PWA installation
rail without removing offline/update controls or reducing touch targets. The pane grew from
226px to 308px in the focused fixture; transcript space grew from 36px to 112px.
The permanent suite verifies composer clearance and document bounds, not only screenshots.

Final commands: `npm run test:ui` (21 modules), `npm run test:pwa` (16/16), and
`npm run test:workflows` with Playwright/axe module overrides (81/81 checks, 23 audits).
Screenshots/report: isolated fixture output under `/workspace/scratch/station-refinement-qa`;
CI publishes its own sanitized evidence. Existing published `2.6.0_beta` is unchanged until
an explicitly requested image rebuild. Physical device/keyboard acceptance remains outstanding.
