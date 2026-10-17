# Simple integration creation

## Base and scope

Base: `e548e02ce613d186b7ed5f59af6b10c006b8b99c`, latest supplied main 2.7.1.
Branch: `feat/simple-integration-create`. Runtime version: `2.7.2_beta`;
package version: `2.7.2-beta.1`. No merge, deployment or Docker Hub publishing.
PR6 is a reference, not a merge source. Reuse only chat/session implementation and
an isolated local-provider test fixture. Preserve main's five styles, appearance
controls, account/source separation, usage, bundles and existing workspace routes.

## Vocabulary and navigation

A service source supplies shared tool code. An account owns its credentials,
endpoint, test state and client access. Previously Integrations and Connections
were two management entry points for the same installed sources. Integrations now
lists every account as a boxed row: service, account, endpoint/copy, Configure,
Test, Access and a native square enable control; small test/client metadata below.
Filters count accounts, not sources. Legacy `#/connect` redirects to Integrations.
Installed services remain searchable; Add existing account opens the existing
service picker. Source details retain Settings/Connect/Tools/Code/Activity/Assistant.

## Creation flow

Primary navigation and top plus action open `#/create`, not AI settings.
Only service name is required. Goal and API docs URL are optional details.
Creation explicitly authorizes the current assistant to author one new source:
1. Validate input and reject credential-bearing documentation URLs.
2. If no provider key is configured, show Settings guidance and create nothing.
3. Create a source with disabled state persisted before its first load.
4. Load its source-scoped chat and POST the authoring brief to `/api/assistant`.
5. Display actual text, tool results and errors from the existing streaming loop.
6. Offer review code, configure credentials, then Test/Access; never auto-enable.

No `/api/global` updates, provider/model default changes, credentials-in-prompt,
new AI endpoint or runtime dependency. Existing session/CSRF and source tool scope
are reused unchanged. Prompt constraints forbid other-source changes, AI settings
changes, credential reuse and destructive/live writes. They are not an executable
code sandbox: generated code must be reviewed before use, just like existing
assistant-authored modules. No changes to existing tool authorization boundaries.

## Lifecycle and failure

Creation form and chat sessions are application-owned. Navigation preserves input,
stream and progress. Returning remounts the same session. Failed generation retains
the source and fields; Retry builds on that source instead of creating a duplicate.
Create another starts a fresh form. Logout clears private in-memory chat state.
Browser reload does not resume an in-flight HTTP stream; persisted source and chat
remain accessible from the integration workspace. The page states this explicitly.
A completed AI reply is not claimed as a configured account or successful live test.
Network ambiguity on source creation requires checking Integrations before retry.

## Files

- `app.js`: primary navigation, create route, legacy redirect, session teardown.
- `views/list.js`, scoped additions to `app.css`: account rows and responsive UI.
- `views/build.js`: small form, authoring request, truthful progress/retry lifecycle.
- `chat.js`, `chatSessions.js`, assistant views: owned streams and serialized saves.
- `views/integration.js`: keep installed-account flow, link new service to creation.
- `server/index.js`: optional boolean enabled=false draft persisted before load.
- `env.js`, package metadata, changelog/build journal: beta version and rationale.
- `test-simple-create.mjs`, `test-workflows.mjs`, product workflow: regression gate.

## Validation and limits

98/98 real-browser workflow checks, 26 axe audits, 83 focused creation assertions.
Focused tests use a local scripted OpenAI-compatible provider and real backend
module-writing tools; verify actual saved code, hot reload, source scoping,
CSRF, no global AI mutations, route persistence, missing-key block, failure/retry,
independent rows and no overflow at 375/768/1440 in light/dark across five styles.
Latest smoke (36), OAuth (44), scoping (15), self-contained (10), OpenAI (10),
assistant streaming (57), PWA (16), configuration (85), instances, usage and all
18 bundled sources pass. Frontend syntax: 23 modules; git diff whitespace clean.
No paid/live model quality, real third-party credentials or production service
connectivity tested. GitHub CI status is reported in the PR/hand-off, not assumed.

Product page: static contracts and explicit Playwright/axe browser audit passed.
