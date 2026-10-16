# Connecting Claude

For ChatGPT, Claude Code, LibreChat, and the client matrix, see [Connecting AI Clients](Connecting-AI-Clients).

Each service account has its own endpoint in MCP Station 2.7.0.
MCP Station serves stateless streamable HTTP; client compatibility, connector menus, and access
availability depend on the client. This is not a provider endorsement.

## OAuth connector

Use the client's custom remote connector flow and paste the copied HTTPS endpoint, for example
`https://your-station.example/siyuan/mcp`. The station provides discovery, registration, PKCE,
and password-gated approval. Verify the requested scope, choose a sign-in lifetime, and approve
or deny. Revoke a connection through the selected account's Connect workspace.

`PUBLIC_URL` must match that public origin, and the endpoint must be reachable without another
login wall. A hostname change requires configuration changes and often reconnection.

| Lifetime | Meaning |
| --- | --- |
| Unlimited | No configured sign-in expiry; access can still end through revocation, lost state, credential changes, or client/provider behavior. |
| 1 day / 1 week / 1 month | Fixed sign-in lifetime; refreshing does not extend that deadline. |

Do not describe an unlimited token as a guarantee that a third-party connection never fails.

## Bearer clients and scripts

Configure the same endpoint with `Authorization: Bearer <token>` using your client's secret
storage. Prefer its module/account token. `MCP_TOKEN` is optional and grants station-wide access.
Do not paste real tokens into shared shell history, screenshots, issues, or example commands.

For Claude Code, a command shape is:

```sh
claude mcp add --transport http siyuan https://your-station.example/siyuan/mcp   --header "Authorization: Bearer <endpoint-scoped-token>"
```

This is a syntax example, not a real credential or an instruction to expose one. Confirm your
installed client's help and use its protected credential mechanism where available.

## Scope and account selection

New scoped OAuth grants and per-account tokens are bound to the selected endpoint. A token for
one service account cannot be used at its sibling endpoint. The master bearer and legacy unscoped
OAuth grants remain intentionally broader. Copy the account URL instead of editing slugs by hand.
The legacy bare `/<slug>` endpoint remains an alias; prefer canonical `/<slug>/mcp`.

[Accounts](Accounts) · [Troubleshooting](Troubleshooting)
