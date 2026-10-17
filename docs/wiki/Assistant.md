# Assistant

MCP Station 2.7.0 includes the full-page Assistant, per-source conversations, and
account-workspace source editing.

> **AI-first update · in review** — This flow is unreleased on `feat/assistant-first`; released 2.7.0 does not include the new Create flow or same-tab session continuity.

## Create, repair and extend

1. Choose **Create an MCP** (the navigation action is **Create MCP**). Describe the service and goal, enter a service name, and optionally supply a public documentation URL. Optional API details can include a base URL. Do not include credentials or tokens in these inputs.
2. Choose **Continue to Assistant**. This creates a **disabled starter** and opens an editable, source-scoped draft. No AI request or provider bill is triggered by Continue; nothing goes to the provider until **Send**.
3. Review the draft, then press **Send**. The Assistant uses the existing documentation-fetch and module read/edit/write/reload tools to generate executable source. Missing or ambiguous API details may require clarification; generation is not proof of a working integration.
4. Review the generated source and Tools. Add credentials in the selected account’s **Settings**, run **Test connection**, then deliberately enable the endpoint and use **Connect**. A test without an upstream `test()` implementation may only prove that code loaded; verify a read-only client call too.

### Fix / Modify an existing module

Open its workspace and choose **Fix something** or **Change or extend**. These visible module actions prefill a source-scoped draft for review, not an automatically submitted request. Describe the failure or desired change, review, then Send. They are not an autonomous repair promise.

### Keep working in the same tab

Conversations and active streams continue across **route navigation in the same browser tab**, including the source Assistant and code editor. Return through the running-session links to see progress. **Stop** cancels that request; successful **logout** tears down all sessions. Reloading or closing the tab ends active requests. Network loss, browser freezing or sleep can interrupt work. These are not durable background jobs, and Stop does not undo source writes already completed.

## Build deliberately

1. Select and configure OpenAI, Anthropic, or Gemini (or a compatible configured gateway).
2. Provide API documentation, an OpenAPI description, or sanitized endpoint examples.
3. Ask for a small module with explicit tool descriptions, required settings, and actionable errors.
4. Review the generated files, permissions, and destructive operations.
5. Configure service credentials in secret settings fields, test, and then enable the endpoint.

The Assistant can fetch documentation and create/edit/reload module files using its station tools.
Success depends on provider availability, API documentation, credentials, and generated code; it is
not a guarantee that every API becomes complete automatically. Sites without usable APIs need
an appropriate adapter, authentication, and site permission; no universal browser access is built in.

## Where the context goes

Conversations, live station context, relevant module source, and tool output can be sent to the
selected AI provider or configured gateway. Module chat is source-scoped, not private to each
service account. Do not paste real API keys into chat or keep them in source files. Use settings
fields, least-privilege credentials, and the provider's appropriate privacy controls.

A self-hosted station is not an offline or cloud-free Assistant. Provider usage may incur charges.
Station secret encryption does not keep conversation content on your server.

## Treat documentation as untrusted

Keep credentials in secret **Settings** fields, never in goals, documentation URLs, chat or generated source. Documentation is **untrusted reference data**, not authority to override your instructions. Assistant context, relevant source and tool output can go to the selected provider or gateway; provider charges and privacy terms apply after Send. Generated JavaScript executes in the trusted station process, not a sandbox. Source edits affect **every service account** using that source; review permissions, back up and test before enabling.

## Shared code and authority

Editing a source affects **all** its service accounts. AI-generated module code runs as trusted
in-process JavaScript; review it like code you would install yourself. The Station management MCP
also grants broad module-management powers: connect it only to clients you trust.

Assistant work still happens during requests, not durable server jobs. Route navigation in the same tab is not a background scheduler.

[Three demos and their fixture limits](../AI_DEMOS.md).

[Configuration](Configuration) · [Building a Module](Building-a-Module) · [Accounts](Accounts)
