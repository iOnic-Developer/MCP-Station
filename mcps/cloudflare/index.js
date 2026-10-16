import { configurationError, guardedServer } from "./bundle.js";
import crypto from "node:crypto";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

function cleanString(str) {
  if (!str || typeof str !== "string") return "";
  return str.trim().replace(/^["']|["']$/g, "");
}

function cleanHostname(host) {
  if (!host) return "";
  return host.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

function cleanDomain(domain) {
  if (!domain) return "";
  return domain.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function cleanService(svc) {
  if (!svc) return "";
  const s = svc.trim();
  if (
    s.startsWith("http_status:") ||
    s.startsWith("tcp://") ||
    s.startsWith("ssh://") ||
    s.startsWith("rdp://") ||
    s.startsWith("unix:") ||
    s.startsWith("smb://")
  ) {
    return s;
  }
  if (!s.startsWith("http://") && !s.startsWith("https://")) {
    return `http://${s}`;
  }
  return s;
}

// MCP requires `structuredContent` to be a JSON object. Cloudflare list
// endpoints return bare arrays (and some DELETEs return null), which the
// client rejects with "expected record, received array". Always go
// through this so every tool returns a record.
function asRecord(value, listKey = "items") {
  if (Array.isArray(value)) return { [listKey]: value, count: value.length };
  if (value === null || value === undefined) return { ok: true };
  if (typeof value === "object") return value;
  return { value };
}

async function cfRequest({ path, method = "GET", body = null, token }) {
  const url = `${CF_API_BASE}${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  const options = {
    method,
    headers,
    signal: AbortSignal.timeout(30000)
  };

  if (body !== null && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, options);
  } catch (netErr) {
    if (netErr.name === "TimeoutError") {
      throw new Error(`Cloudflare API request timed out after 30 seconds: ${method} ${path}`);
    }
    throw new Error(`Network error calling Cloudflare API: ${netErr.message}`);
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Cloudflare HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  if (!res.ok || json.success === false) {
    const errMessages = (json.errors || [])
      .map((e) => `[code ${e.code || "unknown"}]: ${e.message}`)
      .join(", ") || json.messages?.join(", ") || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API Error: ${errMessages}`);
  }

  return json.result;
}

function getAuth(getSettings) {
  const settings = (typeof getSettings === "function" ? getSettings() : getSettings) || {};
  const token = cleanString(settings.api_token);
  const accountId = cleanString(settings.account_id);
  const defaultZoneId = cleanString(settings.default_zone_id) || null;

  if (!token) {
    throw new Error("Missing 'api_token'. Please configure it in MCP Station -> Cloudflare -> Settings.");
  }
  if (!accountId) {
    throw new Error("Missing 'account_id'. Please configure it in MCP Station -> Cloudflare -> Settings.");
  }
  return { token, accountId, defaultZoneId };
}

async function resolveZoneId({ hostname, zoneId, defaultZoneId, token, accountId }) {
  if (zoneId && zoneId.trim()) return zoneId.trim();
  if (defaultZoneId && defaultZoneId.trim()) return defaultZoneId.trim();

  // Deduce root domain candidates from hostname (e.g., 'sub.example.com' -> check 'example.com')
  const host = cleanHostname(hostname);
  const parts = host.split(".");
  if (parts.length >= 2) {
    for (let i = 0; i < parts.length - 1; i++) {
      const candidate = parts.slice(i).join(".");
      try {
        const zones = await cfRequest({
          path: `/zones?account.id=${accountId}&name=${encodeURIComponent(candidate)}`,
          token
        });
        if (zones && zones.length > 0) {
          return zones[0].id;
        }
      } catch {
        // try next candidate
      }
    }
  }

  throw new Error(`Unable to determine Cloudflare Zone ID for hostname '${hostname}'. Please specify 'zone_id' or configure 'default_zone_id' in Cloudflare Settings.`);
}

export function register({ server, z, getSettings, log }) {
  server = guardedServer(server, "cloudflare", getSettings, []);
  // -------------------------------------------------------------
  // TUNNELS
  // -------------------------------------------------------------

  server.registerTool(
    "cf_tunnel_list",
    {
      title: "List Cloudflare Tunnels",
      description: "List all Cloudflare Tunnels in the account.\n\nArgs: name (optional filter), is_deleted (boolean, default false).\nReturns: List of tunnels with id, name, status, created_at, and active connections count.",
      inputSchema: {
        name: z.string().optional().describe("Filter tunnels by name"),
        is_deleted: z.boolean().default(false).describe("Include deleted tunnels")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ name, is_deleted }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const params = new URLSearchParams();
        if (is_deleted) {
          params.set("is_deleted", "true");
        } else {
          params.set("is_deleted", "false");
        }
        if (name && name.trim()) {
          params.set("name", name.trim());
        }

        const result = await cfRequest({
          path: `/accounts/${accountId}/cfd_tunnel?${params.toString()}`,
          token
        });

        const tunnels = (result || []).map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          conns_active_at: t.conns_active_at,
          active_connections: t.connections?.length || 0,
          created_at: t.created_at,
          remote_config: t.config_src === "cloudflare"
        }));

        const text = tunnels.length === 0
          ? "No tunnels found."
          : `Found ${tunnels.length} tunnel(s):\n\n` +
            tunnels.map((t) => `- **${t.name}** (\`${t.id}\`): Status: **${t.status}** | Remote config: ${t.remote_config} | Active conns: ${t.active_connections}`).join("\n");

        return { content: [{ type: "text", text }], structuredContent: asRecord(tunnels, "tunnels") };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_tunnel_get",
    {
      title: "Get Cloudflare Tunnel",
      description: "Get detailed information about a specific Cloudflare Tunnel.\n\nArgs: tunnel_id (string).\nReturns: Complete tunnel details including connectors, metadata, and status.",
      inputSchema: {
        tunnel_id: z.string().describe("The UUID of the tunnel")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ tunnel_id }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const result = await cfRequest({
          path: `/accounts/${accountId}/cfd_tunnel/${encodeURIComponent(tunnel_id.trim())}`,
          token
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: asRecord(result)
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_tunnel_create",
    {
      title: "Create Cloudflare Tunnel",
      description: "Create a new Cloudflare Tunnel configured for remote management via Cloudflare Dashboard / API.\n\nArgs: name (string, required), tunnel_secret (optional base64 32-byte secret; auto-generated if omitted).\nReturns: The created tunnel details including id and tunnel token.",
      inputSchema: {
        name: z.string().min(1).describe("Name of the tunnel"),
        tunnel_secret: z.string().optional().describe("Optional 32-byte base64 secret. If omitted, a secure secret is auto-generated.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ name, tunnel_secret }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const secret = tunnel_secret ? tunnel_secret.trim() : crypto.randomBytes(32).toString("base64");

        const result = await cfRequest({
          path: `/accounts/${accountId}/cfd_tunnel`,
          method: "POST",
          body: {
            name: name.trim(),
            tunnel_secret: secret,
            config_src: "cloudflare"
          },
          token
        });

        let runToken = "";
        try {
          runToken = await cfRequest({
            path: `/accounts/${accountId}/cfd_tunnel/${result.id}/token`,
            token
          });
        } catch {
          // run token endpoint may format token from id + secret + account
        }

        const msg = [
          `Successfully created tunnel **${result.name}**!`,
          `- **Tunnel ID**: \`${result.id}\``,
          `- **Created at**: ${result.created_at}`,
          runToken ? `- **Run Token**: \`${runToken}\`\n\nRun with docker:\n\`\`\`bash\ndocker run -d --name cloudflared cloudflare/cloudflared:latest tunnel --no-autoupdate run --token ${runToken}\n\`\`\`` : ""
        ].filter(Boolean).join("\n");

        return { content: [{ type: "text", text: msg }], structuredContent: { ...result, run_token: runToken } };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_tunnel_delete",
    {
      title: "Delete Cloudflare Tunnel",
      description: "Delete an existing Cloudflare Tunnel.\n\nArgs: tunnel_id (string), cascade (boolean, optional - cleans up connections).\nReturns: Deletion confirmation.",
      inputSchema: {
        tunnel_id: z.string().describe("The UUID of the tunnel to delete"),
        cascade: z.boolean().default(true).describe("Cascade deletion of active connections")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ tunnel_id, cascade }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const tid = tunnel_id.trim();
        if (cascade) {
          try {
            await cfRequest({
              path: `/accounts/${accountId}/cfd_tunnel/${encodeURIComponent(tid)}/connections`,
              method: "DELETE",
              token
            });
          } catch {
            // ignore if no connections
          }
        }

        const result = await cfRequest({
          path: `/accounts/${accountId}/cfd_tunnel/${encodeURIComponent(tid)}`,
          method: "DELETE",
          token
        });

        return {
          content: [{ type: "text", text: `Tunnel ${tid} successfully deleted.` }],
          structuredContent: asRecord(result)
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_tunnel_get_token",
    {
      title: "Get Tunnel Run Token",
      description: "Get the authentication run token for a tunnel. Used to run `cloudflared` or docker containers.\n\nArgs: tunnel_id (string).\nReturns: Base64 token string and docker command snippet.",
      inputSchema: {
        tunnel_id: z.string().describe("The UUID of the tunnel")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ tunnel_id }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const tid = tunnel_id.trim();
        const runToken = await cfRequest({
          path: `/accounts/${accountId}/cfd_tunnel/${encodeURIComponent(tid)}/token`,
          token
        });

        const text = `**Tunnel Token** for \`${tid}\`:\n\n\`${runToken}\`\n\nRun command:\n\`\`\`bash\ncloudflared tunnel run --token ${runToken}\n\`\`\`\n\nDocker:\n\`\`\`bash\ndocker run -d --restart=unless-stopped --name cloudflared cloudflare/cloudflared:latest tunnel --no-autoupdate run --token ${runToken}\n\`\`\``;

        return { content: [{ type: "text", text }], structuredContent: { tunnel_id: tid, token: runToken } };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_tunnel_get_config",
    {
      title: "Get Tunnel Configuration",
      description: "Get the remotely managed configuration (ingress rules, originRequest settings, warp routing) of a Cloudflare Tunnel.\n\nArgs: tunnel_id (string).\nReturns: Ingress rules and WARP routing configuration.",
      inputSchema: {
        tunnel_id: z.string().describe("The UUID of the tunnel")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ tunnel_id }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const tid = tunnel_id.trim();
        const result = await cfRequest({
          path: `/accounts/${accountId}/cfd_tunnel/${encodeURIComponent(tid)}/configurations`,
          token
        });

        const ingress = result?.config?.ingress || [];
        const ingressSummary = ingress.map((rule, idx) => {
          const host = rule.hostname ? `\`${rule.hostname}\`` : "*(catch-all)*";
          const path = rule.path ? ` path: \`${rule.path}\`` : "";
          return `${idx + 1}. ${host}${path} -> \`${rule.service}\``;
        }).join("\n");

        const text = `### Tunnel Configuration for \`${tid}\`\n\n` +
          `**Ingress Rules**:\n${ingressSummary || "No ingress rules defined."}\n\n` +
          `**WARP Routing**: ${result?.config?.["warp-routing"]?.enabled ? "Enabled" : "Disabled"}\n\n` +
          `\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;

        return { content: [{ type: "text", text }], structuredContent: asRecord(result) };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_tunnel_update_config",
    {
      title: "Update Tunnel Configuration",
      description: "Update the complete remotely-managed ingress configuration for a Cloudflare Tunnel.\n\nArgs: tunnel_id (string), ingress_rules (array of { hostname?, path?, service, originRequest? }) OR raw_config (JSON string). NOTE: Cloudflare requires the final ingress rule to be a catch-all (no hostname, e.g. service: 'http_status:404'). If not provided, it will be automatically appended. To add/update a single rule without overwriting others, prefer 'cf_tunnel_add_ingress_rule'.\nReturns: Updated configuration result.",
      inputSchema: {
        tunnel_id: z.string().describe("The UUID of the tunnel"),
        ingress_rules: z.array(
          z.object({
            hostname: z.string().optional().describe("Hostname to route, e.g. 'app.example.com'"),
            path: z.string().optional().describe("Path prefix to route, e.g. '/api'"),
            service: z.string().describe("Backend destination URL, e.g. 'http://example.com:3000' or 'http_status:404'"),
            originRequest: z.object({
              noTLSVerify: z.boolean().optional().describe("Disable TLS verification to origin"),
              httpHostHeader: z.string().optional().describe("Override HTTP Host header"),
              originServerName: z.string().optional().describe("Hostname on origin TLS certificate"),
              connectTimeout: z.number().optional().describe("Timeout for establishing connection (seconds)"),
              tlsTimeout: z.number().optional().describe("Timeout for completing TLS handshake (seconds)"),
              tcpKeepAlive: z.number().optional().describe("Keep-alive period for TCP connection (seconds)"),
              keepAliveConnections: z.number().optional().describe("Maximum number of idle keepalive connections"),
              keepAliveTimeout: z.number().optional().describe("Timeout for idle keepalive connections (seconds)"),
              disableChunkedEncoding: z.boolean().optional().describe("Disable chunked transfer encoding")
            }).optional().describe("Optional origin request settings (e.g. noTLSVerify: true)")
          })
        ).optional().describe("List of ingress rules. The 404 catch-all will be appended if omitted."),
        warp_routing_enabled: z.boolean().optional().describe("Enable or disable WARP private network routing"),
        raw_config: z.string().optional().describe("Alternative: provide full config JSON string matching Cloudflare schema")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ tunnel_id, ingress_rules, warp_routing_enabled, raw_config }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const tid = tunnel_id.trim();
        let configPayload;

        if (raw_config) {
          try {
            configPayload = JSON.parse(raw_config);
          } catch (e) {
            throw new Error(`Invalid JSON in raw_config: ${e.message}`);
          }
        } else if (ingress_rules) {
          const rules = ingress_rules.map((r) => ({
            ...(r.hostname ? { hostname: cleanHostname(r.hostname) } : {}),
            ...(r.path && r.path.trim() ? { path: r.path.trim() } : {}),
            service: cleanService(r.service),
            ...(r.originRequest ? { originRequest: r.originRequest } : {})
          }));

          const hasCatchAll = rules.length > 0 && !rules[rules.length - 1].hostname;
          if (!hasCatchAll) {
            rules.push({ service: "http_status:404" });
          }
          configPayload = {
            config: {
              ingress: rules,
              ...(warp_routing_enabled !== undefined ? { "warp-routing": { enabled: warp_routing_enabled } } : {})
            }
          };
        } else {
          throw new Error("Either 'ingress_rules' or 'raw_config' must be provided.");
        }

        const result = await cfRequest({
          path: `/accounts/${accountId}/cfd_tunnel/${encodeURIComponent(tid)}/configurations`,
          method: "PUT",
          body: configPayload,
          token
        });

        return {
          content: [{ type: "text", text: `Successfully updated tunnel \`${tid}\` configuration!\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`` }],
          structuredContent: asRecord(result)
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_tunnel_add_ingress_rule",
    {
      title: "Add Ingress Rule to Tunnel",
      description: "Safely add or update a single ingress rule on a Cloudflare Tunnel without overwriting other existing rules. Preserves the 404 catch-all, and can optionally create the DNS CNAME record in the same step.\n\nArgs: tunnel_id (string), hostname (e.g. 'app.example.com'), service (backend URL e.g. 'http://example.com:3000'), path (optional), no_tls_verify (boolean optional), create_dns_cname (boolean, default false), zone_id (optional, auto-detected if omitted).\nReturns: Updated ingress rule list and optional DNS status.",
      inputSchema: {
        tunnel_id: z.string().describe("The UUID of the Cloudflare Tunnel"),
        hostname: z.string().describe("Public hostname, e.g. 'grafana.example.com'"),
        service: z.string().describe("Internal destination URL, e.g. 'http://<server-host>:3000' or 'http://example.com:3000'"),
        path: z.string().optional().describe("Optional URL path prefix, e.g. '/api'"),
        no_tls_verify: z.boolean().optional().describe("Set true if origin service uses a self-signed HTTPS certificate"),
        create_dns_cname: z.boolean().default(false).describe("Also create or update the DNS CNAME record pointing hostname -> tunnel"),
        zone_id: z.string().optional().describe("Optional Cloudflare Zone ID (automatically detected from hostname if omitted)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ tunnel_id, hostname, service, path, no_tls_verify, create_dns_cname, zone_id }) => {
      try {
        const { token, accountId, defaultZoneId } = getAuth(getSettings);
        const tid = tunnel_id.trim();
        const host = cleanHostname(hostname);
        const svc = cleanService(service);

        // 1. Fetch current tunnel config
        let currentConfig;
        try {
          currentConfig = await cfRequest({
            path: `/accounts/${accountId}/cfd_tunnel/${encodeURIComponent(tid)}/configurations`,
            token
          });
        } catch (fetchErr) {
          throw new Error(`Failed to fetch current config for tunnel '${tid}': ${fetchErr.message}. Ensure tunnel is remotely-managed (config_src: cloudflare).`);
        }

        const existingRules = currentConfig?.config?.ingress || [];
        // Filter out existing catch-all rule and any duplicate matching rule
        const otherRules = existingRules.filter((r) => {
          if (!r.hostname) return false; // catch-all
          if (r.hostname.toLowerCase() === host.toLowerCase()) {
            if (path && r.path) return r.path !== path.trim();
            if (!path && !r.path) return false;
          }
          return true;
        });

        const newRule = {
          hostname: host,
          ...(path && path.trim() ? { path: path.trim() } : {}),
          service: svc,
          ...(no_tls_verify ? { originRequest: { noTLSVerify: true } } : {})
        };

        // Put the new rule first, followed by others, then catch-all
        const updatedRules = [newRule, ...otherRules, { service: "http_status:404" }];

        const updatePayload = {
          config: {
            ingress: updatedRules,
            ...(currentConfig?.config?.["warp-routing"] ? { "warp-routing": currentConfig.config["warp-routing"] } : {})
          }
        };

        const result = await cfRequest({
          path: `/accounts/${accountId}/cfd_tunnel/${encodeURIComponent(tid)}/configurations`,
          method: "PUT",
          body: updatePayload,
          token
        });

        let dnsMsg = "";
        if (create_dns_cname) {
          try {
            const targetZone = await resolveZoneId({ hostname: host, zoneId: zone_id, defaultZoneId, token, accountId });
            const targetCname = `${tid}.cfargotunnel.com`;

            const existingRecords = await cfRequest({
              path: `/zones/${targetZone}/dns_records?name=${encodeURIComponent(host)}`,
              token
            });

            if (existingRecords && existingRecords.length > 0) {
              const rec = existingRecords[0];
              await cfRequest({
                path: `/zones/${targetZone}/dns_records/${rec.id}`,
                method: "PUT",
                body: {
                  type: "CNAME",
                  name: host,
                  content: targetCname,
                  proxied: true,
                  ttl: 1
                },
                token
              });
              dnsMsg = `\n- **DNS CNAME**: Updated existing record \`${host}\` -> \`${targetCname}\` (proxied: true) in zone \`${targetZone}\``;
            } else {
              await cfRequest({
                path: `/zones/${targetZone}/dns_records`,
                method: "POST",
                body: {
                  type: "CNAME",
                  name: host,
                  content: targetCname,
                  proxied: true,
                  ttl: 1
                },
                token
              });
              dnsMsg = `\n- **DNS CNAME**: Created new record \`${host}\` -> \`${targetCname}\` (proxied: true) in zone \`${targetZone}\``;
            }
          } catch (dnsErr) {
            dnsMsg = `\n- ⚠️ **DNS CNAME Failed**: ${dnsErr.message} (Ingress rule was saved successfully, but DNS CNAME could not be created automatically)`;
          }
        }

        const text = `Successfully added ingress rule to tunnel \`${tid}\`!\n- **Route**: \`${host}\`${path ? ` (path: \`${path}\`)` : ""} -> \`${svc}\`${no_tls_verify ? " (noTLSVerify: true)" : ""}${dnsMsg}\n- **Total active rules**: ${updatedRules.length}`;

        return { content: [{ type: "text", text }], structuredContent: asRecord(result) };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_tunnel_list_connections",
    {
      title: "List Tunnel Connections",
      description: "List all active connector client instances currently running and connected for a tunnel.\n\nArgs: tunnel_id (string).\nReturns: Connection status, connector version, client IP, edge colos, and timestamps.",
      inputSchema: {
        tunnel_id: z.string().describe("The UUID of the tunnel")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ tunnel_id }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const tid = tunnel_id.trim();
        const result = await cfRequest({
          path: `/accounts/${accountId}/cfd_tunnel/${encodeURIComponent(tid)}/connections`,
          token
        });

        const conns = result || [];
        const text = conns.length === 0
          ? `No active connections found for tunnel \`${tid}\`. Is cloudflared running?`
          : `Active connections for tunnel \`${tid}\` (${conns.length}):\n\n` +
            conns.map((c, i) => `${i + 1}. Connector ID: \`${c.id}\` | Colo: **${c.colo_name}** | Version: ${c.version} | Opened: ${c.opened_at}`).join("\n");

        return { content: [{ type: "text", text }], structuredContent: asRecord(conns, "connections") };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_tunnel_clean_connections",
    {
      title: "Clean Stale Tunnel Connections",
      description: "Clean up and disconnect inactive or orphaned connector connections for a tunnel.\n\nArgs: tunnel_id (string).\nReturns: Result confirmation.",
      inputSchema: {
        tunnel_id: z.string().describe("The UUID of the tunnel")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ tunnel_id }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const tid = tunnel_id.trim();
        const result = await cfRequest({
          path: `/accounts/${accountId}/cfd_tunnel/${encodeURIComponent(tid)}/connections`,
          method: "DELETE",
          token
        });

        return {
          content: [{ type: "text", text: `Successfully cleaned stale connections for tunnel \`${tid}\`.` }],
          structuredContent: asRecord(result)
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // -------------------------------------------------------------
  // DNS ROUTING FOR TUNNELS
  // -------------------------------------------------------------

  server.registerTool(
    "cf_dns_list_zones",
    {
      title: "List Cloudflare DNS Zones",
      description: "List DNS zones (domains) accessible in the account to find zone_id for routing tunnels.\n\nArgs: name (optional domain name filter, e.g. 'example.com').\nReturns: List of zones with id, name, status, and plan.",
      inputSchema: {
        name: z.string().optional().describe("Domain name filter, e.g. 'example.com'")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ name }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const params = new URLSearchParams();
        params.set("account.id", accountId);
        if (name && name.trim()) {
          params.set("name", cleanDomain(name));
        }

        let result;
        try {
          result = await cfRequest({
            path: `/zones?${params.toString()}`,
            token
          });
        } catch (scopedErr) {
          // Fallback without account.id filter if user token has user-level zone permissions
          const fallbackParams = new URLSearchParams();
          if (name && name.trim()) fallbackParams.set("name", cleanDomain(name));
          result = await cfRequest({
            path: `/zones?${fallbackParams.toString()}`,
            token
          });
        }

        const zones = (result || []).map((z) => ({
          id: z.id,
          name: z.name,
          status: z.status,
          plan: z.plan?.name
        }));

        const text = zones.length === 0
          ? "No zones found. Ensure your Cloudflare API token includes Zone -> DNS (Read or Edit) permissions."
          : `Found ${zones.length} zone(s):\n\n` +
            zones.map((z) => `- **${z.name}** (Zone ID: \`${z.id}\`, Status: ${z.status})`).join("\n");

        return { content: [{ type: "text", text }], structuredContent: asRecord(zones, "zones") };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_dns_list_records",
    {
      title: "List DNS Records",
      description: "List DNS records in a Cloudflare Zone. If zone_id is omitted, it will be automatically inferred from default_zone_id or from the name filter.\n\nArgs: zone_id (optional), type (optional, e.g. 'CNAME', 'A'), name (optional hostname filter e.g. 'app.example.com').\nReturns: List of DNS records.",
      inputSchema: {
        zone_id: z.string().optional().describe("Cloudflare Zone ID (optional, auto-inferred if omitted)"),
        type: z.string().optional().describe("Record type, e.g. 'CNAME', 'A', 'TXT'"),
        name: z.string().optional().describe("Record name filter, e.g. 'sub.example.com'")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ zone_id, type, name }) => {
      try {
        const { token, accountId, defaultZoneId } = getAuth(getSettings);
        let targetZone = zone_id ? zone_id.trim() : defaultZoneId;

        if (!targetZone && name) {
          try {
            targetZone = await resolveZoneId({ hostname: name, token, accountId });
          } catch {
            // ignore
          }
        }

        if (!targetZone) {
          throw new Error("zone_id is required or configure 'default_zone_id' in Cloudflare Settings.");
        }

        const params = new URLSearchParams();
        if (type && type.trim()) params.set("type", type.trim().toUpperCase());
        if (name && name.trim()) params.set("name", cleanHostname(name));

        const result = await cfRequest({
          path: `/zones/${targetZone}/dns_records?${params.toString()}`,
          token
        });

        const records = (result || []).map((r) => ({
          id: r.id,
          type: r.type,
          name: r.name,
          content: r.content,
          proxied: r.proxied,
          ttl: r.ttl
        }));

        const text = records.length === 0
          ? "No DNS records found matching criteria."
          : `Found ${records.length} record(s) in zone \`${targetZone}\`:\n\n` +
            records.map((r) => `- **${r.name}** [${r.type}] -> \`${r.content}\` (Proxied: ${r.proxied}, ID: \`${r.id}\`)`).join("\n");

        return { content: [{ type: "text", text }], structuredContent: asRecord(records, "records") };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_dns_create_tunnel_cname",
    {
      title: "Create Tunnel CNAME Record",
      description: "Create or update a DNS CNAME record pointing a hostname to a Cloudflare Tunnel (<tunnel_id>.cfargotunnel.com) with proxied=true. Automatically resolves zone_id from hostname if omitted.\n\nArgs: hostname (e.g. 'app.example.com'), tunnel_id (UUID), zone_id (optional, auto-detected if omitted).\nReturns: DNS record creation status.",
      inputSchema: {
        hostname: z.string().describe("The full domain or subdomain, e.g. 'app.example.com'"),
        tunnel_id: z.string().describe("The UUID of the Cloudflare Tunnel"),
        zone_id: z.string().optional().describe("Cloudflare Zone ID (optional, auto-detected from hostname if omitted)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ hostname, tunnel_id, zone_id }) => {
      try {
        const { token, accountId, defaultZoneId } = getAuth(getSettings);
        const host = cleanHostname(hostname);
        const tid = tunnel_id.trim();
        const targetZone = await resolveZoneId({ hostname: host, zoneId: zone_id, defaultZoneId, token, accountId });
        const targetCname = `${tid}.cfargotunnel.com`;

        // Check if any record already exists for this host (CNAME, A, AAAA, etc.)
        const existing = await cfRequest({
          path: `/zones/${targetZone}/dns_records?name=${encodeURIComponent(host)}`,
          token
        });

        let result;
        if (existing && existing.length > 0) {
          const recId = existing[0].id;
          result = await cfRequest({
            path: `/zones/${targetZone}/dns_records/${recId}`,
            method: "PUT",
            body: {
              type: "CNAME",
              name: host,
              content: targetCname,
              proxied: true,
              ttl: 1
            },
            token
          });
          return {
            content: [{ type: "text", text: `Updated existing DNS record for \`${host}\` -> \`${targetCname}\` (proxied: true) in zone \`${targetZone}\`.` }],
            structuredContent: asRecord(result)
          };
        } else {
          result = await cfRequest({
            path: `/zones/${targetZone}/dns_records`,
            method: "POST",
            body: {
              type: "CNAME",
              name: host,
              content: targetCname,
              proxied: true,
              ttl: 1
            },
            token
          });
          return {
            content: [{ type: "text", text: `Created new CNAME record for \`${host}\` -> \`${targetCname}\` (proxied: true) in zone \`${targetZone}\`.` }],
            structuredContent: asRecord(result)
          };
        }
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_dns_delete_record",
    {
      title: "Delete DNS Record",
      description: "Delete one DNS record, by record_id or by hostname (zone auto-detected from the hostname). Safety: refuses to delete anything that is not a CNAME pointing at a Cloudflare Tunnel (*.cfargotunnel.com) unless force=true, so ordinary A/MX/TXT records are protected. Use cf_dns_list_records to find IDs.\n\nArgs: hostname (optional), record_id (optional, takes priority), zone_id (optional), force (boolean, default false).\nReturns: The record that was removed.",
      inputSchema: {
        hostname: z.string().optional().describe("Record name, e.g. 'old.example.com'. Looked up when record_id is omitted; also used to auto-detect the zone."),
        record_id: z.string().optional().describe("DNS record ID from cf_dns_list_records. Takes priority over hostname."),
        zone_id: z.string().optional().describe("Cloudflare Zone ID (auto-detected from hostname if omitted)"),
        force: z.boolean().default(false).describe("Allow deleting a record that does not point at a Cloudflare Tunnel")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ hostname, record_id, zone_id, force }) => {
      try {
        const { token, accountId, defaultZoneId } = getAuth(getSettings);
        if (!hostname && !record_id) {
          throw new Error("Provide 'hostname' or 'record_id'.");
        }
        const host = cleanHostname(hostname);
        const targetZone = await resolveZoneId({ hostname: host, zoneId: zone_id, defaultZoneId, token, accountId });

        let rec;
        if (record_id && record_id.trim()) {
          rec = await cfRequest({
            path: `/zones/${targetZone}/dns_records/${encodeURIComponent(record_id.trim())}`,
            token
          });
        } else {
          const matches = await cfRequest({
            path: `/zones/${targetZone}/dns_records?name=${encodeURIComponent(host)}`,
            token
          });
          if (!matches || matches.length === 0) {
            throw new Error(`No DNS record found for '${host}' in zone ${targetZone}.`);
          }
          if (matches.length > 1) {
            const list = matches.map((r) => `${r.type} ${r.id} -> ${r.content}`).join("; ");
            throw new Error(`${matches.length} records match '${host}' (${list}). Pass record_id to pick one.`);
          }
          rec = matches[0];
        }

        const isTunnelCname = rec.type === "CNAME" && /\.cfargotunnel\.com$/i.test(rec.content || "");
        if (!isTunnelCname && !force) {
          throw new Error(`Refusing to delete ${rec.name} [${rec.type}] -> ${rec.content}: not a Cloudflare Tunnel CNAME. Pass force=true to delete it anyway.`);
        }

        await cfRequest({
          path: `/zones/${targetZone}/dns_records/${encodeURIComponent(rec.id)}`,
          method: "DELETE",
          token
        });

        return {
          content: [{ type: "text", text: `Deleted DNS record **${rec.name}** [${rec.type}] -> \`${rec.content}\` (ID: \`${rec.id}\`) from zone \`${targetZone}\`.` }],
          structuredContent: { deleted: true, id: rec.id, name: rec.name, type: rec.type, content: rec.content, zone_id: targetZone }
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // -------------------------------------------------------------
  // ZERO TRUST ACCESS APPLICATIONS
  // -------------------------------------------------------------

  server.registerTool(
    "cf_access_app_list",
    {
      title: "List Access Applications",
      description: "List all Cloudflare Zero Trust Access applications in the account.\n\nArgs: name (optional filter by application name).\nReturns: List of applications with id, name, domain, session duration, and type.",
      inputSchema: {
        name: z.string().optional().describe("Optional filter by application name")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ name }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const result = await cfRequest({
          path: `/accounts/${accountId}/access/apps`,
          token
        });

        let apps = (result || []).map((a) => ({
          id: a.id,
          name: a.name,
          domain: a.domain,
          type: a.type,
          session_duration: a.session_duration,
          created_at: a.created_at
        }));

        if (name && name.trim()) {
          const q = name.trim().toLowerCase();
          apps = apps.filter((a) => (a.name || "").toLowerCase().includes(q) || (a.domain || "").toLowerCase().includes(q));
        }

        const text = apps.length === 0
          ? "No Access applications found."
          : `Found ${apps.length} Access application(s):\n\n` +
            apps.map((a) => `- **${a.name}** (\`${a.domain}\`): ID: \`${a.id}\` | Type: ${a.type} | Session: ${a.session_duration}`).join("\n");

        return { content: [{ type: "text", text }], structuredContent: asRecord(apps, "applications") };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_access_app_get",
    {
      title: "Get Access Application",
      description: "Get detailed information about an Access application.\n\nArgs: app_id (string).\nReturns: Complete application configuration.",
      inputSchema: {
        app_id: z.string().describe("Access Application UUID")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ app_id }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const result = await cfRequest({
          path: `/accounts/${accountId}/access/apps/${encodeURIComponent(app_id)}`,
          token
        });

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: asRecord(result) };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_access_app_create",
    {
      title: "Create Access Application",
      description: "Create a Zero Trust Access application to protect a domain or path.\n\nArgs: name (string), domain (string, e.g. 'internal.example.com'), session_duration (string, default '24h'), type (string, default 'self_hosted'), auto_redirect_to_identity (boolean, default false).\nReturns: Created application details.",
      inputSchema: {
        name: z.string().describe("Display name for the application"),
        domain: z.string().describe("Application domain, e.g. 'grafana.example.com' or 'example.com/admin'"),
        session_duration: z.string().default("24h").describe("Session duration, e.g. '15m', '24h', '730h'"),
        type: z.enum(["self_hosted", "saas", "bookmark"]).default("self_hosted").describe("Application type"),
        auto_redirect_to_identity: z.boolean().default(false).describe("Redirect directly to the IdP without showing Cloudflare login page")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ name, domain, session_duration, type, auto_redirect_to_identity }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const cleanDom = cleanDomain(domain);
        const result = await cfRequest({
          path: `/accounts/${accountId}/access/apps`,
          method: "POST",
          body: {
            name: name.trim(),
            domain: cleanDom,
            session_duration,
            type,
            auto_redirect_to_identity
          },
          token
        });

        const text = `Successfully created Access application **${result.name}**!\n- **ID**: \`${result.id}\`\n- **Domain**: \`${result.domain}\`\n- **Session Duration**: ${result.session_duration}\n- **AUD Tag**: \`${result.aud}\``;

        return { content: [{ type: "text", text }], structuredContent: asRecord(result) };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_access_app_update",
    {
      title: "Update Access Application",
      description: "Update settings of an existing Access application.\n\nArgs: app_id (string), name (optional), domain (optional), session_duration (optional), auto_redirect_to_identity (optional).\nReturns: Updated application details.",
      inputSchema: {
        app_id: z.string().describe("Access Application UUID"),
        name: z.string().optional().describe("New display name"),
        domain: z.string().optional().describe("New domain or path"),
        session_duration: z.string().optional().describe("New session duration"),
        auto_redirect_to_identity: z.boolean().optional().describe("Redirect directly to IdP")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ app_id, name, domain, session_duration, auto_redirect_to_identity }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const aid = app_id.trim();
        const current = await cfRequest({
          path: `/accounts/${accountId}/access/apps/${encodeURIComponent(aid)}`,
          token
        });

        const payload = {
          name: name ? name.trim() : current.name,
          domain: domain ? cleanDomain(domain) : current.domain,
          session_duration: session_duration ?? current.session_duration,
          auto_redirect_to_identity: auto_redirect_to_identity ?? current.auto_redirect_to_identity,
          type: current.type
        };

        const result = await cfRequest({
          path: `/accounts/${accountId}/access/apps/${encodeURIComponent(aid)}`,
          method: "PUT",
          body: payload,
          token
        });

        return {
          content: [{ type: "text", text: `Successfully updated Access application \`${result.name}\` (\`${result.id}\`).` }],
          structuredContent: asRecord(result)
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_access_app_delete",
    {
      title: "Delete Access Application",
      description: "Delete an Access application.\n\nArgs: app_id (string).\nReturns: Deletion confirmation.",
      inputSchema: {
        app_id: z.string().describe("Access Application UUID to delete")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ app_id }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const aid = app_id.trim();
        const result = await cfRequest({
          path: `/accounts/${accountId}/access/apps/${encodeURIComponent(aid)}`,
          method: "DELETE",
          token
        });

        return {
          content: [{ type: "text", text: `Successfully deleted Access application \`${aid}\`.` }],
          structuredContent: asRecord(result)
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // -------------------------------------------------------------
  // ACCESS POLICIES
  // -------------------------------------------------------------

  server.registerTool(
    "cf_access_policy_list",
    {
      title: "List Access Policies",
      description: "List all Access policies attached to a specific Access application.\n\nArgs: app_id (string).\nReturns: List of policies with name, decision (allow/deny/bypass/non_identity), precedence, and rules.",
      inputSchema: {
        app_id: z.string().describe("Access Application UUID")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ app_id }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const aid = app_id.trim();
        const result = await cfRequest({
          path: `/accounts/${accountId}/access/apps/${encodeURIComponent(aid)}/policies`,
          token
        });

        const policies = (result || []).map((p) => ({
          id: p.id,
          name: p.name,
          decision: p.decision,
          precedence: p.precedence,
          include_count: p.include?.length || 0,
          require_count: p.require?.length || 0,
          exclude_count: p.exclude?.length || 0
        }));

        const text = policies.length === 0
          ? `No policies found for application \`${aid}\`.`
          : `Found ${policies.length} policy(ies) for application \`${aid}\`:\n\n` +
            policies.map((p) => `- **${p.name}** (\`${p.id}\`): Decision: **${p.decision.toUpperCase()}** | Precedence: ${p.precedence}`).join("\n");

        // Keep the full policy objects (include/require/exclude rules) in structuredContent
        return { content: [{ type: "text", text }], structuredContent: asRecord(result || [], "policies") };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_access_policy_get",
    {
      title: "Get Access Policy",
      description: "Get full details of a specific Access policy including its include, require, and exclude rules.\n\nArgs: app_id (string), policy_id (string).\nReturns: Full policy object.",
      inputSchema: {
        app_id: z.string().describe("Access Application UUID"),
        policy_id: z.string().describe("Policy UUID")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ app_id, policy_id }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const aid = app_id.trim();
        const pid = policy_id.trim();
        const result = await cfRequest({
          path: `/accounts/${accountId}/access/apps/${encodeURIComponent(aid)}/policies/${encodeURIComponent(pid)}`,
          token
        });

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: asRecord(result) };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_access_policy_create",
    {
      title: "Create Access Policy",
      description: "Create an Access policy on an application.\n\nArgs: app_id (string), name (string), decision ('allow'|'deny'|'non_identity'|'bypass'), emails (optional array of email addresses to include), email_domains (optional array of domains, e.g. ['mycompany.com']), group_ids (optional array of Access Group UUIDs), service_token_ids (optional array of service token UUIDs), everyone (optional boolean), raw_include (optional JSON string for complex rules).\nReturns: Created policy details.",
      inputSchema: {
        app_id: z.string().describe("Access Application UUID"),
        name: z.string().describe("Policy name, e.g. 'Allow Engineering Team'"),
        decision: z.enum(["allow", "deny", "non_identity", "bypass"]).describe("Decision action"),
        emails: z.array(z.string()).optional().describe("User email addresses to include"),
        email_domains: z.array(z.string()).optional().describe("Email domains to include, e.g. ['example.com']"),
        group_ids: z.array(z.string()).optional().describe("Access Group IDs to include"),
        service_token_ids: z.array(z.string()).optional().describe("Service token IDs to include (for bypass or non_identity)"),
        everyone: z.boolean().optional().describe("Include everyone (public)"),
        raw_include: z.string().optional().describe("Raw JSON array for custom 'include' rules"),
        raw_require: z.string().optional().describe("Raw JSON array for custom 'require' rules"),
        raw_exclude: z.string().optional().describe("Raw JSON array for custom 'exclude' rules")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({
      app_id,
      name,
      decision,
      emails,
      email_domains,
      group_ids,
      service_token_ids,
      everyone,
      raw_include,
      raw_require,
      raw_exclude
    }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const aid = app_id.trim();
        let includeRules = [];

        if (raw_include) {
          try {
            includeRules = JSON.parse(raw_include);
          } catch (e) {
            throw new Error(`Invalid JSON in raw_include: ${e.message}`);
          }
        } else {
          if (everyone) {
            includeRules.push({ everyone: {} });
          }
          if (emails) {
            emails.forEach((email) => includeRules.push({ email: { email: email.trim().toLowerCase() } }));
          }
          if (email_domains) {
            email_domains.forEach((domain) => includeRules.push({ email_domain: { domain: cleanDomain(domain) } }));
          }
          if (group_ids) {
            group_ids.forEach((id) => includeRules.push({ group: { id: id.trim() } }));
          }
          if (service_token_ids) {
            service_token_ids.forEach((token_id) => includeRules.push({ service_token: { token_id: token_id.trim() } }));
          }
        }

        if (includeRules.length === 0) {
          throw new Error("At least one include criteria (emails, email_domains, group_ids, service_token_ids, everyone, or raw_include) must be provided.");
        }

        const body = {
          name: name.trim(),
          decision,
          include: includeRules,
          require: raw_require ? JSON.parse(raw_require) : [],
          exclude: raw_exclude ? JSON.parse(raw_exclude) : []
        };

        const result = await cfRequest({
          path: `/accounts/${accountId}/access/apps/${encodeURIComponent(aid)}/policies`,
          method: "POST",
          body,
          token
        });

        const text = `Successfully created Access policy **${result.name}**!\n- **Policy ID**: \`${result.id}\`\n- **Decision**: **${result.decision.toUpperCase()}**\n- **App ID**: \`${aid}\``;

        return { content: [{ type: "text", text }], structuredContent: asRecord(result) };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_access_policy_update",
    {
      title: "Update Access Policy",
      description: "Update an existing Access policy on an application.\n\nArgs: app_id (string), policy_id (string), name (optional), decision (optional), raw_include (optional JSON string), raw_require (optional JSON string), raw_exclude (optional JSON string).\nReturns: Updated policy details.",
      inputSchema: {
        app_id: z.string().describe("Access Application UUID"),
        policy_id: z.string().describe("Policy UUID"),
        name: z.string().optional().describe("New policy name"),
        decision: z.enum(["allow", "deny", "non_identity", "bypass"]).optional().describe("New decision"),
        raw_include: z.string().optional().describe("JSON string array of include rules"),
        raw_require: z.string().optional().describe("JSON string array of require rules"),
        raw_exclude: z.string().optional().describe("JSON string array of exclude rules")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ app_id, policy_id, name, decision, raw_include, raw_require, raw_exclude }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const aid = app_id.trim();
        const pid = policy_id.trim();
        const current = await cfRequest({
          path: `/accounts/${accountId}/access/apps/${encodeURIComponent(aid)}/policies/${encodeURIComponent(pid)}`,
          token
        });

        const body = {
          name: name ? name.trim() : current.name,
          decision: decision ?? current.decision,
          include: raw_include ? JSON.parse(raw_include) : current.include,
          require: raw_require ? JSON.parse(raw_require) : current.require,
          exclude: raw_exclude ? JSON.parse(raw_exclude) : current.exclude
        };

        const result = await cfRequest({
          path: `/accounts/${accountId}/access/apps/${encodeURIComponent(aid)}/policies/${encodeURIComponent(pid)}`,
          method: "PUT",
          body,
          token
        });

        return {
          content: [{ type: "text", text: `Successfully updated Access policy \`${result.name}\` (\`${result.id}\`).` }],
          structuredContent: asRecord(result)
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_access_policy_delete",
    {
      title: "Delete Access Policy",
      description: "Delete an Access policy from an application.\n\nArgs: app_id (string), policy_id (string).\nReturns: Deletion confirmation.",
      inputSchema: {
        app_id: z.string().describe("Access Application UUID"),
        policy_id: z.string().describe("Policy UUID")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ app_id, policy_id }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const aid = app_id.trim();
        const pid = policy_id.trim();
        const result = await cfRequest({
          path: `/accounts/${accountId}/access/apps/${encodeURIComponent(aid)}/policies/${encodeURIComponent(pid)}`,
          method: "DELETE",
          token
        });

        return {
          content: [{ type: "text", text: `Successfully deleted Access policy \`${pid}\` from app \`${aid}\`.` }],
          structuredContent: asRecord(result)
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // -------------------------------------------------------------
  // ACCESS GROUPS
  // -------------------------------------------------------------

  server.registerTool(
    "cf_access_group_list",
    {
      title: "List Access Groups",
      description: "List reusable Zero Trust Access user groups in the account.\n\nArgs: name (optional filter by group name).\nReturns: List of groups with id, name, and member count.",
      inputSchema: {
        name: z.string().optional().describe("Optional filter by group name")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ name }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const result = await cfRequest({
          path: `/accounts/${accountId}/access/groups`,
          token
        });

        let groups = (result || []).map((g) => ({
          id: g.id,
          name: g.name,
          include_count: g.include?.length || 0,
          created_at: g.created_at
        }));

        if (name && name.trim()) {
          const q = name.trim().toLowerCase();
          groups = groups.filter((g) => (g.name || "").toLowerCase().includes(q));
        }

        const text = groups.length === 0
          ? "No Access groups found."
          : `Found ${groups.length} Access group(s):\n\n` +
            groups.map((g) => `- **${g.name}** (\`${g.id}\`): Rules: ${g.include_count}`).join("\n");

        return { content: [{ type: "text", text }], structuredContent: asRecord(groups, "groups") };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_access_group_create",
    {
      title: "Create Access Group",
      description: "Create a reusable Access group containing emails or email domains.\n\nArgs: name (string), emails (optional array), email_domains (optional array), raw_include (optional JSON string).\nReturns: Created group details.",
      inputSchema: {
        name: z.string().describe("Group name, e.g. 'Site Admins'"),
        emails: z.array(z.string()).optional().describe("List of user emails"),
        email_domains: z.array(z.string()).optional().describe("List of allowed email domains"),
        raw_include: z.string().optional().describe("Raw JSON array for include rules")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ name, emails, email_domains, raw_include }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        let includeRules = [];

        if (raw_include) {
          try {
            includeRules = JSON.parse(raw_include);
          } catch (e) {
            throw new Error(`Invalid JSON in raw_include: ${e.message}`);
          }
        } else {
          if (emails) {
            emails.forEach((email) => includeRules.push({ email: { email: email.trim().toLowerCase() } }));
          }
          if (email_domains) {
            email_domains.forEach((domain) => includeRules.push({ email_domain: { domain: cleanDomain(domain) } }));
          }
        }

        if (includeRules.length === 0) {
          throw new Error("Provide at least emails, email_domains, or raw_include.");
        }

        const result = await cfRequest({
          path: `/accounts/${accountId}/access/groups`,
          method: "POST",
          body: {
            name: name.trim(),
            include: includeRules
          },
          token
        });

        return {
          content: [{ type: "text", text: `Successfully created Access group **${result.name}** (\`${result.id}\`).` }],
          structuredContent: asRecord(result)
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_access_group_delete",
    {
      title: "Delete Access Group",
      description: "Delete a reusable Access group.\n\nArgs: group_id (string).\nReturns: Deletion confirmation.",
      inputSchema: {
        group_id: z.string().describe("Access Group UUID to delete")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ group_id }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const gid = group_id.trim();
        const result = await cfRequest({
          path: `/accounts/${accountId}/access/groups/${encodeURIComponent(gid)}`,
          method: "DELETE",
          token
        });

        return {
          content: [{ type: "text", text: `Successfully deleted Access group \`${gid}\`.` }],
          structuredContent: asRecord(result)
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // -------------------------------------------------------------
  // ACCESS SERVICE TOKENS
  // -------------------------------------------------------------

  server.registerTool(
    "cf_access_service_token_list",
    {
      title: "List Access Service Tokens",
      description: "List all Access service tokens in the account (used for automated M2M access or CI/CD pipelines).\n\nArgs: name (optional filter by token name).\nReturns: List of service tokens with id, name, and expiration.",
      inputSchema: {
        name: z.string().optional().describe("Optional filter by token name")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ name }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const result = await cfRequest({
          path: `/accounts/${accountId}/access/service_tokens`,
          token
        });

        let tokens = (result || []).map((t) => ({
          id: t.id,
          name: t.name,
          client_id: t.client_id,
          duration: t.duration,
          expires_at: t.expires_at,
          created_at: t.created_at
        }));

        if (name && name.trim()) {
          const q = name.trim().toLowerCase();
          tokens = tokens.filter((t) => (t.name || "").toLowerCase().includes(q));
        }

        const text = tokens.length === 0
          ? "No Access service tokens found."
          : `Found ${tokens.length} service token(s):\n\n` +
            tokens.map((t) => `- **${t.name}** (\`${t.id}\`): Client ID: \`${t.client_id}\` | Expires: ${t.expires_at}`).join("\n");

        return { content: [{ type: "text", text }], structuredContent: asRecord(tokens, "service_tokens") };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_access_service_token_create",
    {
      title: "Create Access Service Token",
      description: "Create an Access service token. Cloudflare returns the CF-Access-Client-Id and CF-Access-Client-Secret ONLY ONCE upon creation.\n\nArgs: name (string), duration (string, default '8760h' - 1 year).\nReturns: Service token ID, client_id, and client_secret.",
      inputSchema: {
        name: z.string().describe("Service token name, e.g. 'GitHub Actions Deployer'"),
        duration: z.string().default("8760h").describe("Token duration, e.g. '8760h' (1 year)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ name, duration }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const result = await cfRequest({
          path: `/accounts/${accountId}/access/service_tokens`,
          method: "POST",
          body: { name: name.trim(), duration },
          token
        });

        const text = [
          `### ⚠️ Service Token Created: **${result.name}**`,
          `Save the Client Secret now — it will **NEVER** be displayed again!`,
          "",
          `- **Token ID**: \`${result.id}\``,
          `- **CF-Access-Client-Id**: \`${result.client_id}\``,
          `- **CF-Access-Client-Secret**: \`${result.client_secret}\``,
          `- **Duration**: ${result.duration}`,
          "",
          "Use these headers in your automated HTTP requests:",
          "```http",
          `CF-Access-Client-Id: ${result.client_id}`,
          `CF-Access-Client-Secret: ${result.client_secret}`,
          "```"
        ].join("\n");

        return { content: [{ type: "text", text }], structuredContent: asRecord(result) };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cf_access_service_token_delete",
    {
      title: "Delete Access Service Token",
      description: "Revoke and delete an Access service token.\n\nArgs: token_id (string).\nReturns: Deletion confirmation.",
      inputSchema: {
        token_id: z.string().describe("Service Token UUID to revoke")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ token_id }) => {
      try {
        const { token, accountId } = getAuth(getSettings);
        const tid = token_id.trim();
        const result = await cfRequest({
          path: `/accounts/${accountId}/access/service_tokens/${encodeURIComponent(tid)}`,
          method: "DELETE",
          token
        });

        return {
          content: [{ type: "text", text: `Successfully revoked Access service token \`${tid}\`.` }],
          structuredContent: asRecord(result)
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}

async function testService(settings) {
  const missing = configurationError("cloudflare", settings);
  if (missing) return { ok: false, message: `${missing}. Open Settings.` };
  const token = cleanString(settings?.api_token);
  const accountId = cleanString(settings?.account_id);

  if (!token) {
    return { ok: false, message: "api_token is not configured" };
  }
  if (!accountId) {
    return { ok: false, message: "account_id is not configured" };
  }

  try {
    const res = await cfRequest({
      path: `/accounts/${accountId}/cfd_tunnel?per_page=1`,
      token
    });
    return {
      ok: true,
      message: `Cloudflare API connected successfully! (Account verified, returned ${(res || []).length} tunnel check)`
    };
  } catch (err) {
    return {
      ok: false,
      message: `Cloudflare API connection failed: ${err.message}`
    };
  }
}
/** UI connectivity checks never expose provider bodies or account/session details. */
export async function test(settings, context = {}) {
  const missing = configurationError("cloudflare", settings);
  if (missing) return { ok: false, message: `${missing}. Open Settings.` };
  try {
    const result = await testService(settings, context);
    return result.ok ? { ok: true, message: "Connection successful." } :
      { ok: false, message: "Connection failed. Check Settings, permissions and service availability." };
  } catch {
    return { ok: false, message: "Connection failed. Check Settings, permissions and service availability." };
  }
}
