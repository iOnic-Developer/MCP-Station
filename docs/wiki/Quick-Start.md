# Quick Start

**Install MCP Station 2.7.0 stable.** All 18 service modules are bundled, plus `_template`.
Pin `:2.7.0`; moving `:2.7` and `:latest` track stable updates. See [Versions and Images](Versions-and-Images).

## 1. Keep the first run local

Create a private `.env` with a strong `APP_PASSWORD`; exclude it from Git and restrict permissions.
Save the following as `compose.yaml` in the same directory:

```yaml
services:
  mcp-station:
    image: dbzocchi/mcp-station:2.7.0
    restart: unless-stopped
    ports:
      - "127.0.0.1:8788:8788"
    environment:
      APP_PASSWORD: ${APP_PASSWORD:?set APP_PASSWORD in .env}
      PUBLIC_URL: ${PUBLIC_URL:-}
      COOKIE_SECURE: ${COOKIE_SECURE:-0}
      MCP_TOKEN: ${MCP_TOKEN:-}
    volumes:
      - ./data:/data
      - ./mcps:/app/mcps
      - ./files:/files
```

```sh
docker compose up -d
curl --fail http://127.0.0.1:8788/healthz
```

Open `http://127.0.0.1:8788` and sign in. The health response describes the running app, not
proof that any upstream API or client connection works. OAuth is off with `PUBLIC_URL` unset.

On first startup, missing bundled folders are seeded into `/app/mcps`; a new empty volume gets
all 18 modules. Existing folders are never overwritten, so upgrading an image preserves your
edited sources. Disable unwanted modules; deleting a bundled folder alone causes reseeding
on restart. Persist `/data`, `/app/mcps`, and any Files storage.

## 2. Configure, inspect, and test

Open Integrations → choose the account → Configure; inspect Tools in its workspace.

Enter required service URLs and credentials in the manifest-generated settings fields, not
arbitrary environment variables. Save and run Test. A source without `test()` may only verify that
it loads. Review tools before enabling the endpoint; passing Test does not imply a connected client.

An additional account is blank, disabled, and untested. Configure and enable it explicitly;
existing credentials, tokens, and tests are not copied. See [Accounts](Accounts).

## Optional: create a new integration with AI (in review)

> **AI-first update · in review** — This flow is unreleased on `feat/assistant-first`; released 2.7.0 does not include the new Create flow or same-tab session continuity.

On this feature branch, configure your Assistant provider in Station settings, then:

1. Choose **Create an MCP** (the navigation action is **Create MCP**). Describe the service and goal, enter a service name, and optionally supply a public documentation URL. Optional API details can include a base URL. Do not include credentials or tokens in these inputs.
2. Choose **Continue to Assistant**. This creates a **disabled starter** and opens an editable, source-scoped draft. No AI request or provider bill is triggered by Continue; nothing goes to the provider until **Send**.
3. Review the draft, then press **Send**. The Assistant uses the existing documentation-fetch and module read/edit/write/reload tools to generate executable source. Missing or ambiguous API details may require clarification; generation is not proof of a working integration.
4. Review the generated source and Tools. Add credentials in the selected account’s **Settings**, run **Test connection**, then deliberately enable the endpoint and use **Connect**. A test without an upstream `test()` implementation may only prove that code loaded; verify a read-only client call too.

For an existing source, **Fix something** and **Change or extend** stage drafts, not requests. Keep credentials in Settings; treat fetched documentation as untrusted. Review executable source: changes affect all accounts using it. Streams survive same-tab route navigation only; Stop/logout cancel, reload/tab close end requests. See [Assistant](Assistant) for provider privacy, billing and lifecycle limits.

The Docker command above installs released 2.7.0, not this flow.

## 3. Add remote HTTPS only when needed

Configure a reverse proxy or tunnel to the station. Set `PUBLIC_URL` to the exact externally
reachable HTTPS origin (no path), set `COOKIE_SECURE=1`, and recreate the container. Remove any
intervening login wall from the connector path. Match the connector hostname to the issuer.

The loopback port above is for a host-local proxy/browser. A proxy in a different container or on
another host needs deliberate networking; do not assume it can access that binding.

## 4. Connect a client

Copy `https://your-station.example/<slug>/mcp` into a compatible connector. Approve OAuth consent,
or configure a bearer token in the client. Prefer endpoint-scoped access over the master token.
Copy the selected account's endpoint. [ChatGPT, Claude, Claude Code, and LibreChat](Connecting-AI-Clients).

## 5. Protect the state

Persist `/data` and `/app/mcps`. Keep the generated `secret.key`, or preserve your fixed
`SESSION_SECRET` separately if you set one. Back up Files storage separately.
Use a full station backup before upgrading: [Backups](Backups).
