import { configurationError, guardedServer } from "./bundle.js";
const API = "https://api.pushover.net/1";
const MAX_CHARS = 25000;

function form(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    p.append(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  return p.toString();
}

function truncate(s) {
  if (s.length <= MAX_CHARS) return s;
  return s.slice(0, MAX_CHARS) + `\n\n… truncated (${s.length} chars total). Narrow the request to see the rest.`;
}

async function call(fetchJson, path, { method = "GET", body } = {}) {
  const url = `${API}${path}`;
  const opts = { method };
  if (body) {
    opts.headers = { "Content-Type": "application/x-www-form-urlencoded" };
    opts.body = form(body);
  }
  try {
    return await fetchJson(url, opts);
  } catch (e) {
    // Pushover returns JSON with an "errors" array on 4xx; surface it usefully.
    const m = String(e && e.message ? e.message : e);
    throw new Error(m.replace(/\s+/g, " ").slice(0, 600));
  }
}

function ok(text, data) {
  return { content: [{ type: "text", text: truncate(text) }], ...(data ? { structuredContent: data } : {}) };
}
function err(text) {
  return { content: [{ type: "text", text: `Error: ${text}` }], isError: true };
}

export function register({ server, z, getSettings, log, fetchJson }) {
  server = guardedServer(server, "pushover", getSettings, []);
  const creds = () => {
    const s = getSettings();
    return {
      token: (s.api_token || "").trim(),
      user: (s.user_key || "").trim(),
      device: (s.default_device || "").trim(),
      sound: (s.default_sound || "").trim()
    };
  };

  // ---------------------------------------------------------------- send
  server.registerTool(
    "pushover_send_message",
    {
      title: "Send push notification",
      description:
        "Send a push notification through Pushover to your devices.\n\n" +
        "Args: message (string, required, max 1024 chars); title (string, optional, max 250, defaults to the app name); " +
        "user (string, optional user or group key — defaults to the configured user_key); device (string, optional comma-separated device names); " +
        "priority (-2 lowest | -1 quiet | 0 normal (default) | 1 high | 2 emergency); sound (string, e.g. pushover, magic, siren, none — see pushover_list_sounds); " +
        "url + url_title (supplementary link); html (bool, allow <b> <i> <u> <a href> <font color>); monospace (bool, mutually exclusive with html); " +
        "ttl (seconds, auto-delete the message on the device, ignored for priority 2); timestamp (unix seconds to display instead of receive time); " +
        "retry + expire (REQUIRED when priority=2: retry>=30 seconds between re-alerts, expire<=10800 seconds total).\n\n" +
        "Returns: confirmation with the Pushover request id, plus a receipt id when priority=2 (feed it to pushover_check_receipt).\n\n" +
        "Do NOT use for silent status dashboards — use pushover_update_glance instead. " +
        "Errors: 'Error: api_token is not configured…', 'Error: priority 2 requires retry and expire', 'Error: user identifier is not a valid user, group, or subscribed user key'.",
      inputSchema: {
        message: z.string().min(1).max(1024).describe("Body of the notification (max 1024 chars)"),
        title: z.string().max(250).optional().describe("Notification title; defaults to the Pushover application name"),
        user: z.string().optional().describe("User or group key to notify; defaults to the configured user_key setting"),
        device: z.string().optional().describe("Comma-separated device names to target; defaults to all devices (or default_device setting)"),
        priority: z.number().int().min(-2).max(2).default(0).describe("-2 no alert, -1 quiet, 0 normal, 1 high/bypass quiet hours, 2 emergency (needs retry+expire)"),
        sound: z.string().optional().describe("Sound name, e.g. pushover, magic, siren, none"),
        url: z.string().url().optional().describe("Supplementary URL shown with the message"),
        url_title: z.string().max(100).optional().describe("Label for the supplementary URL"),
        html: z.boolean().default(false).describe("Render limited HTML in the message body"),
        monospace: z.boolean().default(false).describe("Render the message in a monospace font (cannot combine with html)"),
        ttl: z.number().int().min(1).optional().describe("Seconds after which the message auto-deletes from devices (priority < 2 only)"),
        timestamp: z.number().int().optional().describe("Unix timestamp to display as the message time"),
        retry: z.number().int().min(30).optional().describe("Priority 2 only: seconds between re-alerts (min 30)"),
        expire: z.number().int().min(30).max(10800).optional().describe("Priority 2 only: seconds until the emergency alert stops (max 10800)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async (a) => {
      const c = creds();
      if (!c.token) return err("api_token is not configured. Open MCP Station → Pushover → Settings.");
      const user = a.user || c.user;
      if (!user) return err("no user key. Pass 'user' or set user_key in MCP Station → Pushover → Settings.");
      if (a.priority === 2 && (!a.retry || !a.expire)) return err("priority 2 (emergency) requires both retry (>=30s) and expire (<=10800s).");
      if (a.html && a.monospace) return err("html and monospace are mutually exclusive — pick one.");

      try {
        const r = await call(fetchJson, "/messages.json", {
          method: "POST",
          body: {
            token: c.token,
            user,
            message: a.message,
            title: a.title,
            device: a.device || c.device,
            priority: a.priority,
            sound: a.sound || c.sound,
            url: a.url,
            url_title: a.url_title,
            html: a.html ? 1 : undefined,
            monospace: a.monospace ? 1 : undefined,
            ttl: a.priority === 2 ? undefined : a.ttl,
            timestamp: a.timestamp,
            retry: a.priority === 2 ? a.retry : undefined,
            expire: a.priority === 2 ? a.expire : undefined
          }
        });
        const lines = [
          `Sent ✅ ${a.title ? `"${a.title}" — ` : ""}${a.message.slice(0, 120)}`,
          `priority: ${a.priority}${a.priority === 2 ? ` (retry ${a.retry}s, expire ${a.expire}s)` : ""}`,
          `request: ${r.request || "?"}`
        ];
        if (r.receipt) lines.push(`receipt: ${r.receipt}  → check with pushover_check_receipt`);
        return ok(lines.join("\n"), r);
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ---------------------------------------------------------------- glance
  server.registerTool(
    "pushover_update_glance",
    {
      title: "Update glance / widget",
      description:
        "Update a Pushover Glance: the silent data widget on watch faces and phone widgets. No notification is produced.\n\n" +
        "Args (all optional but at least one of title/text/subtext/count/percent required): title (max 100), text (max 100, main line), " +
        "subtext (max 100, second line), count (integer, shown as a number), percent (0-100 progress bar), user (defaults to configured key), device.\n" +
        "Returns: confirmation with request id.\n\n" +
        "Use for ambient status (queue depth, sales today, uptime). Do NOT use when you want the user alerted — use pushover_send_message.",
      inputSchema: {
        title: z.string().max(100).optional().describe("Glance title"),
        text: z.string().max(100).optional().describe("Main line of text"),
        subtext: z.string().max(100).optional().describe("Secondary line of text"),
        count: z.number().int().optional().describe("Integer displayed as a count"),
        percent: z.number().int().min(0).max(100).optional().describe("Progress bar percentage 0-100"),
        user: z.string().optional().describe("User or group key; defaults to the configured user_key"),
        device: z.string().optional().describe("Target device name; defaults to all devices")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (a) => {
      const c = creds();
      if (!c.token) return err("api_token is not configured. Open MCP Station → Pushover → Settings.");
      const user = a.user || c.user;
      if (!user) return err("no user key. Pass 'user' or set user_key in Settings.");
      if (a.title === undefined && a.text === undefined && a.subtext === undefined && a.count === undefined && a.percent === undefined)
        return err("provide at least one of title, text, subtext, count, percent.");
      try {
        const r = await call(fetchJson, "/glances.json", {
          method: "POST",
          body: { token: c.token, user, device: a.device || c.device, title: a.title, text: a.text, subtext: a.subtext, count: a.count, percent: a.percent }
        });
        return ok(`Glance updated ✅ (request ${r.request || "?"})`, r);
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ---------------------------------------------------------------- receipt
  server.registerTool(
    "pushover_check_receipt",
    {
      title: "Check emergency receipt",
      description:
        "Check the delivery/acknowledgement status of an emergency (priority 2) notification.\n\n" +
        "Args: receipt (string, the 30-char receipt id returned by pushover_send_message when priority=2).\n" +
        "Returns: acknowledged yes/no, who acknowledged and when, whether the alert has expired, last delivery time.\n" +
        "Errors: 'Error: receipt is invalid' if the id is wrong or older than the retention window.",
      inputSchema: {
        receipt: z.string().min(20).describe("Receipt id from an emergency-priority message")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ receipt }) => {
      const c = creds();
      if (!c.token) return err("api_token is not configured.");
      try {
        const r = await call(fetchJson, `/receipts/${encodeURIComponent(receipt)}.json?token=${encodeURIComponent(c.token)}`);
        const t = (v) => (v ? new Date(v * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—");
        const text = [
          `Receipt ${receipt}`,
          `acknowledged: ${r.acknowledged ? `yes at ${t(r.acknowledged_at)}${r.acknowledged_by_device ? ` (${r.acknowledged_by_device})` : ""}` : "no"}`,
          `expired: ${r.expired ? `yes at ${t(r.expires_at)}` : `no (expires ${t(r.expires_at)})`}`,
          `last delivered: ${t(r.last_delivered_at)}`,
          `called back: ${r.called_back ? `yes at ${t(r.called_back_at)}` : "no"}`
        ].join("\n");
        return ok(text, r);
      } catch (e) {
        return err(e.message);
      }
    }
  );

  server.registerTool(
    "pushover_cancel_receipt",
    {
      title: "Cancel emergency retries",
      description:
        "Stop the repeated re-alerts of an emergency (priority 2) notification before it is acknowledged or expires.\n\n" +
        "Args: receipt (string, receipt id).\n" +
        "Returns: confirmation. Already-delivered notifications are NOT removed from devices; only future retries stop.\n" +
        "Errors: 'Error: receipt is invalid'.",
      inputSchema: {
        receipt: z.string().min(20).describe("Receipt id of the emergency message to stop retrying")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ receipt }) => {
      const c = creds();
      if (!c.token) return err("api_token is not configured.");
      try {
        const r = await call(fetchJson, `/receipts/${encodeURIComponent(receipt)}/cancel.json`, {
          method: "POST",
          body: { token: c.token }
        });
        return ok(`Retries cancelled for receipt ${receipt} ✅ (request ${r.request || "?"})`, r);
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ---------------------------------------------------------------- validate
  server.registerTool(
    "pushover_validate_user",
    {
      title: "Validate user key / list devices",
      description:
        "Validate a user or group key against the application token and list that user's active devices and licenses.\n\n" +
        "Args: user (string, optional — defaults to the configured user_key); device (string, optional — also verify this device exists).\n" +
        "Returns: valid/invalid, device list, licenses.\n" +
        "Use before sending to a key supplied by someone else. Errors: 'Error: user identifier is not a valid user, group, or subscribed user key'.",
      inputSchema: {
        user: z.string().optional().describe("User or group key to validate; defaults to the configured user_key"),
        device: z.string().optional().describe("Optionally verify this specific device name exists")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ user, device }) => {
      const c = creds();
      if (!c.token) return err("api_token is not configured.");
      const u = user || c.user;
      if (!u) return err("no user key. Pass 'user' or set user_key in Settings.");
      try {
        const r = await call(fetchJson, "/users/validate.json", { method: "POST", body: { token: c.token, user: u, device } });
        const text = [
          `User key valid ✅`,
          `devices: ${(r.devices || []).join(", ") || "none registered"}`,
          `licenses: ${(r.licenses || []).join(", ") || "—"}`
        ].join("\n");
        return ok(text, r);
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ---------------------------------------------------------------- sounds
  server.registerTool(
    "pushover_list_sounds",
    {
      title: "List notification sounds",
      description:
        "List the sound names accepted by the 'sound' argument of pushover_send_message.\n\n" +
        "Args: none.\nReturns: markdown list of sound id → human label (e.g. pushover → Pushover (default), siren → Siren, none → None (silent)).",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async () => {
      const c = creds();
      if (!c.token) return err("api_token is not configured.");
      try {
        const r = await call(fetchJson, `/sounds.json?token=${encodeURIComponent(c.token)}`);
        const rows = Object.entries(r.sounds || {}).map(([k, v]) => `- \`${k}\` — ${v}`);
        return ok(`Available sounds (${rows.length}):\n${rows.join("\n")}`, r);
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ---------------------------------------------------------------- limits
  server.registerTool(
    "pushover_get_limits",
    {
      title: "Get monthly message limits",
      description:
        "Show the application's monthly message quota: limit, remaining and reset date.\n\n" +
        "Args: none.\nReturns: e.g. 'limit 10000, remaining 9873, resets 2025-02-01'. Use when sends start failing or before a bulk run.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async () => {
      const c = creds();
      if (!c.token) return err("api_token is not configured.");
      try {
        const r = await call(fetchJson, `/apps/limits.json?token=${encodeURIComponent(c.token)}`);
        const reset = r.reset ? new Date(r.reset * 1000).toISOString().slice(0, 10) : "?";
        return ok(`Monthly limit: ${r.limit}\nRemaining: ${r.remaining}\nResets: ${reset}`, r);
      } catch (e) {
        return err(e.message);
      }
    }
  );

  log && log("pushover module registered");
}

async function testService(settings, { fetchJson }) {
  const missing = configurationError("pushover", settings);
  if (missing) return { ok: false, message: `${missing}. Open Settings.` };
  const token = (settings.api_token || "").trim();
  const user = (settings.user_key || "").trim();
  if (!token) return { ok: false, message: "api_token not set" };
  if (!user) return { ok: false, message: "user_key not set" };
  try {
    const r = await fetchJson("https://api.pushover.net/1/users/validate.json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ token, user })
    });
    const devices = (r.devices || []).join(", ") || "no devices registered";
    return { ok: true, message: `Token + user key valid. Devices: ${devices}` };
  } catch (e) {
    return { ok: false, message: `Pushover rejected the credentials: ${String(e.message || e).slice(0, 200)}` };
  }
}

/** UI connectivity checks never expose provider bodies or account/session details. */
export async function test(settings, context = {}) {
  const missing = configurationError("pushover", settings);
  if (missing) return { ok: false, message: `${missing}. Open Settings.` };
  try {
    const result = await testService(settings, context);
    return result.ok ? { ok: true, message: "Connection successful." } :
      { ok: false, message: "Connection failed. Check Settings, permissions and service availability." };
  } catch {
    return { ok: false, message: "Connection failed. Check Settings, permissions and service availability." };
  }
}
