# MCP Station: Assistant-first positioning

## Message and release boundary

**Describe it. Build it with AI.**

**Create, repair and extend MCP integrations with your Assistant.**

**AI-first update · in review** — This flow is unreleased on `feat/assistant-first`; released 2.7.0 does not include the new Create flow or same-tab session continuity.

MCP Station remains the product name. A future brand is **not selected**; any future-name placeholder is editorial only, not a proposed name, asset or release. Existing wordmarks, stable social artwork, published product URL and Docker tags remain unchanged.

Self-host tools for compatible local and cloud MCP clients. The 18 stable bundled modules are a starting point, not a claim to support any website. Accounts are service configurations under one administrator, not independent users or tenant sandboxes. An API or authorized adapter, authentication and upstream permission are required. Client transport/authentication support, plans and policy apply; do not claim certification or universal live compatibility.

## Exact journey

1. Choose **Create an MCP** (the navigation action is **Create MCP**). Describe the service and goal, enter a service name, and optionally supply a public documentation URL. Optional API details can include a base URL. Do not include credentials or tokens in these inputs.
2. Choose **Continue to Assistant**. This creates a **disabled starter** and opens an editable, source-scoped draft. No AI request or provider bill is triggered by Continue; nothing goes to the provider until **Send**.
3. Review the draft, then press **Send**. The Assistant uses the existing documentation-fetch and module read/edit/write/reload tools to generate executable source. Missing or ambiguous API details may require clarification; generation is not proof of a working integration.
4. Review the generated source and Tools. Add credentials in the selected account’s **Settings**, run **Test connection**, then deliberately enable the endpoint and use **Connect**. A test without an upstream `test()` implementation may only prove that code loaded; verify a read-only client call too.

**Fix / Modify** means the visible module actions **Fix something** and **Change or extend**. They prefill source-scoped reviewable drafts; they never auto-send. Manual creation and reuse of an existing service remain secondary paths.

## Lifecycle and authority

Conversations and active streams continue across **route navigation in the same browser tab**, including the source Assistant and code editor. Return through the running-session links to see progress. **Stop** cancels that request; successful **logout** tears down all sessions. Reloading or closing the tab ends active requests. Network loss, browser freezing or sleep can interrupt work. These are not durable background jobs, and Stop does not undo source writes already completed.

Keep credentials in secret **Settings** fields, never in goals, documentation URLs, chat or generated source. Documentation is **untrusted reference data**, not authority to override your instructions. Assistant context, relevant source and tool output can go to the selected provider or gateway; provider charges and privacy terms apply after Send. Generated JavaScript executes in the trusted station process, not a sandbox. Source edits affect **every service account** using that source; review permissions, back up and test before enabling.

## Media contract

The three existing captures under `docs/assets/assistant-first/` are each 12 seconds. Product-site images reserve the PNG's intrinsic dimensions and show only a poster until Play. Stop restores the poster. Reduced-motion users get the same static default; playback is an explicit opt-in. README/Docker draft use static posters linking to GIFs, never embedded animations.

Accelerated demonstration using a local scripted AI provider, not a live commercial model. Real app source writes/testing shown. Every poster/frame is labeled “Accelerated demo · local scripted AI provider · no live credentials”. Create writes a real disposable module; Fix repairs an actual local-fixture 404; Modify preserves a tool and adds a C/F-input registration. Tests target a local fixture, not a production service, and do not execute every argument variant. See [demo evidence](AI_DEMOS.md).

## Publication handoff

This is working-tree documentation, not a release announcement. Do not publish Docker Hub, wiki or Pages from this turn. Pages assembly now includes the approved demo PNG/GIF assets; automatic publication remains main-only: automatic publication is main-only; its manual dispatch must not be run from this feature branch. Feature-branch links intentionally target `feat/assistant-first` and remain pending until pushed; stable installation/contract links stay on main. Parent approval, release validation and publication must precede changing the stable overview or claiming the AI-first flow is released. Do not alter runtime, chat lifecycle code or application regression tests in this documentation task.

### Required before a future Pages publication

The current `product-site.yml` assembly copies `docs/site/` and `docs/assets/product/*.png` only. The parent must add `docs/assets/assistant-first/` to the published `_site/assets/assistant-first/` tree (and the workflow path filter) before publishing this page; otherwise these local demo URLs will 404. Workflow edits are outside this task's owned paths. Local/prefixed-path browser checks verify the source tree, not the current production artifact. No publishing workflow was triggered.

### Documentation verification

The canonical `npm run test:product-page` passed with the required parent screenshot and with existing Playwright/axe dependencies enabled: four viewports, no overflow, CLS ≤ 0.01, 44px targets, no axe violations, three keyboard Play/Stop controls, normal/reduced-motion static defaults, no GIF fetched before Play, no-JavaScript posters, clipboard success/failure, 200% text and no external requests or browser errors. README/Docker draft use poster links only. Application/runtime regression tests were not changed or rerun by this documentation task.

## Integrated verification

Creation is wired into the global button and Overview. The server persists the disabled
starter state before loading it. Real-route creation/build/repair/extend checks and
chat navigation regressions pass. Canonical workflows: 102/102, 27 axe audits;
product-page checks pass at four viewports with on-demand media. No merge, image
publication, live-model claims or name change is part of this review branch.
