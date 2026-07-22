# Connecting Claude (and other clients)

MCP Station speaks MCP over streamable HTTP, with three ways to authenticate.

## claude.ai (web / mobile / desktop) — OAuth, permanent

**Settings → Connectors → Add custom connector** → `https://mcp.example.com/<module>/mcp`. A popup
shows the station's consent page; enter your `APP_PASSWORD` and approve (or **Deny**). The token is
scoped to that single module and refreshes automatically (1 h access token, rotating refresh) so the
connector stays live indefinitely.

- One connector per module URL. Add as many as you like.
- Revoke any connection from the module's 🔑 **Access** panel.
- The bare `/<module>` path (no `/mcp`) also works, for older connector URLs.

## Claude Code CLI — static bearer

```bash
claude mcp add --transport http siyuan https://mcp.example.com/siyuan/mcp \
  --header "Authorization: Bearer <MCP_TOKEN or per-module token>"
```

Use the station-wide `MCP_TOKEN` (opens every module) or a **per-module token** (from 🔑 Access —
opens only that one), so a script gets one endpoint without the keys to the whole station.

## Any other MCP client

Same URL, same `Authorization: Bearer <token>` header. If it speaks MCP streamable HTTP, it works.

## The three auth lanes, in order

1. **Station `MCP_TOKEN`** — master key, opens every MCP. For your own scripts / Claude Code.
2. **Per-module token** — opens only its module. Hand it out without exposing the rest.
3. **OAuth token** — what claude.ai gets. Scoped to the module you connected (via the RFC 8707
   `resource`); a token for `/siyuan` is refused at `/gemini_mcp` with a 403.

## Testing the whole flow without claude.ai

```bash
node scripts/claude-flow-sim.mjs https://mcp.example.com /siyuan/mcp '<APP_PASSWORD>'
# discovery → registration → PKCE → consent → token → initialize → tools/list → refresh
# FLOW OK — server + transport are healthy end to end
```

If a connector misbehaves, this tells you whether the server side is healthy before you blame
claude.ai or the network. See [Troubleshooting](Troubleshooting).
