# Quick Start

**Stable 2.4.0 first.** The account-aware workflow below is labeled beta where it differs.
Use separate volumes when evaluating `2.7.0_beta`; see [Versions and Images](Versions-and-Images).
The expanded 18-module bundle belongs to upcoming source, not this stable image or the published
`2.7.0_beta` image. Choose the source/image channel before expecting those integrations.

## 1. Keep the first run local

Create a private `.env` with a strong `APP_PASSWORD`; exclude it from Git and restrict permissions.
Save the following as `compose.yaml` in the same directory:

```yaml
services:
  mcp-station:
    image: dbzocchi/mcp-station:2.4.0
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

## 2. Configure, inspect, and test

**Stable:** use the module settings and capabilities controls.
**Beta/branch:** open Integrations → choose the account → Configure; inspect Tools in its workspace.

Enter required service URLs and credentials in the manifest-generated settings fields, not
arbitrary environment variables. Save and run Test. A source without `test()` may only verify that
it loads. Review tools before enabling the endpoint; passing Test does not imply a connected client.

**Beta:** an additional account is blank, disabled, and untested. Configure and enable it explicitly;
existing credentials, tokens, and tests are not copied. See [Accounts](Accounts).

## 3. Add remote HTTPS only when needed

Configure a reverse proxy or tunnel to the station. Set `PUBLIC_URL` to the exact externally
reachable HTTPS origin (no path), set `COOKIE_SECURE=1`, and recreate the container. Remove any
intervening login wall from the connector path. Match the connector hostname to the issuer.

The loopback port above is for a host-local proxy/browser. A proxy in a different container or on
another host needs deliberate networking; do not assume it can access that binding.

## 4. Connect a client

Copy `https://your-station.example/<slug>/mcp` into a compatible connector. Approve OAuth consent,
or configure a bearer token in the client. Prefer endpoint-scoped access over the master token.
In beta, copy the selected account's endpoint. [ChatGPT, Claude, Claude Code, and LibreChat](Connecting-AI-Clients).

## 5. Protect the state

Persist `/data` and `/app/mcps`. Keep the generated `secret.key`, or preserve your fixed
`SESSION_SECRET` separately if you set one. Back up Files storage separately.
Use a full station backup before upgrading: [Backups](Backups).
