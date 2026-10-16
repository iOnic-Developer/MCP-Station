# Connecting AI Clients

**One integration. Multiple accounts. Your local and cloud AI clients.**

MCP Station exposes tools over streamable HTTP. Configure the integration once, then authorize
compatible clients for the account endpoint you want them to use. Local or cloud models need an
MCP-capable client to discover tools and execute calls; the model alone is not an MCP connection.

## Choose your client

| Client | Connection route | Requirements and availability |
| --- | --- | --- |
| ChatGPT | Custom MCP app through developer mode, where available | Public HTTPS endpoint; supported account/plan, workspace/admin policy, and app features. Follow OpenAI's current app setup. |
| Claude | Custom remote MCP connector | Reachable HTTPS endpoint and consent; plan, organization policy, and feature availability apply. |
| Claude Code | HTTP MCP server (`--transport http`) | Endpoint reachable from the CLI; authenticate using OAuth or configured bearer access. |
| LibreChat | `mcpServers` with `type: streamable-http` | Endpoint reachable from the LibreChat server; configured auth and a model/client setup that supports tools. Local and cloud models can be used through LibreChat. |
| Other MCP clients | Streamable HTTP plus supported auth | Verify that client's transport, authentication, and tool-feature support. |

These are protocol-based compatibility paths, **not an end-to-end validation of every client,
plan, or tool**, and do not imply provider endorsement. Tool listing and successful consent are
separate from a successful upstream tool call.

## Prepare the station

1. Configure the selected service account, inspect its tools, run Test, and enable deliberately.
2. Copy its canonical `https://your-station.example/<slug>/mcp` endpoint. Beta accounts each have
   their own URL; do not guess a sibling account's slug.
3. For cloud-hosted clients, set `PUBLIC_URL` to the exact public HTTPS origin (no path), set
   `COOKIE_SECURE=1`, and ensure the station is reachable without an intervening login wall.
   A cloud connector cannot reach your server's `localhost` or private LAN address directly.
4. Approve scoped OAuth consent, or use the endpoint-scoped bearer in clients supporting headers.
   Avoid the broad master `MCP_TOKEN` unless you intentionally need station-wide access.
5. Verify tool discovery, then make a small read-only call and check the selected account's result.

## ChatGPT: custom MCP apps

Follow OpenAI's [developer mode, apps, and full MCP connectors guide](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta).
Where the feature is available, enable developer mode, create a custom MCP app with the copied
HTTPS endpoint, complete its authentication flow, and select the app in a supported conversation.
If the option is missing, check account eligibility and workspace policy rather than assuming a
station error. Supported app actions and availability can change; this project does not claim a
verified ChatGPT end-to-end session or universal plan access.

## Claude: custom remote connectors

Use Claude's custom connector setup with the copied HTTPS account URL, then approve the station's
consent request. See [Connecting Claude](Connecting-Claude) for sign-in lifetimes, scopes, and
revocation, and the [official remote MCP connector guide](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp).
Custom remote connectors run through the provider's infrastructure, not your local model process.

## Claude Code: HTTP transport

```sh
claude mcp add --transport http station-siyuan https://your-station.example/siyuan/mcp
```

Use Claude Code's `/mcp` flow to authenticate where offered. For header-based clients, the station
also accepts `Authorization: Bearer <endpoint-scoped-token>`; keep real tokens out of shared command
history and configuration committed to Git. See the [official Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

## LibreChat: local and cloud model workflows

Merge this server entry into your existing `librechat.yaml`; it is not a complete LibreChat config:

```yaml
mcpServers:
  station-siyuan:
    type: streamable-http
    url: https://your-station.example/siyuan/mcp
    headers:
      Authorization: "Bearer ${MCP_STATION_SIYUAN_TOKEN}"
```

Set `MCP_STATION_SIYUAN_TOKEN` privately in the LibreChat server environment to the selected
endpoint's token. Do not store a real token in the YAML or repository. Reload/restart LibreChat as
required by your deployment, select the MCP server in a supported chat/agent, and test a read-only
tool. The LibreChat server needs network access to the URL; its `localhost` is not another
container's localhost. A connected server does not make every local model good at tool calling.

The `streamable-http` type, `headers`, and `${ENV_VAR}` interpolation follow
[LibreChat's official MCP server configuration](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers).
CLI and LibreChat syntax were checked against these primary docs on 2026-10-16; no live client
connection was exercised. Consult the linked provider pages for current eligibility and menus.

[Quick Start](Quick-Start) · [Configuration](Configuration) · [Accounts](Accounts) ·
[Troubleshooting](Troubleshooting)
