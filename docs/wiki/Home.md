# MCP Station documentation

**Turn your APIs and services into MCP tools.**

**One integration. Multiple accounts. Your local and cloud AI clients.**

Self-host the bridge between your services and ChatGPT, Claude, Claude Code, LibreChat, and other
compatible MCP clients. Build from API docs, reuse source across accounts, and manage tool access
in one workspace. Local and cloud models connect through an MCP-capable client, not on their own.
The upcoming source includes 18 integrations; websites without APIs need authorized adapters.

> **Channel guide:** **stable 2.4.0** is `main` / Docker `latest`. **Published beta `2.7.0_beta`**
> was built from `7945275` and reports `2.6.0-beta` internally. **Branch preview** means later
> `redesign/public-product` work, not a claim that every screen is in that image.
> These guides are published from the review branch and label stable, image-beta and upcoming-source behavior separately.

## Start here

| Task | Guide |
| --- | --- |
| Run a private local station | [Quick Start](Quick-Start) |
| Choose stable or beta | [Versions and Images](Versions-and-Images) |
| Set volumes, HTTPS, keys, and providers | [Configuration](Configuration) |
| Connect a client | [Connecting AI Clients](Connecting-AI-Clients) |
| Configure another service account (beta) | [Accounts](Accounts) |
| Understand activity (beta) | [Usage](Usage) |
| Build with AI assistance | [Assistant](Assistant) |
| Recover or share safely | [Backups](Backups) |

## Modules and operations

[Bundled Modules](Bundled-Modules) · [Building a Module](Building-a-Module) ·
[Use Cases](Use-Cases) · [Troubleshooting](Troubleshooting) · [FAQ](FAQ)

## Boundaries worth reading first

One administrator controls all service accounts. Module JavaScript runs as trusted in-process
code, not in a tenant sandbox. Secret fields are encrypted at rest, but service calls are outbound
and Assistant context/source is sent to the selected provider. Use full backups for beta accounts;
portable JSON is default-account only. No built-in job scheduler or module marketplace is promised.

[Repository](https://github.com/iOnic-Developer/MCP-Station) ·
[Review branch](https://github.com/iOnic-Developer/MCP-Station/tree/redesign/public-product) ·
[Docker Hub](https://hub.docker.com/r/dbzocchi/mcp-station)
