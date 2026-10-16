import { createHash } from "node:crypto";
import { configurationError, guardedServer } from "./bundle.js";
// Gmail MCP Module for MCP Station
// Google Gmail API v1 implementation

let cachedToken = null;
let tokenExpiresAt = 0;
let cachedCredential = "";

async function getAccessToken(settings, fetchJson) {
  if (settings.access_token && !settings.refresh_token) {
    return settings.access_token.trim();
  }

  if (settings.refresh_token && settings.client_id && settings.client_secret) {
    const credential = createHash("sha256").update(JSON.stringify([settings.client_id, settings.client_secret, settings.refresh_token])).digest("hex");
    const now = Date.now();
    if (cachedCredential === credential && cachedToken && tokenExpiresAt > now + 60000) {
      return cachedToken;
    }

    const params = new URLSearchParams({
      client_id: settings.client_id.trim(),
      client_secret: settings.client_secret.trim(),
      refresh_token: settings.refresh_token.trim(),
      grant_type: "refresh_token"
    });

    const res = await fetchJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });

    if (res.access_token) {
      cachedCredential = credential;
      cachedToken = res.access_token;
      tokenExpiresAt = Date.now() + (res.expires_in || 3600) * 1000;
      return cachedToken;
    }
    throw new Error(`Failed to refresh Google OAuth token: ${JSON.stringify(res)}`);
  }

  if (settings.access_token) {
    return settings.access_token.trim();
  }

  throw new Error(
    "Gmail is not configured. Please provide an 'access_token' OR ('client_id', 'client_secret', and 'refresh_token') in MCP Station → Gmail → Settings."
  );
}

async function gmailRequest(endpoint, { method = "GET", body = null, headers = {} } = {}, settings, fetchJson) {
  const token = await getAccessToken(settings, fetchJson);
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  const url = endpoint.startsWith("http") ? endpoint : `${base}${endpoint}`;

  const reqHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...headers
  };

  let reqBody = body;
  if (body && typeof body === "object" && !(body instanceof Uint8Array) && !(body instanceof URLSearchParams)) {
    reqHeaders["Content-Type"] = reqHeaders["Content-Type"] || "application/json";
    reqBody = JSON.stringify(body);
  }

  return await fetchJson(url, {
    method,
    headers: reqHeaders,
    body: reqBody
  });
}

function truncate(str, max = 25000) {
  if (typeof str !== "string") return str;
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n\n… [Output truncated at ${max} characters. Use specific query/filters to narrow results]`;
}

function encodeHeader(text) {
  if (!text) return "";
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf-8").toString("base64")}?=`;
}

function extractHeader(headers, name) {
  if (!Array.isArray(headers)) return "";
  const found = headers.find((h) => h.name && h.name.toLowerCase() === name.toLowerCase());
  return found ? found.value : "";
}

function extractParts(part, result = { text: "", html: "", attachments: [] }) {
  if (!part) return result;

  if (part.mimeType === "text/plain" && part.body?.data) {
    try {
      result.text += Buffer.from(part.body.data, "base64url").toString("utf-8");
    } catch {
      // ignore decoding error
    }
  } else if (part.mimeType === "text/html" && part.body?.data) {
    try {
      result.html += Buffer.from(part.body.data, "base64url").toString("utf-8");
    } catch {
      // ignore decoding error
    }
  } else if (part.filename && part.filename.length > 0) {
    result.attachments.push({
      filename: part.filename,
      mimeType: part.mimeType,
      size: part.body?.size,
      attachmentId: part.body?.attachmentId
    });
  }

  if (part.parts && Array.isArray(part.parts)) {
    for (const sub of part.parts) {
      extractParts(sub, result);
    }
  }
  return result;
}

function parseMessageDetails(msg) {
  const payload = msg.payload || {};
  const headers = payload.headers || [];

  const subject = extractHeader(headers, "Subject");
  const from = extractHeader(headers, "From");
  const to = extractHeader(headers, "To");
  const cc = extractHeader(headers, "Cc");
  const bcc = extractHeader(headers, "Bcc");
  const date = extractHeader(headers, "Date");
  const messageIdHeader = extractHeader(headers, "Message-ID");
  const inReplyTo = extractHeader(headers, "In-Reply-To");
  const references = extractHeader(headers, "References");

  const extracted = extractParts(payload);

  // If no parts extracted text, check top-level body data
  if (!extracted.text && !extracted.html && payload.body?.data) {
    try {
      const bodyContent = Buffer.from(payload.body.data, "base64url").toString("utf-8");
      if (payload.mimeType === "text/html") {
        extracted.html = bodyContent;
      } else {
        extracted.text = bodyContent;
      }
    } catch {
      // ignore decoding error
    }
  }

  return {
    id: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds || [],
    snippet: msg.snippet,
    historyId: msg.historyId,
    internalDate: msg.internalDate ? new Date(parseInt(msg.internalDate, 10)).toISOString() : null,
    subject,
    from,
    to,
    cc,
    bcc,
    date,
    messageIdHeader,
    inReplyTo,
    references,
    textBody: extracted.text.trim(),
    htmlBody: extracted.html.trim(),
    attachments: extracted.attachments
  };
}

function buildRawEmail({ from, to, cc, bcc, subject, text, html, inReplyTo, references, attachments = [] }) {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines = [];

  if (from) lines.push(`From: ${from}`);
  if (to) lines.push(`To: ${Array.isArray(to) ? to.join(", ") : to}`);
  if (cc) lines.push(`Cc: ${Array.isArray(cc) ? cc.join(", ") : cc}`);
  if (bcc) lines.push(`Bcc: ${Array.isArray(bcc) ? bcc.join(", ") : bcc}`);
  if (subject) lines.push(`Subject: ${encodeHeader(subject)}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push("MIME-Version: 1.0");

  const hasAttachments = attachments && attachments.length > 0;
  const hasBothTextAndHtml = Boolean(text && html);

  if (hasAttachments) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push("");

    if (hasBothTextAndHtml) {
      const altBoundary = `----=_Alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
      lines.push("");
      lines.push(`--${altBoundary}`);
      lines.push("Content-Type: text/plain; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: base64");
      lines.push("");
      lines.push(Buffer.from(text, "utf-8").toString("base64"));
      lines.push("");
      lines.push(`--${altBoundary}`);
      lines.push("Content-Type: text/html; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: base64");
      lines.push("");
      lines.push(Buffer.from(html, "utf-8").toString("base64"));
      lines.push("");
      lines.push(`--${altBoundary}--`);
    } else {
      lines.push(`--${boundary}`);
      const mime = html ? "text/html" : "text/plain";
      const content = html || text || "";
      lines.push(`Content-Type: ${mime}; charset=UTF-8`);
      lines.push("Content-Transfer-Encoding: base64");
      lines.push("");
      lines.push(Buffer.from(content, "utf-8").toString("base64"));
      lines.push("");
    }

    for (const att of attachments) {
      lines.push(`--${boundary}`);
      const attMime = att.mimeType || "application/octet-stream";
      const attFilename = encodeHeader(att.filename || "attachment");
      lines.push(`Content-Type: ${attMime}; name="${attFilename}"`);
      lines.push("Content-Transfer-Encoding: base64");
      lines.push(`Content-Disposition: attachment; filename="${attFilename}"`);
      lines.push("");
      const b64Data = typeof att.content === "string" ? att.content : Buffer.from(att.content).toString("base64");
      lines.push(b64Data);
      lines.push("");
    }
    lines.push(`--${boundary}--`);
  } else if (hasBothTextAndHtml) {
    const altBoundary = `----=_Alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    lines.push("");
    lines.push(`--${altBoundary}`);
    lines.push("Content-Type: text/plain; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(Buffer.from(text, "utf-8").toString("base64"));
    lines.push("");
    lines.push(`--${altBoundary}`);
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(Buffer.from(html, "utf-8").toString("base64"));
    lines.push("");
    lines.push(`--${altBoundary}--`);
  } else {
    const mime = html ? "text/html" : "text/plain";
    const content = html || text || "";
    lines.push(`Content-Type: ${mime}; charset=UTF-8`);
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(Buffer.from(content, "utf-8").toString("base64"));
  }

  const rawMime = lines.join("\r\n");
  return Buffer.from(rawMime, "utf-8").toString("base64url");
}

export function register({ server, z, getSettings, log, fetchJson }) {
  server = guardedServer(server, "gmail", getSettings, []);
  // 1. Get Profile
  server.registerTool(
    "gmail_get_profile",
    {
      title: "Get Gmail user profile",
      description: "Get the current authenticated user's email address, total messages, total threads, and historyId.\n\nReturns: emailAddress, messagesTotal, threadsTotal, historyId.\nErrors: 'Gmail is not configured...'",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async () => {
      const settings = getSettings();
      try {
        const res = await gmailRequest("/profile", {}, settings, fetchJson);
        const text = `**Gmail Profile**\n- Email: \`${res.emailAddress}\`\n- Total Messages: ${res.messagesTotal?.toLocaleString() || 0}\n- Total Threads: ${res.threadsTotal?.toLocaleString() || 0}\n- History ID: \`${res.historyId}\``;
        return { content: [{ type: "text", text }], structuredContent: res };
      } catch (err) {
        return { content: [{ type: "text", text: `Error getting profile: ${err.message}` }] };
      }
    }
  );

  // 2. List / Search Messages
  server.registerTool(
    "gmail_list_messages",
    {
      title: "Search & list messages",
      description: "Search and list messages in the mailbox with support for full Gmail query syntax.\n\nArgs: query (e.g. 'is:unread', 'from:sender', 'has:attachment', 'subject:receipt'), label_ids (array of label IDs e.g. ['INBOX', 'UNREAD']), max_results (1-100, default 20), page_token, include_spam_trash (default false).\nReturns: list of message summaries with ID, thread ID, snippet, and subject/from info.",
      inputSchema: {
        query: z.string().optional().describe("Gmail search query (e.g. 'is:unread', 'from:sender', 'has:attachment', 'newer_than:2d')"),
        label_ids: z.array(z.string()).optional().describe("Filter by label IDs (e.g. ['INBOX', 'STARRED'])"),
        max_results: z.number().int().min(1).max(100).default(20).describe("Max messages to return (1-100)"),
        page_token: z.string().optional().describe("Token for pagination"),
        include_spam_trash: z.boolean().default(false).describe("Include messages from SPAM and TRASH")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ query, label_ids, max_results, page_token, include_spam_trash }) => {
      const settings = getSettings();
      try {
        const params = new URLSearchParams({
          maxResults: String(max_results),
          includeSpamTrash: String(include_spam_trash)
        });
        if (query) params.set("q", query);
        if (page_token) params.set("pageToken", page_token);
        if (label_ids && label_ids.length > 0) {
          label_ids.forEach((id) => params.append("labelIds", id));
        }

        const res = await gmailRequest(`/messages?${params.toString()}`, {}, settings, fetchJson);
        const messages = res.messages || [];

        if (messages.length === 0) {
          return {
            content: [{ type: "text", text: `No messages found matching criteria.` }],
            structuredContent: { messages: [], nextPageToken: res.nextPageToken, resultSizeEstimate: res.resultSizeEstimate }
          };
        }

        // Fetch snippets / headers for the found messages in parallel
        const details = await Promise.all(
          messages.map(async (m) => {
            try {
              const full = await gmailRequest(`/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, {}, settings, fetchJson);
              const headers = full.payload?.headers || [];
              return {
                id: m.id,
                threadId: m.threadId,
                subject: extractHeader(headers, "Subject") || "(no subject)",
                from: extractHeader(headers, "From") || "(unknown sender)",
                date: extractHeader(headers, "Date") || "",
                snippet: full.snippet || "",
                labelIds: full.labelIds || []
              };
            } catch {
              return { id: m.id, threadId: m.threadId, subject: "(error loading headers)", from: "", date: "", snippet: "", labelIds: [] };
            }
          })
        );

        let text = `### Found ${details.length} Message(s)${res.nextPageToken ? ` (Next page token available)` : ""}\n\n`;
        text += details
          .map(
            (d, idx) =>
              `${idx + 1}. **${d.subject}**\n   - **ID**: \`${d.id}\` | **Thread ID**: \`${d.threadId}\`\n   - **From**: ${d.from}\n   - **Date**: ${d.date}\n   - **Labels**: ${d.labelIds.join(", ") || "none"}\n   - **Snippet**: ${d.snippet}`
          )
          .join("\n\n");

        if (res.nextPageToken) {
          text += `\n\n*Use \`page_token: "${res.nextPageToken}"\` to retrieve the next page.*`;
        }

        return {
          content: [{ type: "text", text: truncate(text) }],
          structuredContent: { messages: details, nextPageToken: res.nextPageToken, resultSizeEstimate: res.resultSizeEstimate }
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error listing messages: ${err.message}` }] };
      }
    }
  );

  // 3. Get Single Message
  server.registerTool(
    "gmail_get_message",
    {
      title: "Get message details",
      description: "Get full details of an email message including headers, plain text content, HTML content, labels, and attachment list.\n\nArgs: message_id (string, required), format ('full' | 'metadata' | 'minimal' | 'raw', default 'full').\nReturns: parsed message details.",
      inputSchema: {
        message_id: z.string().describe("Gmail message ID"),
        format: z.enum(["full", "metadata", "minimal", "raw"]).default("full").describe("Payload detail format")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ message_id, format }) => {
      const settings = getSettings();
      try {
        const res = await gmailRequest(`/messages/${encodeURIComponent(message_id)}?format=${format}`, {}, settings, fetchJson);
        const parsed = parseMessageDetails(res);

        let text = `### Message: ${parsed.subject || "(no subject)"}\n`;
        text += `- **ID**: \`${parsed.id}\`\n`;
        text += `- **Thread ID**: \`${parsed.threadId}\`\n`;
        text += `- **From**: ${parsed.from}\n`;
        text += `- **To**: ${parsed.to}\n`;
        if (parsed.cc) text += `- **Cc**: ${parsed.cc}\n`;
        if (parsed.bcc) text += `- **Bcc**: ${parsed.bcc}\n`;
        text += `- **Date**: ${parsed.date}\n`;
        text += `- **Labels**: ${parsed.labelIds.join(", ") || "none"}\n`;

        if (parsed.attachments.length > 0) {
          text += `- **Attachments (${parsed.attachments.length})**:\n`;
          parsed.attachments.forEach((a) => {
            text += `  - \`${a.filename}\` (${a.mimeType}, ${a.size} bytes) - Attachment ID: \`${a.attachmentId}\`\n`;
          });
        }

        text += `\n---\n**Body**:\n\n${parsed.textBody || parsed.htmlBody || parsed.snippet || "(No content)"}`;

        return {
          content: [{ type: "text", text: truncate(text) }],
          structuredContent: parsed
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error fetching message ${message_id}: ${err.message}` }] };
      }
    }
  );

  // 4. Send Message
  server.registerTool(
    "gmail_send_message",
    {
      title: "Send email message",
      description: "Send a new email message.\n\nArgs: to (string or array of email addresses), subject (string), body_text (plain text body), body_html (optional HTML body), cc, bcc, thread_id (optional to send in thread), in_reply_to (optional message-ID header for RFC reply threading), references (optional header), attachments (optional array of { filename, mimeType, content [base64] }).\nReturns: sent message metadata.",
      inputSchema: {
        to: z.union([z.string(), z.array(z.string())]).describe("Recipient email address or array of addresses"),
        subject: z.string().describe("Email subject"),
        body_text: z.string().optional().describe("Plain text body content"),
        body_html: z.string().optional().describe("HTML formatted body content"),
        cc: z.union([z.string(), z.array(z.string())]).optional().describe("CC recipient(s)"),
        bcc: z.union([z.string(), z.array(z.string())]).optional().describe("BCC recipient(s)"),
        thread_id: z.string().optional().describe("Thread ID if sending within an existing conversation"),
        in_reply_to: z.string().optional().describe("Message-ID of the email being replied to (for RFC threading)"),
        references: z.string().optional().describe("References header for RFC threading"),
        attachments: z
          .array(
            z.object({
              filename: z.string().describe("Filename including extension"),
              mimeType: z.string().default("application/octet-stream").describe("MIME type (e.g. application/pdf, image/png)"),
              content: z.string().describe("Base64 encoded file data")
            })
          )
          .optional()
          .describe("Files to attach to the email")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ to, subject, body_text, body_html, cc, bcc, thread_id, in_reply_to, references, attachments }) => {
      const settings = getSettings();
      try {
        if (!body_text && !body_html) {
          throw new Error("At least one of 'body_text' or 'body_html' must be provided.");
        }

        const raw = buildRawEmail({
          from: settings.default_from_email || undefined,
          to,
          cc,
          bcc,
          subject,
          text: body_text,
          html: body_html,
          inReplyTo: in_reply_to,
          references,
          attachments: attachments || []
        });

        const reqBody = { raw };
        if (thread_id) reqBody.threadId = thread_id;

        const res = await gmailRequest("/messages/send", { method: "POST", body: reqBody }, settings, fetchJson);

        return {
          content: [
            {
              type: "text",
              text: `✅ Email sent successfully!\n- **Message ID**: \`${res.id}\`\n- **Thread ID**: \`${res.threadId}\`\n- **To**: ${Array.isArray(to) ? to.join(", ") : to}\n- **Subject**: ${subject}`
            }
          ],
          structuredContent: res
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error sending email: ${err.message}` }] };
      }
    }
  );

  // 5. Reply to Message
  server.registerTool(
    "gmail_reply_message",
    {
      title: "Reply to email",
      description: "Conveniently reply to an existing email message. Automatically looks up the recipient, subject ('Re: ...'), thread ID, Message-ID, and References header.\n\nArgs: message_id (ID of message to reply to), body_text, body_html, reply_all (default false), attachments.\nReturns: sent reply metadata.",
      inputSchema: {
        message_id: z.string().describe("The ID of the message to reply to"),
        body_text: z.string().optional().describe("Plain text reply body"),
        body_html: z.string().optional().describe("HTML reply body"),
        reply_all: z.boolean().default(false).describe("If true, reply to sender + original CCs"),
        attachments: z
          .array(
            z.object({
              filename: z.string().describe("Filename"),
              mimeType: z.string().default("application/octet-stream").describe("MIME type"),
              content: z.string().describe("Base64 encoded content")
            })
          )
          .optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ message_id, body_text, body_html, reply_all, attachments }) => {
      const settings = getSettings();
      try {
        const orig = await gmailRequest(`/messages/${encodeURIComponent(message_id)}?format=full`, {}, settings, fetchJson);
        const parsed = parseMessageDetails(orig);

        const replyToAddress = parsed.from;
        let subject = parsed.subject || "";
        if (!subject.toLowerCase().startsWith("re:")) {
          subject = `Re: ${subject}`;
        }

        const inReplyTo = parsed.messageIdHeader || "";
        let references = parsed.references || "";
        if (inReplyTo) {
          references = references ? `${references} ${inReplyTo}` : inReplyTo;
        }

        let cc = undefined;
        if (reply_all && parsed.cc) {
          cc = parsed.cc;
        }

        const raw = buildRawEmail({
          from: settings.default_from_email || undefined,
          to: replyToAddress,
          cc,
          subject,
          text: body_text,
          html: body_html,
          inReplyTo,
          references,
          attachments: attachments || []
        });

        const res = await gmailRequest("/messages/send", { method: "POST", body: { raw, threadId: parsed.threadId } }, settings, fetchJson);

        return {
          content: [
            {
              type: "text",
              text: `✅ Reply sent successfully!\n- **Message ID**: \`${res.id}\`\n- **Thread ID**: \`${res.threadId}\`\n- **To**: ${replyToAddress}\n- **Subject**: ${subject}`
            }
          ],
          structuredContent: res
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error replying to message: ${err.message}` }] };
      }
    }
  );

  // 6. Modify Message Labels (Star, Unstar, Mark Read, Mark Unread, Archive, Custom Label)
  server.registerTool(
    "gmail_modify_message_labels",
    {
      title: "Modify message labels",
      description: "Add or remove labels on a message. Common operations:\n- Mark Read: `remove_label_ids: ['UNREAD']`\n- Mark Unread: `add_label_ids: ['UNREAD']`\n- Star: `add_label_ids: ['STARRED']`\n- Unstar: `remove_label_ids: ['STARRED']`\n- Archive from Inbox: `remove_label_ids: ['INBOX']`\n- Mark as Important: `add_label_ids: ['IMPORTANT']`\n\nArgs: message_id, add_label_ids, remove_label_ids.\nReturns: updated message labels.",
      inputSchema: {
        message_id: z.string().describe("Gmail message ID"),
        add_label_ids: z.array(z.string()).optional().default([]).describe("Label IDs to add (e.g. ['STARRED', 'Label_1'])"),
        remove_label_ids: z.array(z.string()).optional().default([]).describe("Label IDs to remove (e.g. ['UNREAD', 'INBOX'])")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ message_id, add_label_ids, remove_label_ids }) => {
      const settings = getSettings();
      try {
        const res = await gmailRequest(
          `/messages/${encodeURIComponent(message_id)}/modify`,
          {
            method: "POST",
            body: {
              addLabelIds: add_label_ids || [],
              removeLabelIds: remove_label_ids || []
            }
          },
          settings,
          fetchJson
        );

        return {
          content: [
            {
              type: "text",
              text: `✅ Labels updated for message \`${message_id}\`.\n- **Current Labels**: ${(res.labelIds || []).join(", ") || "none"}`
            }
          ],
          structuredContent: res
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error modifying message labels: ${err.message}` }] };
      }
    }
  );

  // 7. Batch Modify Messages
  server.registerTool(
    "gmail_batch_modify_messages",
    {
      title: "Batch modify message labels",
      description: "Add or remove labels across multiple messages at once.\n\nArgs: message_ids (array of message IDs), add_label_ids (array), remove_label_ids (array).\nReturns: status confirmation.",
      inputSchema: {
        message_ids: z.array(z.string()).min(1).describe("Array of message IDs to update"),
        add_label_ids: z.array(z.string()).optional().default([]).describe("Label IDs to add"),
        remove_label_ids: z.array(z.string()).optional().default([]).describe("Label IDs to remove")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ message_ids, add_label_ids, remove_label_ids }) => {
      const settings = getSettings();
      try {
        await gmailRequest(
          "/messages/batchModify",
          {
            method: "POST",
            body: {
              ids: message_ids,
              addLabelIds: add_label_ids || [],
              removeLabelIds: remove_label_ids || []
            }
          },
          settings,
          fetchJson
        );

        return {
          content: [
            {
              type: "text",
              text: `✅ Successfully updated labels on ${message_ids.length} message(s).\n- Added: ${add_label_ids.join(", ") || "none"}\n- Removed: ${remove_label_ids.join(", ") || "none"}`
            }
          ],
          structuredContent: { success: true, count: message_ids.length }
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error batch modifying messages: ${err.message}` }] };
      }
    }
  );

  // 8. Trash / Untrash Message
  server.registerTool(
    "gmail_trash_message",
    {
      title: "Trash or untrash message",
      description: "Move an email message to Trash, or restore it back from Trash.\n\nArgs: message_id (string), untrash (boolean, default false to move to trash).\nReturns: message status.",
      inputSchema: {
        message_id: z.string().describe("Gmail message ID"),
        untrash: z.boolean().default(false).describe("Set to true to restore from trash, false to move to trash")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ message_id, untrash }) => {
      const settings = getSettings();
      try {
        const action = untrash ? "untrash" : "trash";
        const res = await gmailRequest(`/messages/${encodeURIComponent(message_id)}/${action}`, { method: "POST" }, settings, fetchJson);
        return {
          content: [
            {
              type: "text",
              text: untrash ? `✅ Message \`${message_id}\` restored from Trash.` : `🗑️ Message \`${message_id}\` moved to Trash.`
            }
          ],
          structuredContent: res
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error trashing/untrashing message: ${err.message}` }] };
      }
    }
  );

  // 9. Delete Message Permanently
  server.registerTool(
    "gmail_delete_message",
    {
      title: "Permanently delete message",
      description: "Permanently deletes a message by ID. This bypasses the trash and cannot be undone.\n\nArgs: message_id.\nReturns: confirmation.",
      inputSchema: {
        message_id: z.string().describe("Gmail message ID to permanently delete")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ message_id }) => {
      const settings = getSettings();
      try {
        await gmailRequest(`/messages/${encodeURIComponent(message_id)}`, { method: "DELETE" }, settings, fetchJson);
        return {
          content: [{ type: "text", text: `🗑️ Message \`${message_id}\` was permanently deleted.` }],
          structuredContent: { success: true, messageId: message_id }
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error deleting message: ${err.message}` }] };
      }
    }
  );

  // 10. Get Attachment Content
  server.registerTool(
    "gmail_get_attachment",
    {
      title: "Download attachment",
      description: "Retrieve the binary base64 content of an attachment.\n\nArgs: message_id (string), attachment_id (string).\nReturns: attachment metadata and base64 string.",
      inputSchema: {
        message_id: z.string().describe("Gmail message ID containing the attachment"),
        attachment_id: z.string().describe("Attachment ID (obtained via gmail_get_message)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ message_id, attachment_id }) => {
      const settings = getSettings();
      try {
        const res = await gmailRequest(
          `/messages/${encodeURIComponent(message_id)}/attachments/${encodeURIComponent(attachment_id)}`,
          {},
          settings,
          fetchJson
        );

        return {
          content: [
            {
              type: "text",
              text: `📎 Attachment retrieved successfully.\n- Size: ${res.size} bytes\n- Data (base64url): ${res.data ? res.data.slice(0, 100) + "..." : "none"}`
            }
          ],
          structuredContent: {
            size: res.size,
            data: res.data
          }
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error getting attachment: ${err.message}` }] };
      }
    }
  );

  // 11. List Threads
  server.registerTool(
    "gmail_list_threads",
    {
      title: "List conversation threads",
      description: "Search and list email threads/conversations.\n\nArgs: query (e.g. 'is:unread', 'label:INBOX'), label_ids, max_results (1-100, default 20), page_token, include_spam_trash.\nReturns: list of threads with ID, snippet, and historyId.",
      inputSchema: {
        query: z.string().optional().describe("Gmail search query"),
        label_ids: z.array(z.string()).optional().describe("Filter by label IDs"),
        max_results: z.number().int().min(1).max(100).default(20).describe("Max threads to return"),
        page_token: z.string().optional().describe("Token for pagination"),
        include_spam_trash: z.boolean().default(false).describe("Include threads from SPAM and TRASH")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ query, label_ids, max_results, page_token, include_spam_trash }) => {
      const settings = getSettings();
      try {
        const params = new URLSearchParams({
          maxResults: String(max_results),
          includeSpamTrash: String(include_spam_trash)
        });
        if (query) params.set("q", query);
        if (page_token) params.set("pageToken", page_token);
        if (label_ids && label_ids.length > 0) {
          label_ids.forEach((id) => params.append("labelIds", id));
        }

        const res = await gmailRequest(`/threads?${params.toString()}`, {}, settings, fetchJson);
        const threads = res.threads || [];

        if (threads.length === 0) {
          return {
            content: [{ type: "text", text: "No threads found matching criteria." }],
            structuredContent: { threads: [], nextPageToken: res.nextPageToken }
          };
        }

        let text = `### Found ${threads.length} Thread(s)${res.nextPageToken ? ` (Next page available)` : ""}\n\n`;
        text += threads
          .map(
            (t, idx) =>
              `${idx + 1}. **Thread ID**: \`${t.id}\`\n   - **Snippet**: ${t.snippet}\n   - **History ID**: \`${t.historyId}\``
          )
          .join("\n\n");

        return {
          content: [{ type: "text", text: truncate(text) }],
          structuredContent: { threads, nextPageToken: res.nextPageToken, resultSizeEstimate: res.resultSizeEstimate }
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error listing threads: ${err.message}` }] };
      }
    }
  );

  // 12. Get Full Thread
  server.registerTool(
    "gmail_get_thread",
    {
      title: "Get full conversation thread",
      description: "Retrieve all messages in a conversation thread in chronological order.\n\nArgs: thread_id (string, required).\nReturns: thread messages and metadata.",
      inputSchema: {
        thread_id: z.string().describe("Gmail thread ID")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ thread_id }) => {
      const settings = getSettings();
      try {
        const res = await gmailRequest(`/threads/${encodeURIComponent(thread_id)}?format=full`, {}, settings, fetchJson);
        const messages = (res.messages || []).map(parseMessageDetails);

        let text = `### Thread \`${res.id}\` (${messages.length} message${messages.length === 1 ? "" : "s"})\n\n`;
        messages.forEach((m, idx) => {
          text += `#### Message ${idx + 1} (${m.id})\n`;
          text += `- **From**: ${m.from}\n`;
          text += `- **To**: ${m.to}\n`;
          text += `- **Date**: ${m.date}\n`;
          text += `- **Subject**: ${m.subject}\n`;
          if (m.attachments.length > 0) {
            text += `- **Attachments**: ${m.attachments.map((a) => a.filename).join(", ")}\n`;
          }
          text += `\n${m.textBody || m.snippet || "(No content)"}\n\n---\n\n`;
        });

        return {
          content: [{ type: "text", text: truncate(text) }],
          structuredContent: { id: res.id, historyId: res.historyId, messages }
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error fetching thread ${thread_id}: ${err.message}` }] };
      }
    }
  );

  // 13. Modify Thread Labels
  server.registerTool(
    "gmail_modify_thread_labels",
    {
      title: "Modify thread labels",
      description: "Add or remove labels across an entire thread/conversation.\n\nArgs: thread_id, add_label_ids, remove_label_ids.\nReturns: updated thread metadata.",
      inputSchema: {
        thread_id: z.string().describe("Gmail thread ID"),
        add_label_ids: z.array(z.string()).optional().default([]).describe("Label IDs to add"),
        remove_label_ids: z.array(z.string()).optional().default([]).describe("Label IDs to remove")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ thread_id, add_label_ids, remove_label_ids }) => {
      const settings = getSettings();
      try {
        const res = await gmailRequest(
          `/threads/${encodeURIComponent(thread_id)}/modify`,
          {
            method: "POST",
            body: {
              addLabelIds: add_label_ids || [],
              removeLabelIds: remove_label_ids || []
            }
          },
          settings,
          fetchJson
        );

        return {
          content: [
            {
              type: "text",
              text: `✅ Labels updated for thread \`${thread_id}\`.\n- Added: ${add_label_ids.join(", ") || "none"}\n- Removed: ${remove_label_ids.join(", ") || "none"}`
            }
          ],
          structuredContent: res
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error modifying thread labels: ${err.message}` }] };
      }
    }
  );

  // 14. Trash / Untrash Thread
  server.registerTool(
    "gmail_trash_thread",
    {
      title: "Trash or untrash thread",
      description: "Move an entire thread to Trash, or restore it from Trash.\n\nArgs: thread_id (string), untrash (boolean, default false).\nReturns: thread status.",
      inputSchema: {
        thread_id: z.string().describe("Gmail thread ID"),
        untrash: z.boolean().default(false).describe("Set to true to restore from trash, false to move to trash")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ thread_id, untrash }) => {
      const settings = getSettings();
      try {
        const action = untrash ? "untrash" : "trash";
        const res = await gmailRequest(`/threads/${encodeURIComponent(thread_id)}/${action}`, { method: "POST" }, settings, fetchJson);
        return {
          content: [
            {
              type: "text",
              text: untrash ? `✅ Thread \`${thread_id}\` restored from Trash.` : `🗑️ Thread \`${thread_id}\` moved to Trash.`
            }
          ],
          structuredContent: res
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error trashing/untrashing thread: ${err.message}` }] };
      }
    }
  );

  // 15. Delete Thread Permanently
  server.registerTool(
    "gmail_delete_thread",
    {
      title: "Permanently delete thread",
      description: "Permanently delete an entire thread and all messages inside it (cannot be undone).\n\nArgs: thread_id.\nReturns: confirmation.",
      inputSchema: {
        thread_id: z.string().describe("Gmail thread ID")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ thread_id }) => {
      const settings = getSettings();
      try {
        await gmailRequest(`/threads/${encodeURIComponent(thread_id)}`, { method: "DELETE" }, settings, fetchJson);
        return {
          content: [{ type: "text", text: `🗑️ Thread \`${thread_id}\` was permanently deleted.` }],
          structuredContent: { success: true, threadId: thread_id }
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error deleting thread: ${err.message}` }] };
      }
    }
  );

  // 16. List Drafts
  server.registerTool(
    "gmail_list_drafts",
    {
      title: "List drafts",
      description: "List draft emails in the mailbox.\n\nArgs: query, max_results (1-100, default 20), page_token, include_spam_trash.\nReturns: list of drafts with ID and message snippets.",
      inputSchema: {
        query: z.string().optional().describe("Search query filter for drafts"),
        max_results: z.number().int().min(1).max(100).default(20).describe("Max drafts to return"),
        page_token: z.string().optional().describe("Token for pagination"),
        include_spam_trash: z.boolean().default(false).describe("Include drafts from spam and trash")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ query, max_results, page_token, include_spam_trash }) => {
      const settings = getSettings();
      try {
        const params = new URLSearchParams({
          maxResults: String(max_results),
          includeSpamTrash: String(include_spam_trash)
        });
        if (query) params.set("q", query);
        if (page_token) params.set("pageToken", page_token);

        const res = await gmailRequest(`/drafts?${params.toString()}`, {}, settings, fetchJson);
        const drafts = res.drafts || [];

        if (drafts.length === 0) {
          return {
            content: [{ type: "text", text: "No drafts found." }],
            structuredContent: { drafts: [], nextPageToken: res.nextPageToken }
          };
        }

        let text = `### Found ${drafts.length} Draft(s)\n\n`;
        text += drafts
          .map(
            (d, idx) =>
              `${idx + 1}. **Draft ID**: \`${d.id}\` | **Message ID**: \`${d.message?.id}\`\n   - **Snippet**: ${d.message?.snippet || "(empty draft)"}`
          )
          .join("\n\n");

        return {
          content: [{ type: "text", text: truncate(text) }],
          structuredContent: { drafts, nextPageToken: res.nextPageToken }
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error listing drafts: ${err.message}` }] };
      }
    }
  );

  // 17. Get Draft Details
  server.registerTool(
    "gmail_get_draft",
    {
      title: "Get draft details",
      description: "Retrieve a specific draft email by draft ID.\n\nArgs: draft_id (string, required).\nReturns: draft details and message contents.",
      inputSchema: {
        draft_id: z.string().describe("Gmail draft ID")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ draft_id }) => {
      const settings = getSettings();
      try {
        const res = await gmailRequest(`/drafts/${encodeURIComponent(draft_id)}?format=full`, {}, settings, fetchJson);
        const parsed = parseMessageDetails(res.message || {});

        let text = `### Draft \`${res.id}\`\n`;
        text += `- **To**: ${parsed.to || "(none)"}\n`;
        text += `- **Subject**: ${parsed.subject || "(no subject)"}\n`;
        if (parsed.cc) text += `- **Cc**: ${parsed.cc}\n`;
        if (parsed.bcc) text += `- **Bcc**: ${parsed.bcc}\n`;
        text += `\n**Body**:\n${parsed.textBody || parsed.htmlBody || parsed.snippet || "(Empty)"}`;

        return {
          content: [{ type: "text", text: truncate(text) }],
          structuredContent: { id: res.id, message: parsed }
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error fetching draft ${draft_id}: ${err.message}` }] };
      }
    }
  );

  // 18. Create Draft
  server.registerTool(
    "gmail_create_draft",
    {
      title: "Create draft email",
      description: "Create a new draft email without sending it.\n\nArgs: to, subject, body_text, body_html, cc, bcc, thread_id, attachments.\nReturns: created draft metadata.",
      inputSchema: {
        to: z.union([z.string(), z.array(z.string())]).optional().describe("Recipient email address(es)"),
        subject: z.string().optional().default("").describe("Email subject"),
        body_text: z.string().optional().describe("Plain text draft body"),
        body_html: z.string().optional().describe("HTML draft body"),
        cc: z.union([z.string(), z.array(z.string())]).optional().describe("CC recipients"),
        bcc: z.union([z.string(), z.array(z.string())]).optional().describe("BCC recipients"),
        thread_id: z.string().optional().describe("Thread ID if this draft belongs to a conversation"),
        attachments: z
          .array(
            z.object({
              filename: z.string().describe("Filename"),
              mimeType: z.string().default("application/octet-stream").describe("MIME type"),
              content: z.string().describe("Base64 content")
            })
          )
          .optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ to, subject, body_text, body_html, cc, bcc, thread_id, attachments }) => {
      const settings = getSettings();
      try {
        const raw = buildRawEmail({
          from: settings.default_from_email || undefined,
          to,
          cc,
          bcc,
          subject,
          text: body_text || "",
          html: body_html || "",
          attachments: attachments || []
        });

        const msgPayload = { raw };
        if (thread_id) msgPayload.threadId = thread_id;

        const res = await gmailRequest(
          "/drafts",
          {
            method: "POST",
            body: { message: msgPayload }
          },
          settings,
          fetchJson
        );

        return {
          content: [
            {
              type: "text",
              text: `✅ Draft created successfully!\n- **Draft ID**: \`${res.id}\`\n- **Message ID**: \`${res.message?.id}\`\n- **Subject**: ${subject || "(no subject)"}`
            }
          ],
          structuredContent: res
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error creating draft: ${err.message}` }] };
      }
    }
  );

  // 19. Update Draft
  server.registerTool(
    "gmail_update_draft",
    {
      title: "Update draft email",
      description: "Replace/update the contents of an existing draft.\n\nArgs: draft_id (required), to, subject, body_text, body_html, cc, bcc, thread_id, attachments.\nReturns: updated draft metadata.",
      inputSchema: {
        draft_id: z.string().describe("Gmail draft ID to update"),
        to: z.union([z.string(), z.array(z.string())]).optional().describe("Recipient(s)"),
        subject: z.string().optional().describe("Email subject"),
        body_text: z.string().optional().describe("Plain text body"),
        body_html: z.string().optional().describe("HTML body"),
        cc: z.union([z.string(), z.array(z.string())]).optional().describe("CC"),
        bcc: z.union([z.string(), z.array(z.string())]).optional().describe("BCC"),
        thread_id: z.string().optional().describe("Thread ID"),
        attachments: z
          .array(
            z.object({
              filename: z.string().describe("Filename"),
              mimeType: z.string().default("application/octet-stream").describe("MIME type"),
              content: z.string().describe("Base64 content")
            })
          )
          .optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ draft_id, to, subject, body_text, body_html, cc, bcc, thread_id, attachments }) => {
      const settings = getSettings();
      try {
        const raw = buildRawEmail({
          from: settings.default_from_email || undefined,
          to,
          cc,
          bcc,
          subject,
          text: body_text || "",
          html: body_html || "",
          attachments: attachments || []
        });

        const msgPayload = { raw };
        if (thread_id) msgPayload.threadId = thread_id;

        const res = await gmailRequest(
          `/drafts/${encodeURIComponent(draft_id)}`,
          {
            method: "PUT",
            body: { message: msgPayload }
          },
          settings,
          fetchJson
        );

        return {
          content: [
            {
              type: "text",
              text: `✅ Draft \`${draft_id}\` updated successfully.`
            }
          ],
          structuredContent: res
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error updating draft: ${err.message}` }] };
      }
    }
  );

  // 20. Send Draft
  server.registerTool(
    "gmail_send_draft",
    {
      title: "Send draft email",
      description: "Send an existing draft email.\n\nArgs: draft_id (string, required).\nReturns: sent message details.",
      inputSchema: {
        draft_id: z.string().describe("Gmail draft ID to send")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ draft_id }) => {
      const settings = getSettings();
      try {
        const res = await gmailRequest(
          "/drafts/send",
          {
            method: "POST",
            body: { id: draft_id }
          },
          settings,
          fetchJson
        );

        return {
          content: [
            {
              type: "text",
              text: `✅ Draft \`${draft_id}\` sent successfully!\n- **Message ID**: \`${res.id}\`\n- **Thread ID**: \`${res.threadId}\``
            }
          ],
          structuredContent: res
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error sending draft: ${err.message}` }] };
      }
    }
  );

  // 21. Delete Draft
  server.registerTool(
    "gmail_delete_draft",
    {
      title: "Delete draft",
      description: "Permanently delete/discard a draft email.\n\nArgs: draft_id.\nReturns: confirmation.",
      inputSchema: {
        draft_id: z.string().describe("Gmail draft ID to delete")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ draft_id }) => {
      const settings = getSettings();
      try {
        await gmailRequest(`/drafts/${encodeURIComponent(draft_id)}`, { method: "DELETE" }, settings, fetchJson);
        return {
          content: [{ type: "text", text: `🗑️ Draft \`${draft_id}\` was deleted.` }],
          structuredContent: { success: true, draftId: draft_id }
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error deleting draft: ${err.message}` }] };
      }
    }
  );

  // 22. List Labels
  server.registerTool(
    "gmail_list_labels",
    {
      title: "List mailbox labels",
      description: "List all system and user labels in the Gmail account.\n\nReturns: list of labels with ID, name, type (system/user), and message counts.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async () => {
      const settings = getSettings();
      try {
        const res = await gmailRequest("/labels", {}, settings, fetchJson);
        const labels = res.labels || [];

        let text = `### Gmail Labels (${labels.length})\n\n`;
        text += labels
          .map((l) => `- **${l.name}** (\`${l.id}\`) — Type: \`${l.type}\``)
          .join("\n");

        return {
          content: [{ type: "text", text: truncate(text) }],
          structuredContent: { labels }
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error listing labels: ${err.message}` }] };
      }
    }
  );

  // 23. Manage Label (Create / Update / Delete)
  server.registerTool(
    "gmail_manage_label",
    {
      title: "Manage mailbox label",
      description: "Create, update, or delete a user label in Gmail.\n\nArgs: action ('create' | 'update' | 'delete'), name (label name for create/update), label_id (required for update/delete), label_list_visibility ('labelShow' | 'labelHide'), message_list_visibility ('show' | 'hide').\nReturns: label metadata or deletion status.",
      inputSchema: {
        action: z.enum(["create", "update", "delete"]).describe("Action to perform"),
        label_id: z.string().optional().describe("Label ID (required for update or delete)"),
        name: z.string().optional().describe("Display name for the label (required for create)"),
        label_list_visibility: z.enum(["labelShow", "labelShowIfUnread", "labelHide"]).optional().describe("Show in label list"),
        message_list_visibility: z.enum(["show", "hide"]).optional().describe("Show in message list")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ action, label_id, name, label_list_visibility, message_list_visibility }) => {
      const settings = getSettings();
      try {
        if (action === "create") {
          if (!name) throw new Error("Label 'name' is required when creating a label.");
          const body = { name };
          if (label_list_visibility) body.labelListVisibility = label_list_visibility;
          if (message_list_visibility) body.messageListVisibility = message_list_visibility;

          const res = await gmailRequest("/labels", { method: "POST", body }, settings, fetchJson);
          return {
            content: [{ type: "text", text: `✅ Created label **${res.name}** with ID \`${res.id}\`.` }],
            structuredContent: res
          };
        }

        if (action === "update") {
          if (!label_id) throw new Error("Label 'label_id' is required when updating a label.");
          const body = {};
          if (name) body.name = name;
          if (label_list_visibility) body.labelListVisibility = label_list_visibility;
          if (message_list_visibility) body.messageListVisibility = message_list_visibility;

          const res = await gmailRequest(`/labels/${encodeURIComponent(label_id)}`, { method: "PATCH", body }, settings, fetchJson);
          return {
            content: [{ type: "text", text: `✅ Updated label \`${label_id}\` (${res.name}).` }],
            structuredContent: res
          };
        }

        if (action === "delete") {
          if (!label_id) throw new Error("Label 'label_id' is required when deleting a label.");
          await gmailRequest(`/labels/${encodeURIComponent(label_id)}`, { method: "DELETE" }, settings, fetchJson);
          return {
            content: [{ type: "text", text: `🗑️ Deleted label \`${label_id}\`.` }],
            structuredContent: { success: true, labelId: label_id }
          };
        }
      } catch (err) {
        return { content: [{ type: "text", text: `Error managing label: ${err.message}` }] };
      }
    }
  );

  // 24. Get Vacation Responder Settings
  server.registerTool(
    "gmail_get_vacation_settings",
    {
      title: "Get vacation responder settings",
      description: "Get the current out-of-office / vacation auto-responder settings.\n\nReturns: enableAutoReply, responseSubject, responseBodyPlainText, responseBodyHtml, restrictToContacts, restrictToDomain, startTime, endTime.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async () => {
      const settings = getSettings();
      try {
        const res = await gmailRequest("/settings/vacation", {}, settings, fetchJson);
        const text = `**Vacation Auto-Responder**\n- Enabled: \`${res.enableAutoReply}\`\n- Subject: ${res.responseSubject || "(none)"}\n- Restrict to Contacts: \`${res.restrictToContacts}\`\n- Restrict to Domain: \`${res.restrictToDomain}\`\n- Start Time: ${res.startTime ? new Date(parseInt(res.startTime, 10)).toLocaleString() : "(not set)"}\n- End Time: ${res.endTime ? new Date(parseInt(res.endTime, 10)).toLocaleString() : "(not set)"}\n\n**Response Message**:\n${res.responseBodyPlainText || res.responseBodyHtml || "(empty)"}`;

        return { content: [{ type: "text", text }], structuredContent: res };
      } catch (err) {
        return { content: [{ type: "text", text: `Error getting vacation settings: ${err.message}` }] };
      }
    }
  );

  // 25. Set Vacation Responder Settings
  server.registerTool(
    "gmail_set_vacation_settings",
    {
      title: "Configure vacation responder",
      description: "Enable, disable, or update the vacation auto-responder settings.\n\nArgs: enable_auto_reply (boolean, required), response_subject, response_body_plain_text, response_body_html, restrict_to_contacts, restrict_to_domain, start_time_ms, end_time_ms.\nReturns: updated settings.",
      inputSchema: {
        enable_auto_reply: z.boolean().describe("Whether auto-reply is currently enabled"),
        response_subject: z.string().optional().describe("Subject line of vacation reply"),
        response_body_plain_text: z.string().optional().describe("Plain text body of vacation reply"),
        response_body_html: z.string().optional().describe("HTML body of vacation reply"),
        restrict_to_contacts: z.boolean().optional().describe("Only send to people in your Google Contacts"),
        restrict_to_domain: z.boolean().optional().describe("Only send to people in your Google Workspace domain"),
        start_time_ms: z.number().int().optional().describe("Start time in epoch milliseconds"),
        end_time_ms: z.number().int().optional().describe("End time in epoch milliseconds")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ enable_auto_reply, response_subject, response_body_plain_text, response_body_html, restrict_to_contacts, restrict_to_domain, start_time_ms, end_time_ms }) => {
      const settings = getSettings();
      try {
        const body = {
          enableAutoReply: enable_auto_reply
        };
        if (response_subject !== undefined) body.responseSubject = response_subject;
        if (response_body_plain_text !== undefined) body.responseBodyPlainText = response_body_plain_text;
        if (response_body_html !== undefined) body.responseBodyHtml = response_body_html;
        if (restrict_to_contacts !== undefined) body.restrictToContacts = restrict_to_contacts;
        if (restrict_to_domain !== undefined) body.restrictToDomain = restrict_to_domain;
        if (start_time_ms !== undefined) body.startTime = String(start_time_ms);
        if (end_time_ms !== undefined) body.endTime = String(end_time_ms);

        const res = await gmailRequest("/settings/vacation", { method: "PUT", body }, settings, fetchJson);

        return {
          content: [
            {
              type: "text",
              text: `✅ Vacation responder updated.\n- **Enabled**: \`${res.enableAutoReply}\`\n- **Subject**: ${res.responseSubject || "(none)"}`
            }
          ],
          structuredContent: res
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error updating vacation settings: ${err.message}` }] };
      }
    }
  );
}

// UI Test Button Handler
async function testService(settings, { fetchJson }) {
  const missing = configurationError("gmail", settings);
  if (missing) return { ok: false, message: `${missing}. Open Settings.` };
  try {
    const token = await getAccessToken(settings, fetchJson);
    const res = await fetchJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });

    if (res && res.emailAddress) {
      return { ok: true, message: `Connected to Gmail as ${res.emailAddress} (${res.messagesTotal} messages)` };
    }
    return { ok: false, message: `Unexpected profile response: ${JSON.stringify(res)}` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

/** UI connectivity checks never expose provider bodies or account/session details. */
export async function test(settings, context = {}) {
  const missing = configurationError("gmail", settings);
  if (missing) return { ok: false, message: `${missing}. Open Settings.` };
  try {
    const result = await testService(settings, context);
    return result.ok ? { ok: true, message: "Connection successful." } :
      { ok: false, message: "Connection failed. Check Settings, permissions and service availability." };
  } catch {
    return { ok: false, message: "Connection failed. Check Settings, permissions and service availability." };
  }
}
