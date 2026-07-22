# MCP Station Wiki

**Turn any API into an MCP server that claude.ai can use — self-hosted, in one container.**

New here? Start with the [README](https://github.com/iOnic-Developer/MCP-Station#readme). This wiki
is the deeper reference.

## Pages

- **[Use Cases & Recipes](Use-Cases)** — what people actually do with it, with concrete examples.
- **[Quick Start](Quick-Start)** — the shortest path to a running station + first connector.
- **[Building a Module](Building-a-Module)** — the module contract, by hand or via the ✦ assistant.
- **[Connecting Claude](Connecting-Claude)** — claude.ai, Claude Code, and other MCP clients.
- **[Cloudflare](https://github.com/iOnic-Developer/MCP-Station/blob/main/docs/CLOUDFLARE.md)** —
  tunnels, the AI-bot gotcha, Station vs Workers-hosted MCPs.
- **[Troubleshooting](Troubleshooting)** — when a connector won't connect.
- **[FAQ](FAQ)** — the questions people ask first.
- **[Roadmap](https://github.com/iOnic-Developer/MCP-Station/blob/main/docs/ROADMAP.md)** — where it's going.

## The one-paragraph pitch

Every service you use has an API; almost none ship an MCP, and the few that do only expose what the
vendor built. MCP Station hosts each folder in `mcps/` as a remote MCP endpoint with OAuth 2.1 so
claude.ai connects by URL alone. Describe an API to the built-in assistant — or paste its docs — and
it writes the module; toggle it on and Claude can call it thirty seconds later. Your keys and data
never leave your box.
