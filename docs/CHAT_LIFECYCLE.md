# Assistant conversation lifecycle

## Ownership and scope

`public/assets/js/chatSessions.js` owns each conversation's DOM pane and `chatPane`
controller for the lifetime of the authenticated application. The station has one
session; the source-session Map is keyed by **source id**, not service-account id.
The source Assistant workspace and code-editor split move the **same pane** between
mount points. They never create separate controllers or reload competing histories.
Headers and editor-only observers/listeners belong to views, outside the pane.

Route disposal means **detach**, not stop. The pane keeps the composer draft,
optional context fields, partial output, completed tool notes and conversation while
its reader continues consuming SSE off-screen. Opening the code editor again reads
files from disk, including changes made while it was detached. Editor code-insert
listeners and observers are removed on leave; a new editor installs fresh ones.

This is not a server-job system. Reloading or closing the tab still disconnects the
request and the server aborts upstream work. Browser/OS sleep, freezing and network
loss can interrupt a stream. No completion guarantee is made for those cases.

## Cancellation and security boundaries

- **Stop** aborts that session's request and retains already received content/tool changes.
- **Clear** is idle-only; use Stop first. It clears history, not integration files.
- **Successful logout**, unauthenticated boot, any `station:unauthed` event (401),
  or a failed station boot due to connectivity invokes hard teardown. Logout waits
  for the logout API response before teardown; a rejected logout remains signed in.
- Hard teardown aborts all controllers, destroys cached panes, clears drafts/context
  and station browser history, and advances a generation fence. Pending source
  history loads cannot create sessions after teardown. Queued old persistence calls
  are skipped. A PUT already received by the server cannot be undone client-side.
- A broken assistant transport explicitly aborts its request and displays the error;
  it is not silently treated as a successful completion.
- Source persistence uses the existing server chat endpoint. Station persistence
  uses the existing `station.chat.v1` localStorage key (last 60 messages), removed on
  hard teardown. No settings, API keys or new credential persistence is introduced.
  As before, user-entered message/context text is part of conversation history.
- History snapshots are serialized through one save queue per controller, preventing
  concurrent segment/final PUTs from overwriting a later history with an older one.
  This is same-tab protection, not a cross-tab/server revision-locking protocol.
- The idle cache retains up to ten detached source sessions eligible for eviction.
  Active streams, mounted panes and unsent drafts are not eviction candidates and
  may exceed that bound. Evicted idle conversations reload persisted history.

## UI integration contract

Import from `/assets/js/chatSessions.js`:

- `getStationSession()` returns the station session synchronously, with defaults
  already configured even when requested before its first view render.
- `await getSourceSession(source)` accepts a source object `{id, manifest}` or a
  source-id string. Concurrent consumers share one pending history load. Failed
  loads are removed so the view can retry. Never pass a service-account id.
- A session provides `{chat, pane, scope, sourceId, label, href, mount, detach,
  setDraft}`. `mount(target)` moves the pane; `detach(target)` only detaches when
  that target still owns it. View disposal must **not** call `chat.dispose()`.
- `await stageDraft('station', prompt)` or
  `await stageDraft('source:<source-id>', prompt)` stages/replaces the draft only.
  A bare source-id string also works. Navigate to `session.href` separately.
  Nothing is sent until the user presses Send/Enter. Staging is explicit and
  replaces an existing draft; callers should confirm replacement if appropriate.
- Views also consume `ctx.pendingAssistantPrompt` when mounted. The caller must
  navigate to the intended scope first; do not set a source prompt for a station view.
- `assistantStatus()` returns `{count, sessions}` for running sessions. The matching
  `window` event `station:assistant-status` carries that object in `detail`.
  Entries contain only `{scope, sourceId, label, href}`—no prompts, responses,
  tool arguments or credentials. Each link returns to the correct source route.
- `resetChatSessions()` is the low-level hard teardown. Application teardown uses
  `resetAssistant()` from the station view to also discard its cached header panel.

`app.js` lifecycle handoff for parallel UI work:

- `renderRoute()` calls `parkAssistant()` rather than `resetAssistant()` on leave.
- `boot()` calls `resetAssistant()` on unauthenticated or failed-network boot.
- The 401 listener hard-resets synchronously before requesting boot.
- `logout()` hard-resets after the logout API succeeds, before boot.
- New `renderAssistantStatus()` builds a small labelled navigation/status region in
  `.workspace-bar`, installed by `renderShell()` and updated on status events. Its
  `[data-assistant-status]` node exposes `data-running-count`, one polite atomic
  live status for the count, and source/station return links. No response content is
  copied into this global live region. It is hidden when the count is zero.
- Focus restoration in `chat.js` requires a connected **and visible** composer.

Backend routes, CSRF headers, secret-sentinel handling and provider code are unchanged.

## Deterministic browser regression

Run inside LibreChat-Workspace, with installed Playwright Chromium:

```sh
PLAYWRIGHT_MODULE=/workspace/MCP-Station/node_modules/playwright/index.mjs \
  node scripts/test-chat-navigation.mjs
```

Alternatively install Playwright outside the application or resolve it normally;
`QA_BROWSER_EXECUTABLE` can point at a Chromium executable. No production keys or
state are used. The harness launches the actual Station server with isolated temp
modules/data and a whitelisted environment. A loopback Node HTTP provider writes
real OpenAI-protocol SSE chunks and gates completion on explicit test controls.
The browser uses the actual router, fetch reader and DOM, not a replacement reader
or a whole-body fulfilled SSE response. Browser requests outside the isolated
Station origin are blocked; assistant tools only edit a disposable local fixture.

The first scenario reproduces the original bug before using any new session APIs:
start a real delayed stream, click Integrations, finish upstream while away, click
Assistant, require the final delta. On base `2ee705e`, it failed with:

```text
FAIL route navigation cancelled live SSE: final-1 missing
```

Further checks cover module/editor/source/account switching, preserved unsent drafts,
independent concurrent sources, clickable global status and 2→1→0 counts, browser
history, explicit Stop, logout, 401 across active scopes, network-boot teardown,
draft staging without auto-submit, deduplicated/invalidation-fenced history loads,
failed-load retry, hidden-composer focus protection, real tool execution/status retained across detached hops, disk
refresh on editor return and gated serialized history PUTs. They also require zero
uncaught page errors/external browser calls and the unchanged assistant CSRF header.
The mock only speaks loopback; no paid provider request is made. Finally blocks
release test gates and clean up browsers, child server and temporary state.

## Verification on this branch

The final harness was also run against the five original lifecycle files from
`2ee705e` (restored immediately afterward): the exact route/SSE failure remained red.
With the fix, three consecutive full harness runs passed. Existing workflow checks
also passed: **102/102**, including **27 axe audits**. `npm run test:ui` checked all
22 frontend modules. No backend changes, commits, pushes or deployments were made.
