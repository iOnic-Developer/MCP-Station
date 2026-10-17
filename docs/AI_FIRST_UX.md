# AI-first MCP creation UI

## Scope and exports

Implementation is limited to `views/build.js`, `views/addNew.js`,
`views/integration.js`, `views/list.js`, `public/assets/css/app.css` and this file.
Paths for views are relative to `public/assets/js/`. Existing chat views,
`chatSessions.js`, application routing and backend routes are not changed here.
No dependencies were added; no commit, push or deployment was made.

`views/build.js` exports **`renderCreateMcp(root, ctx)`**. The parent must import
this in `app.js` and call it for `route.create` (`#/integrations/new`) instead
of `renderAddAccount`. The parent also owns the global navigation/Overview CTA
copy: use **Create MCP** for that route. The library CTA already uses that copy.
Until wired, the canonical new route still displays the old account screen.

Keep `renderAddAccount(root, ctx, sourceId)` on the source `add-account` route.
Its direct behavior remains compatible with existing account regression tests.
The creation page reveals that same form via **Use an existing service**;
there is no new query parameter or route-parser requirement.
`openAddNew(ctx, target)` remains available for the **Create manually** disclosure.
`openSourceTask(source, intent)` in `addNew.js` stages the workspace repair/extend
requests. Integration cards retain their accessible **Ask assistant** link name.

## User journey

1. Opening creation or choosing an example creates nothing.
2. Collect a required service name and required goal, with optional documentation
   URL and progressively disclosed base URL. Generate the slug from the name;
   the primary flow has no compulsory slug field. Names with no ASCII letters or
   digits receive a validation message. Slug collisions are backend errors shown
   inline; the user can choose a different name without losing the goal.
3. **Continue to Assistant** explicitly creates a starter, disables it, stages a
   source-scoped build request, refreshes station data, then navigates to the
   returned session href. The user reviews the request and presses Send to start.
   Staging never silently calls the provider or initiates paid work.
4. The request directs the existing agent to inspect the source/module contract,
   consult authoritative docs, and save actual files using existing backend tools.
   It asks for clarification rather than invented endpoints or auth mechanisms.
5. Built source is not a configured account, and enabled is not a successful test.
   Review executable generated code, enter credentials in Settings, test, then
   enable deliberately. Shared source edits affect every account of that service.

Required fields use native validation and visible labels. Optional URLs use native
URL controls plus HTTP(S) validation and reject userinfo, query strings and fragments
rather than placing possible URL credentials into a chat draft. This is not a
secret scanner: users are explicitly told not to include secrets anywhere in the
form, names, goal or URL paths. No credential-setting API is called by creation.

## Backend handoff: required before claiming atomic safety

The UI sends `POST /api/mcps` with `{name, slug, description, enabled:false}`.
It expects the existing successful response shape containing `{id, slug}`.
It immediately sends `PATCH /api/mcps/:id` with `{enabled:false}` before staging
or opening chat. Manual creation uses the same disabled intent and PATCH.

**Current backend ignores the create flag and auto-enables during loadModules.**
The PATCH is not atomic: a starter can briefly be enabled, and a failed PATCH can
leave it enabled. The UI reports that risk and retains the returned source id so
Retry retries disabling/preparing that starter, not another POST. It does not
promise to recover a lost POST response: inspect Integrations before retrying an
uncertain network failure. Backend slug uniqueness prevents ordinary duplicates.

The parent must honor `enabled:false` by persisting the source registry disabled
before `loadModules` can expose it, including across reload/restart; changing the
response or PATCH alone does not remove the initial race. Preserve existing create
semantics when the flag is omitted if other clients depend on them. This task did
not edit backend files or falsely claim that the UI has solved that race.

## Chat lifecycle and source identity

Follow `docs/CHAT_LIFECYCLE.md`. Creation and task intents call
`stageDraft('source:' + sourceId, prompt)` and navigate via the returned session's
href. The explicit prefix also handles a source literally named `station` without
mistaking it for the station-wide conversation. Never scope to a service-account
instance id, replace a chat controller, auto-submit, or dispose a cached session.

**Fix something** asks for the problem and expected result, then requests diagnosis
without printing settings, credentials or raw test output. **Change or extend**
asks what behavior/tools should change. Prompts include only source identity and
the explicit task, not account settings, test error payloads or arbitrary metadata.
Both confirm before replacing an existing unsent source draft. They preserve the
conversation and any running work; Send remains a separate user action.

Prompt instructions are guardrails, not a sandbox or a new permission boundary.
Existing backend scope, credential and tool security rules remain authoritative.

## Design and accessibility

Reuse existing typography, semantic theme tokens, icons and surfaces; no large hero,
new palette, external font or dependency. The compact form has a maximum 860px
measure, visible labels/help, 44px controls, inline errors and polite progress.
Examples are real draft inputs, not auto-submitting suggestions. Account reuse and
manual creation use progressive disclosure; Build / Configure / Test & enable
remain separately explained. Layout wraps at small widths without horizontal scroll.

The UI/UX skill's local search script was not available in this workspace. Styling
therefore uses the existing Station design system plus the skill's built-in
accessibility/forms guidance, not an asserted database/design-system search match.

## Verification

All commands ran in `LibreChat-Workspace` on `feat/assistant-first`.

- `npm run test:ui`: 23 frontend modules passed syntax checks.
- `npm run test:workflows` with the existing external Playwright/axe modules:
  **102/102 checks passed; 27 axe audits**. No test files were changed.
- A disposable harness at `/workspace/scratch/test-ai-first-ui.mjs` uses the actual
  isolated Station server, real template creation/PATCH/account APIs and browser
  session manager; no production state, credentials or external provider traffic.
  Because app.js is parent-owned and not yet wired, it imports/mounts the exported
  creation view directly and explicitly refreshes the real application data before
  source navigation. It is not a claim that the canonical route is already wired.
- That harness checks no eager creation; examples; required fields; URL credential
  rejection; `enabled:false` request; failed-PATCH retry with just one POST; disabled
  final state; correct source-scoped draft; zero AI sends; repair/extend draft
  confirmation/cancellation; existing-account creation; and manual disabled creation.
- Four additional serious/critical axe audits cover the creation form at 1440px and
  375px in light/dark themes, with no horizontal overflow and no browser exceptions.
  Theme transitions settle before contrast sampling. Generated code/provider behavior
  is intentionally not exercised: this UI prepares a request, it does not send it.

Parent follow-up: wire `renderCreateMcp`, update global/Overview CTAs and any tests
that expect the general new route to display the account form immediately, implement
atomic disabled creation, then rerun integrated route and backend regressions.

## Integrated follow-up

The application now routes the global Create an MCP action to this form. Overview
leads with the AI build journey. The server honours `enabled:false` before loading
the new source; the following PATCH is idempotent defence, not the first disable.
The permanent real-server test holds that PATCH and verifies the starter is already
disabled. No model request is sent until Send.
