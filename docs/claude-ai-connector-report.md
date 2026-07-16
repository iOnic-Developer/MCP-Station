# Custom connector fails after successful OAuth — evidence report

**Support references:** `ofid_7522a001898de256`, `ofid_d6cd747993eb851e`
**Date:** 2026-07-16 · **Reporter:** David (dbzocchi.app)

## Summary

A self-hosted MCP server completes the entire custom-connector OAuth flow with claude.ai —
discovery, dynamic client registration, authorize, consent, token exchange all succeed — and
claude.ai then makes **zero further HTTP requests** (no authenticated `initialize`, no failing
token call, no metadata re-fetch, nothing) and reports *"Authorization with the MCP server
failed."* A second MCP server on the **same machine, same Cloudflare zone, same reverse proxy**
(`https://sy.dbzocchi.app/mcp`, SiYuan Companion) connects and works.

Both servers run the **same MCP SDK version (1.29.0)** with the SDK's own `mcpAuthRouter` and
`requireBearerAuth` — the OAuth handlers are literally the same code.

## Complete server-side log of a failing attempt (all endpoints instrumented)

Attempt at 2026-07-16 11:39 UTC against `https://station.dbzocchi.app/siyuan`
(claude.ai backend user-agent: `python-httpx/0.28.1`):

```
11:39:17 [mcp]   POST /siyuan → 401 (auth=NONE, rpc=initialize)          ← pre-auth probe, correct WWW-Authenticate
11:39:17 [oauth] GET /.well-known/oauth-protected-resource/siyuan → 200
11:39:17 [oauth] GET /.well-known/oauth-authorization-server → 200
11:39:18 [oauth] DCR: registered 'Claude' (603adb25-…)
11:39:18 [oauth] POST /register → 201
11:39:18 [oauth] GET /authorize → 200 client=603adb25-…                  ← consent page rendered
11:39:23 [oauth] Authorization approved for client 603adb25-…            ← user entered password
11:39:24 [oauth] /token ISSUED for client 603adb25-… → /siyuan
11:39:24 [oauth] POST /token → 200 grant=authorization_code client=603adb25-…
        — no further requests of any kind —
```

The token response: `{"access_token":"<64-char hex>","token_type":"bearer","expires_in":3600,
"scope":"siyuan","refresh_token":"<64-char hex>"}` with `Cache-Control: no-store` — issued by the
MCP SDK's own `tokenHandler`.

## What has been ruled out (all verified)

1. **Server code / OAuth conformance** — the failing server runs the MCP SDK's own auth router;
   a faithful scripted re-enactment of claude.ai's flow (discovery → DCR → PKCE S256 → consent →
   form-encoded token exchange with `resource` → authenticated `initialize` → `tools/list` →
   refresh rotation) passes end-to-end against the same deployment: 200s throughout, 19 tools.
2. **Byte-level response differences** — field-by-field diff of both servers' live discovery
   surfaces (AS metadata, protected-resource metadata, DCR response, 401 challenge, token
   response shape) shows them identical after normalizing host/path strings: same issuer format
   (trailing slash), same grant types, same auth methods, same token shape (hex values, 1h expiry,
   `bearer`), same `Cache-Control`, matching scope semantics, ASCII-only metadata.
3. **Transport / proxy / WAF** — authenticated POSTs (garbage bearer) traverse Cloudflare to both
   origins identically. The pre-auth `initialize` from claude.ai's own backend demonstrably
   reaches the failing origin (logged 401 above).
4. **claude.ai-side per-hostname state** — the failure reproduces identically on a **fresh
   subdomain** (`station.dbzocchi.app`) claude.ai had never seen, with a fresh OAuth store and a
   freshly registered client.
5. **Stale client/registration state** — the attempt above is a clean first-time registration on
   a fresh deployment.

## The question for the connector team

Given a `200` token response, what causes the connector backend to abort **without issuing any
further HTTP request**? The two `ofid` references above correspond to these failing attempts —
their internal traces should show the specific validation that rejects the completed
authorization. Whatever it checks, it is not observable in any request the backend sends to the
server, and an identically-shaped flow from a sibling host connects fine.

## Environment

- Failing: `https://station.dbzocchi.app/siyuan` (MCP Station v1.4.16+, Node 22, Express 4.22.2,
  @modelcontextprotocol/sdk 1.29.0, stateless Streamable HTTP, `enableJsonResponse: true`)
- Working: `https://sy.dbzocchi.app/mcp` (SiYuan Companion, same SDK/Express, same pattern)
- Both: same physical host, same reverse proxy, same Cloudflare zone, both proxied (orange cloud)
