# MCP Station documentation

**Describe it. Build it with AI.**

**Create, repair and extend MCP integrations with your Assistant.**

Self-host the bridge between your services and ChatGPT, Claude, Claude Code, LibreChat, and other
compatible MCP clients. Build from API docs, reuse source across accounts, and manage tool access
in one workspace. Local and cloud models connect through an MCP-capable client, not on their own.
The 2.7.0 release includes 18 integrations; websites without APIs need authorized adapters.

> **MCP Station 2.7.0 stable:** 18 modules, account-aware workspaces, Connections, Usage,
> Assistant, and PWA support. Pin `:2.7.0`; `:latest` and `:2.7` follow stable updates.

> **AI-first update · in review** — This flow is unreleased on `feat/assistant-first`; released 2.7.0 does not include the new Create flow or same-tab session continuity.

## From a goal to tools

**Create an MCP → goal + name + optional docs → Continue to Assistant → review draft → Send → review source → Settings → test → enable → Connect.** Continue creates a disabled starter without calling AI; only Send starts provider usage. Module **Fix something** / **Change or extend** actions also stage drafts for review.

Conversations and active streams continue across **route navigation in the same browser tab**, including the source Assistant and code editor. Return through the running-session links to see progress. **Stop** cancels that request; successful **logout** tears down all sessions. Reloading or closing the tab ends active requests. Network loss, browser freezing or sleep can interrupt work. These are not durable background jobs, and Stop does not undo source writes already completed.

Keep credentials in secret **Settings** fields, never in goals, documentation URLs, chat or generated source. Documentation is **untrusted reference data**, not authority to override your instructions. Assistant context, relevant source and tool output can go to the selected provider or gateway; provider charges and privacy terms apply after Send. Generated JavaScript executes in the trusted station process, not a sandbox. Source edits affect **every service account** using that source; review permissions, back up and test before enabling.

[Assistant walkthrough](Assistant) · [Three demos and evidence](../AI_DEMOS.md)

## Start here

| Task | Guide |
| --- | --- |
| Run a private local station | [Quick Start](Quick-Start) |
| Choose image tags | [Versions and Images](Versions-and-Images) |
| Set volumes, HTTPS, keys, and providers | [Configuration](Configuration) |
| Connect a client | [Connecting AI Clients](Connecting-AI-Clients) |
| Configure another service account | [Accounts](Accounts) |
| Understand activity | [Usage](Usage) |
| Build with AI assistance | [Assistant](Assistant) |
| Recover or share safely | [Backups](Backups) |

## Modules and operations

[Bundled Modules](Bundled-Modules) · [Building a Module](Building-a-Module) ·
[Use Cases](Use-Cases) · [Troubleshooting](Troubleshooting) · [FAQ](FAQ)

## Boundaries worth reading first

One administrator controls all service accounts. Module JavaScript runs as trusted in-process
code, not in a tenant sandbox. Secret fields are encrypted at rest, but service calls are outbound
and Assistant context/source is sent to the selected provider. Use full backups for additional accounts;
portable JSON is default-account only. No built-in job scheduler or module marketplace is promised.

[Repository](https://github.com/iOnic-Developer/MCP-Station) ·
[Source](https://github.com/iOnic-Developer/MCP-Station/tree/main) ·
[Docker Hub](https://hub.docker.com/r/dbzocchi/mcp-station)
