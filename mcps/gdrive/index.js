import { createHash } from "node:crypto";
import { configurationError, guardedServer } from "./bundle.js";
// Google Drive MCP Module for MCP Station
// Implements Google Drive API v3 with multi-account support (up to 3 accounts)

const tokenCache = new Map();

function cleanVal(str) {
  if (!str || typeof str !== "string") return "";
  let s = str.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function getActiveAccounts(settings) {
  const accounts = [];
  for (let i = 1; i <= 3; i++) {
    const rawEnabled = settings[`account${i}_enabled`];
    const isEnabled = rawEnabled !== "disabled" && rawEnabled !== false && rawEnabled !== "false";
    const name = cleanVal(settings[`account${i}_name`]) || `Account ${i}`;
    let refreshToken = cleanVal(settings[`account${i}_refresh_token`]);
    // fallback: if account 1 refresh token is empty, check legacy settings.refresh_token
    if (i === 1 && !refreshToken) {
      refreshToken = cleanVal(settings.refresh_token);
    }

    if (isEnabled && refreshToken) {
      accounts.push({
        index: i,
        key: `account${i}`,
        name,
        refreshToken
      });
    }
  }
  return accounts;
}

function resolveAccount(settings, requestedAccount) {
  const active = getActiveAccounts(settings);
  if (active.length === 0) {
    const directToken = cleanVal(settings.access_token);
    if (directToken) {
      return { index: 0, key: "direct_access_token", name: "Direct Token", isDirect: true, token: directToken };
    }
    throw new Error(
      "No active Google Drive accounts configured. Please configure client_id, client_secret, and paste a refresh token for at least one enabled account in Settings."
    );
  }

  if (requestedAccount === undefined || requestedAccount === null || requestedAccount === "") {
    return active[0];
  }

  const reqStr = String(requestedAccount).trim().toLowerCase();

  // 1. Match exact index ("1", "2", "3")
  const byExactIndex = active.find((a) => String(a.index) === reqStr);
  if (byExactIndex) return byExactIndex;

  // 2. Match exact key ("account1", "account2", "account3")
  const byExactKey = active.find((a) => a.key.toLowerCase() === reqStr);
  if (byExactKey) return byExactKey;

  // 3. Match explicit slot names ("account 1", "account 2", "account 3", "slot 1", "slot 2", "slot 3")
  const bySlot = active.find(
    (a) =>
      `account ${a.index}`.toLowerCase() === reqStr ||
      `account_${a.index}`.toLowerCase() === reqStr ||
      `slot ${a.index}`.toLowerCase() === reqStr ||
      `slot_${a.index}`.toLowerCase() === reqStr
  );
  if (bySlot) return bySlot;

  // 4. Match exact custom account name (case-insensitive)
  const byExactName = active.find((a) => a.name.trim().toLowerCase() === reqStr);
  if (byExactName) return byExactName;

  // 5. Match partial custom name only if unambiguous
  const matchingPartials = active.filter((a) => a.name.toLowerCase().includes(reqStr));
  if (matchingPartials.length === 1) {
    return matchingPartials[0];
  }

  const availableNames = active.map((a) => `"${a.name}" (Account ${a.index})`).join(", ");
  throw new Error(`Account "${requestedAccount}" not found or disabled. Available enabled accounts: ${availableNames}`);
}

async function getAccessToken(settings, fetchJson, requestedAccount) {
  const account = resolveAccount(settings, requestedAccount);
  if (account.isDirect) {
    return { token: account.token, account };
  }

  const clientId = cleanVal(settings.client_id);
  const clientSecret = cleanVal(settings.client_secret);

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing OAuth Client ID or Client Secret in Settings. Google requires client_id and client_secret to exchange refresh tokens for access tokens."
    );
  }

  const now = Date.now();
  const cacheKey = createHash("sha256").update(JSON.stringify([clientId, clientSecret, account.refreshToken])).digest("hex");
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > now + 60000) {
    return { token: cached.token, account };
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: account.refreshToken,
    grant_type: "refresh_token"
  });

  try {
    const res = await fetchJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });

    if (res && res.access_token) {
      const token = res.access_token;
      if (tokenCache.size >= 32) tokenCache.clear();
      tokenCache.set(cacheKey, {
        token,
        expiresAt: Date.now() + (res.expires_in || 3600) * 1000
      });
      return { token, account };
    }

    throw new Error(
      res?.error_description || res?.error || "Token response did not contain access_token"
    );
  } catch (err) {
    tokenCache.delete(cacheKey);
    let extra = "";
    const msg = err.message || String(err);
    if (msg.includes("invalid_grant")) {
      extra = " (The refresh token is invalid, expired, revoked, or belongs to a different client_id/secret).";
    } else if (msg.includes("invalid_client") || msg.includes("unauthorized_client")) {
      extra = " (The client_id or client_secret is incorrect or does not match this token).";
    }
    throw new Error(`[${account.name} / Account ${account.index}] Token refresh failed: ${msg}${extra}`);
  }
}

async function gdriveRequest(endpoint, { method = "GET", body = null, headers = {}, isUpload = false } = {}, settings, fetchJson, requestedAccount) {
  const { token, account } = await getAccessToken(settings, fetchJson, requestedAccount);
  const base = isUpload ? "https://www.googleapis.com/upload/drive/v3" : "https://www.googleapis.com/drive/v3";
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

  const data = await fetchJson(url, {
    method,
    headers: reqHeaders,
    body: reqBody
  });

  return { data, account };
}

function truncate(str, max = 50000) {
  if (typeof str !== "string") return str;
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n\n… [Output truncated at ${max} characters. Use specific query/filters to narrow results]`;
}

export function register({ server, z, getSettings, log, fetchJson }) {
  server = guardedServer(server, "gdrive", getSettings, []);
  // 0. List Configured Accounts
  server.registerTool(
    "gdrive_list_accounts",
    {
      title: "List configured Google Drive accounts",
      description: "List all configured Google Drive accounts, their status (enabled/disabled), and which one is active by default.\n\nReturns: list of accounts with index, name, and enabled status.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      const settings = getSettings();
      const active = getActiveAccounts(settings);
      const allSlots = [];

      for (let i = 1; i <= 3; i++) {
        const isEnabled = settings[`account${i}_enabled`] !== "disabled";
        const name = (settings[`account${i}_name`] || `Account ${i}`).trim();
        const hasToken = Boolean(settings[`account${i}_refresh_token`] || (i === 1 && settings.refresh_token));
        allSlots.push({
          index: i,
          name,
          enabled: isEnabled,
          configured: hasToken,
          isDefault: active.length > 0 && active[0].index === i
        });
      }

      if (allSlots.every((s) => !s.configured) && settings.access_token) {
        allSlots.push({
          index: 0,
          name: "Direct Access Token",
          enabled: true,
          configured: true,
          isDefault: true
        });
      }

      const formatted = allSlots
        .map(
          (s) =>
            `- **Slot ${s.index}**: ${s.name} | Status: **${s.enabled ? (s.configured ? "ENABLED & READY" : "ENABLED (missing refresh token)") : "DISABLED"}**${
              s.isDefault ? " ⭐ [DEFAULT]" : ""
            }`
        )
        .join("\n");

      const text = `### Google Drive Accounts\n\n${formatted}\n\n*Note: Use the \`account\` argument in any tool to target a specific account (e.g., \`account: "${active[0]?.name || "1"}"\` or \`account: "1"\`). If omitted, the default account is used.*`;

      return { content: [{ type: "text", text }], structuredContent: { accounts: allSlots } };
    }
  );

  // 1. List / Search Files
  server.registerTool(
    "gdrive_list_files",
    {
      title: "List & search files",
      description:
        "Search and list files, folders, spreadsheets, and documents in Google Drive.\n\nArgs: query (optional Drive q query), folder_id (optional folder filter), account (optional account name/number), page_size (1-100, default 25), page_token, order_by (e.g. 'folder,modifiedTime desc'), include_trashed (default false), drive_id, include_items_from_all_drives.\nReturns: list of files with id, name, mimeType, size, modifiedTime, webViewLink, parents.",
      inputSchema: {
        account: z.string().optional().describe("Account name or number (1, 2, 3) to execute against. Defaults to first enabled account."),
        query: z.string().optional().describe("Google Drive query filter (e.g. \"name contains 'budget'\", \"mimeType = 'application/vnd.google-apps.folder'\")"),
        folder_id: z.string().optional().describe("Filter directly by parent folder ID (shorthand for '<folder_id>' in parents)"),
        page_size: z.number().int().min(1).max(100).default(25).describe("Maximum number of files to return (1-100)"),
        page_token: z.string().optional().describe("Page token from previous result for pagination"),
        order_by: z.string().optional().describe("Sort order (e.g. 'folder,modifiedTime desc', 'name', 'viewedByMeTime desc'). Defaults to 'folder,modifiedTime desc' for normal queries. Automatically omitted if empty or if query uses 'fullText contains' (since Google Drive rejects orderBy on full-text search)."),
        include_trashed: z.boolean().default(false).describe("Whether to include files in the trash"),
        drive_id: z.string().optional().describe("Specific Shared Drive ID to search"),
        include_items_from_all_drives: z.boolean().default(true).describe("Whether to include items from both personal and shared drives")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (args) => {
      const settings = getSettings();
      try {
        const queryParts = [];
        if (!args.include_trashed) queryParts.push("trashed = false");
        if (args.folder_id) queryParts.push(`'${args.folder_id.replace(/'/g, "\\'")}' in parents`);
        if (args.query) queryParts.push(`(${args.query})`);

        const q = queryParts.join(" and ");
        const isFullText = q.toLowerCase().includes("fulltext");

        const params = new URLSearchParams({
          pageSize: String(args.page_size || 25),
          fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,webViewLink,webContentLink,parents,owners(displayName,emailAddress),starred,trashed,iconLink,description)",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: String(args.include_items_from_all_drives ?? true)
        });

        // Set orderBy only when not searching fullText and non-empty
        if (args.order_by !== undefined) {
          const trimmed = String(args.order_by).trim();
          if (trimmed && trimmed.toLowerCase() !== "none" && !isFullText) {
            params.set("orderBy", trimmed);
          }
        } else if (!isFullText) {
          params.set("orderBy", "folder,modifiedTime desc");
        }

        if (q) params.set("q", q);
        if (args.page_token) params.set("pageToken", args.page_token);
        if (args.drive_id) {
          params.set("driveId", args.drive_id);
          params.set("corpora", "drive");
        }

        const { data, account } = await gdriveRequest(`/files?${params.toString()}`, { method: "GET" }, settings, fetchJson, args.account);
        const files = data.files || [];

        if (files.length === 0) {
          return { content: [{ type: "text", text: `[Account: ${account.name}] No files found matching criteria.` }], structuredContent: data };
        }

        const formatted = files
          .map((f) => {
            const isFolder = f.mimeType === "application/vnd.google-apps.folder";
            const sizeStr = f.size ? ` | ${Math.round(f.size / 1024)} KB` : "";
            const owner = f.owners?.[0]?.displayName ? ` | owner: ${f.owners[0].displayName}` : "";
            return `- [${isFolder ? "📁 FOLDER" : "📄 FILE"}] ${f.name} (id: ${f.id})\n  Type: ${f.mimeType}${sizeStr}${owner}\n  Modified: ${f.modifiedTime || "N/A"}\n  Link: ${f.webViewLink || "N/A"}`;
          })
          .join("\n\n");

        const text = `[Account: ${account.name}] Found ${files.length} file(s)${data.nextPageToken ? ` (Next page token: ${data.nextPageToken})` : ""}:\n\n${formatted}`;
        return { content: [{ type: "text", text: truncate(text) }], structuredContent: data };
      } catch (err) {
        return { content: [{ type: "text", text: `Error listing files: ${err.message}` }] };
      }
    }
  );

  // 2. Get File Metadata
  server.registerTool(
    "gdrive_get_file_metadata",
    {
      title: "Get file metadata",
      description: "Get detailed metadata for a file or folder in Google Drive.\n\nArgs: file_id (string), account (optional account name/number).\nReturns: file name, MIME type, size, modification dates, permissions, web view link, export links, parent IDs.",
      inputSchema: {
        file_id: z.string().min(1).describe("ID of the file or folder"),
        account: z.string().optional().describe("Account name or number (1, 2, 3) to execute against. Defaults to first enabled account."),
        supports_all_drives: z.boolean().default(true).describe("Whether to support shared drives")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ file_id, account: reqAccount, supports_all_drives }) => {
      const settings = getSettings();
      try {
        const fields = "id,name,mimeType,description,starred,trashed,parents,properties,appProperties,spaces,version,webContentLink,webViewLink,iconLink,hasThumbnail,thumbnailLink,createdTime,modifiedTime,modifiedByMeTime,viewedByMeTime,shared,owners,lastModifyingUser,sharingUser,permissions,size,quotaBytesUsed,exportLinks";
        const params = new URLSearchParams({
          fields,
          supportsAllDrives: String(supports_all_drives)
        });

        const { data: file, account } = await gdriveRequest(`/files/${encodeURIComponent(file_id)}?${params.toString()}`, { method: "GET" }, settings, fetchJson, reqAccount);
        const text = `### File Metadata: ${file.name} [Account: ${account.name}]\n- **ID**: ${file.id}\n- **MIME Type**: ${file.mimeType}\n- **Size**: ${file.size ? `${(file.size / 1024).toFixed(1)} KB` : "N/A"}\n- **Created**: ${file.createdTime}\n- **Modified**: ${file.modifiedTime}\n- **Parents**: ${(file.parents || []).join(", ") || "Root"}\n- **Owners**: ${(file.owners || []).map((o) => `${o.displayName} (${o.emailAddress})`).join(", ")}\n- **Trashed**: ${file.trashed ? "Yes" : "No"}\n- **Web View Link**: ${file.webViewLink || "N/A"}\n- **Description**: ${file.description || "None"}`;

        return { content: [{ type: "text", text }], structuredContent: file };
      } catch (err) {
        return { content: [{ type: "text", text: `Error fetching metadata for file ${file_id}: ${err.message}` }] };
      }
    }
  );

  // 3. Read File Content or Export Google Workspace Doc
  server.registerTool(
    "gdrive_read_file_content",
    {
      title: "Read or export file content",
      description: "Read the text content of a file or automatically export Google Docs, Sheets, or Slides.\n\nGoogle Docs -> Markdown / Plain text\nGoogle Sheets -> CSV (or TSV)\nGoogle Slides -> Plain text\nPDFs & Images -> Embedded MCP resource / image block with full base64 data\nRegular files -> raw text.\n\nArgs: file_id (string), account (optional account name/number), export_mime_type (optional string), max_bytes (default 50000000).",
      inputSchema: {
        file_id: z.string().min(1).describe("ID of the file to read or export"),
        account: z.string().optional().describe("Account name or number (1, 2, 3) to execute against. Defaults to first enabled account."),
        export_mime_type: z.string().optional().describe("Explicit export MIME type (e.g. 'text/plain', 'text/csv', 'text/markdown', 'application/pdf')"),
        max_bytes: z.number().int().min(1000).max(100000000).default(50000000).describe("Maximum bytes / chars of content to return (default 50 MB, max 100 MB)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ file_id, account: reqAccount, export_mime_type, max_bytes }) => {
      const settings = getSettings();
      try {
        const { data: meta, account } = await gdriveRequest(`/files/${encodeURIComponent(file_id)}?fields=id,name,mimeType,size,webViewLink&supportsAllDrives=true`, { method: "GET" }, settings, fetchJson, reqAccount);
        const { token } = await getAccessToken(settings, fetchJson, reqAccount);

        let fetchUrl;

        if (meta.mimeType === "application/vnd.google-apps.document") {
          const mime = export_mime_type || "text/plain";
          fetchUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file_id)}/export?mimeType=${encodeURIComponent(mime)}`;
        } else if (meta.mimeType === "application/vnd.google-apps.spreadsheet") {
          const mime = export_mime_type || "text/csv";
          fetchUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file_id)}/export?mimeType=${encodeURIComponent(mime)}`;
        } else if (meta.mimeType === "application/vnd.google-apps.presentation") {
          const mime = export_mime_type || "text/plain";
          fetchUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file_id)}/export?mimeType=${encodeURIComponent(mime)}`;
        } else if (meta.mimeType === "application/vnd.google-apps.folder") {
          return { content: [{ type: "text", text: `Error: ID '${file_id}' is a folder, not a file. Use gdrive_list_files with folder_id instead.` }] };
        } else {
          fetchUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file_id)}?alt=media&supportsAllDrives=true`;
        }

        const res = await fetch(fetchUrl, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!res.ok) {
          const errText = await res.text();
          return { content: [{ type: "text", text: `Error reading file (${res.status}): ${errText}` }] };
        }

        const rawContentType = res.headers.get("content-type") || meta.mimeType || "";
        const cleanMime = rawContentType.split(";")[0].trim().toLowerCase();
        const isBinary =
          cleanMime.startsWith("image/") ||
          cleanMime.startsWith("audio/") ||
          cleanMime.startsWith("video/") ||
          cleanMime === "application/pdf" ||
          cleanMime === "application/zip" ||
          cleanMime === "application/octet-stream";

        if (isBinary) {
          const arrayBuffer = await res.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const base64 = buffer.toString("base64");
          const returnBase64 = max_bytes && base64.length > max_bytes ? base64.slice(0, max_bytes) : base64;
          const isTruncated = max_bytes && base64.length > max_bytes;

          const content = [];
          if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(cleanMime)) {
            content.push({ type: "image", data: base64, mimeType: cleanMime });
          } else if (cleanMime === "application/pdf") {
            content.push({
              type: "resource",
              resource: {
                uri: meta.webViewLink || `https://drive.google.com/file/d/${meta.id}/view`,
                mimeType: "application/pdf",
                blob: base64
              }
            });
          }

          content.push({
            type: "text",
            text: `File '${meta.name}' (${meta.mimeType || cleanMime}, ${(arrayBuffer.byteLength / 1024).toFixed(1)} KB) retrieved from ${account.name}.${
              isTruncated ? ` Base64 output truncated at ${max_bytes} chars.` : " Complete document payload included."
            }`
          });

          return {
            content,
            structuredContent: {
              account: account.name,
              id: meta.id,
              name: meta.name,
              mimeType: meta.mimeType || cleanMime,
              size: arrayBuffer.byteLength,
              base64: returnBase64,
              truncated: isTruncated
            }
          };
        }

        const rawText = await res.text();
        const text = truncate(rawText, max_bytes);
        return {
          content: [{ type: "text", text: `### Content of ${meta.name} (${meta.mimeType}) [Account: ${account.name}]:\n\n${text}` }],
          structuredContent: { account: account.name, id: meta.id, name: meta.name, mimeType: meta.mimeType, length: rawText.length }
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error reading file ${file_id}: ${err.message}` }] };
      }
    }
  );

  // 4. Create Folder
  server.registerTool(
    "gdrive_create_folder",
    {
      title: "Create folder",
      description: "Create a new folder in Google Drive.\n\nArgs: name (string), parent_folder_id (optional string), account (optional account name/number).\nReturns: created folder details (id, name, webViewLink).",
      inputSchema: {
        name: z.string().min(1).describe("Folder name"),
        parent_folder_id: z.string().optional().describe("Parent folder ID. If omitted, created in the root directory"),
        account: z.string().optional().describe("Account name or number (1, 2, 3) to execute against. Defaults to first enabled account.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ name, parent_folder_id, account: reqAccount }) => {
      const settings = getSettings();
      try {
        const body = {
          name,
          mimeType: "application/vnd.google-apps.folder"
        };
        if (parent_folder_id) {
          body.parents = [parent_folder_id];
        }

        const { data: folder, account } = await gdriveRequest(
          "/files?supportsAllDrives=true",
          {
            method: "POST",
            body
          },
          settings,
          fetchJson,
          reqAccount
        );

        return {
          content: [
            {
              type: "text",
              text: `Created folder "${folder.name}" successfully on ${account.name}.\n- ID: ${folder.id}\n- Parent: ${parent_folder_id || "Root"}`
            }
          ],
          structuredContent: folder
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error creating folder: ${err.message}` }] };
      }
    }
  );

  // 5. Upload / Create File
  server.registerTool(
    "gdrive_upload_file",
    {
      title: "Upload file",
      description: "Upload a new text or binary file to Google Drive (using multipart upload).\n\nArgs: name (string), content (string), is_base64 (default false), mime_type (default 'text/plain'), folder_id (optional), description (optional), account (optional account name/number).\nReturns: uploaded file metadata (id, name, webViewLink).",
      inputSchema: {
        name: z.string().min(1).describe("File name with extension (e.g. 'report.md', 'data.csv')"),
        content: z.string().describe("File content (raw string or base64 encoded)"),
        account: z.string().optional().describe("Account name or number (1, 2, 3) to execute against. Defaults to first enabled account."),
        is_base64: z.boolean().default(false).describe("Set to true if content is base64 encoded"),
        mime_type: z.string().default("text/plain").describe("MIME type (e.g. 'text/plain', 'text/csv', 'application/json', 'image/png')"),
        folder_id: z.string().optional().describe("Destination parent folder ID"),
        description: z.string().optional().describe("Optional file description")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ name, content, account: reqAccount, is_base64, mime_type, folder_id, description }) => {
      const settings = getSettings();
      try {
        const { token, account } = await getAccessToken(settings, fetchJson, reqAccount);
        const metadata = {
          name,
          mimeType: mime_type,
          description: description || undefined
        };
        if (folder_id) {
          metadata.parents = [folder_id];
        }

        const boundary = `-------MCPStationBoundary${Date.now()}`;
        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelimiter = `\r\n--${boundary}--`;

        const fileBuffer = is_base64 ? Buffer.from(content, "base64") : Buffer.from(content, "utf8");

        const multipartBody = Buffer.concat([
          Buffer.from(delimiter + "Content-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) + delimiter + `Content-Type: ${mime_type}\r\n\r\n`),
          fileBuffer,
          Buffer.from(closeDelimiter)
        ]);

        const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
            "Content-Length": String(multipartBody.length)
          },
          body: multipartBody
        });

        if (!res.ok) {
          const errText = await res.text();
          return { content: [{ type: "text", text: `Error uploading file (${res.status}): ${errText}` }] };
        }

        const result = await res.json();
        return {
          content: [
            {
              type: "text",
              text: `File "${result.name}" uploaded successfully to ${account.name}.\n- ID: ${result.id}\n- MIME: ${result.mimeType}\n- Folder: ${folder_id || "Root"}`
            }
          ],
          structuredContent: result
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error uploading file: ${err.message}` }] };
      }
    }
  );

  // 6. Update File Metadata or Content
  server.registerTool(
    "gdrive_update_file",
    {
      title: "Update file",
      description: "Update a file's metadata (name, description, starred, trashed) or replace its content.\n\nArgs: file_id (string), account (optional account name/number), name (optional), description (optional), starred (optional), content (optional), is_base64 (default false), mime_type (optional).",
      inputSchema: {
        file_id: z.string().min(1).describe("ID of the file to update"),
        account: z.string().optional().describe("Account name or number (1, 2, 3) to execute against. Defaults to first enabled account."),
        name: z.string().optional().describe("New name for the file"),
        description: z.string().optional().describe("New description"),
        starred: z.boolean().optional().describe("Set starred state"),
        content: z.string().optional().describe("New file content to replace existing content"),
        is_base64: z.boolean().default(false).describe("Set to true if content is base64 encoded"),
        mime_type: z.string().optional().describe("MIME type for updated content")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ file_id, account: reqAccount, name, description, starred, content, is_base64, mime_type }) => {
      const settings = getSettings();
      try {
        const metadata = {};
        if (name !== undefined) metadata.name = name;
        if (description !== undefined) metadata.description = description;
        if (starred !== undefined) metadata.starred = starred;

        let result;
        let accountName = "";
        if (content !== undefined) {
          const { token, account } = await getAccessToken(settings, fetchJson, reqAccount);
          accountName = account.name;
          const effectiveMime = mime_type || "text/plain";
          metadata.mimeType = effectiveMime;

          const boundary = `-------MCPStationBoundary${Date.now()}`;
          const delimiter = `\r\n--${boundary}\r\n`;
          const closeDelimiter = `\r\n--${boundary}--`;

          const fileBuffer = is_base64 ? Buffer.from(content, "base64") : Buffer.from(content, "utf8");

          const multipartBody = Buffer.concat([
            Buffer.from(delimiter + "Content-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) + delimiter + `Content-Type: ${effectiveMime}\r\n\r\n`),
            fileBuffer,
            Buffer.from(closeDelimiter)
          ]);

          const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(file_id)}?uploadType=multipart&supportsAllDrives=true`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": `multipart/related; boundary=${boundary}`,
              "Content-Length": String(multipartBody.length)
            },
            body: multipartBody
          });

          if (!res.ok) {
            const errText = await res.text();
            return { content: [{ type: "text", text: `Error updating file content (${res.status}): ${errText}` }] };
          }
          result = await res.json();
        } else {
          const reqRes = await gdriveRequest(
            `/files/${encodeURIComponent(file_id)}?supportsAllDrives=true`,
            {
              method: "PATCH",
              body: metadata
            },
            settings,
            fetchJson,
            reqAccount
          );
          result = reqRes.data;
          accountName = reqRes.account.name;
        }

        return {
          content: [{ type: "text", text: `File "${result.name || file_id}" updated successfully on ${accountName}.\n- ID: ${result.id}` }],
          structuredContent: result
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error updating file ${file_id}: ${err.message}` }] };
      }
    }
  );

  // 7. Move File
  server.registerTool(
    "gdrive_move_file",
    {
      title: "Move file",
      description: "Move a file or folder from one parent folder to another.\n\nArgs: file_id (string), add_parent_id (string), remove_parent_id (optional string), account (optional account name/number).",
      inputSchema: {
        file_id: z.string().min(1).describe("ID of the file or folder to move"),
        add_parent_id: z.string().min(1).describe("Destination folder ID"),
        remove_parent_id: z.string().optional().describe("Previous parent folder ID (if omitted, fetched automatically)"),
        account: z.string().optional().describe("Account name or number (1, 2, 3) to execute against. Defaults to first enabled account.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ file_id, add_parent_id, remove_parent_id, account: reqAccount }) => {
      const settings = getSettings();
      try {
        let prevParent = remove_parent_id;
        if (!prevParent) {
          const { data: meta } = await gdriveRequest(`/files/${encodeURIComponent(file_id)}?fields=parents&supportsAllDrives=true`, { method: "GET" }, settings, fetchJson, reqAccount);
          if (meta.parents && meta.parents.length > 0) {
            prevParent = meta.parents.join(",");
          }
        }

        const params = new URLSearchParams({
          addParents: add_parent_id,
          supportsAllDrives: "true"
        });
        if (prevParent) {
          params.set("removeParents", prevParent);
        }

        const { data: result, account } = await gdriveRequest(
          `/files/${encodeURIComponent(file_id)}?${params.toString()}`,
          {
            method: "PATCH"
          },
          settings,
          fetchJson,
          reqAccount
        );

        return {
          content: [{ type: "text", text: `File "${result.name || file_id}" moved successfully to parent "${add_parent_id}" on ${account.name}.` }],
          structuredContent: result
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error moving file: ${err.message}` }] };
      }
    }
  );

  // 8. Copy File
  server.registerTool(
    "gdrive_copy_file",
    {
      title: "Copy file",
      description: "Create a copy of an existing file in Google Drive.\n\nArgs: file_id (string), name (optional new name), destination_folder_id (optional), account (optional account name/number).",
      inputSchema: {
        file_id: z.string().min(1).describe("Source file ID"),
        name: z.string().optional().describe("Name for the duplicate copy"),
        destination_folder_id: z.string().optional().describe("Destination folder ID for the copy"),
        account: z.string().optional().describe("Account name or number (1, 2, 3) to execute against. Defaults to first enabled account.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ file_id, name, destination_folder_id, account: reqAccount }) => {
      const settings = getSettings();
      try {
        const body = {};
        if (name) body.name = name;
        if (destination_folder_id) body.parents = [destination_folder_id];

        const { data: copy, account } = await gdriveRequest(
          `/files/${encodeURIComponent(file_id)}/copy?supportsAllDrives=true`,
          {
            method: "POST",
            body
          },
          settings,
          fetchJson,
          reqAccount
        );

        return {
          content: [{ type: "text", text: `File copied successfully on ${account.name}:\n- Original: ${file_id}\n- New File: "${copy.name}" (ID: ${copy.id})` }],
          structuredContent: copy
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error copying file: ${err.message}` }] };
      }
    }
  );

  // 9. Delete or Trash File
  server.registerTool(
    "gdrive_delete_file",
    {
      title: "Delete or trash file",
      description: "Move a file or folder to the trash or delete it permanently.\n\nArgs: file_id (string), permanent (default false), account (optional account name/number).",
      inputSchema: {
        file_id: z.string().min(1).describe("ID of the file or folder to delete"),
        permanent: z.boolean().default(false).describe("If true, deletes permanently. If false, moves to Trash."),
        account: z.string().optional().describe("Account name or number (1, 2, 3) to execute against. Defaults to first enabled account.")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ file_id, permanent, account: reqAccount }) => {
      const settings = getSettings();
      try {
        if (permanent) {
          const { account } = await gdriveRequest(
            `/files/${encodeURIComponent(file_id)}?supportsAllDrives=true`,
            {
              method: "DELETE"
            },
            settings,
            fetchJson,
            reqAccount
          );
          return { content: [{ type: "text", text: `File/folder ${file_id} was permanently deleted on ${account.name}.` }] };
        } else {
          const { data: result, account } = await gdriveRequest(
            `/files/${encodeURIComponent(file_id)}?supportsAllDrives=true`,
            {
              method: "PATCH",
              body: { trashed: true }
            },
            settings,
            fetchJson,
            reqAccount
          );
          return {
            content: [{ type: "text", text: `File/folder "${result.name || file_id}" was moved to Trash on ${account.name}.` }],
            structuredContent: result
          };
        }
      } catch (err) {
        return { content: [{ type: "text", text: `Error deleting file ${file_id}: ${err.message}` }] };
      }
    }
  );

  // 10. List Permissions
  server.registerTool(
    "gdrive_list_permissions",
    {
      title: "List permissions",
      description: "List sharing permissions and collaborators for a file or folder in Google Drive.\n\nArgs: file_id (string), account (optional account name/number).\nReturns: list of permissions (id, role, type, emailAddress, displayName).",
      inputSchema: {
        file_id: z.string().min(1).describe("ID of the file or folder"),
        account: z.string().optional().describe("Account name or number (1, 2, 3) to execute against. Defaults to first enabled account.")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ file_id, account: reqAccount }) => {
      const settings = getSettings();
      try {
        const { data, account } = await gdriveRequest(
          `/files/${encodeURIComponent(file_id)}/permissions?fields=permissions(id,role,type,emailAddress,displayName,domain,allowFileDiscovery)&supportsAllDrives=true`,
          {
            method: "GET"
          },
          settings,
          fetchJson,
          reqAccount
        );

        const list = data.permissions || [];
        if (list.length === 0) {
          return { content: [{ type: "text", text: `[Account: ${account.name}] No explicit permissions found.` }], structuredContent: data };
        }

        const lines = list.map((p) => `- **${p.role}** (${p.type}): ${p.displayName ? `${p.displayName} <${p.emailAddress || ""}>` : p.emailAddress || p.domain || "Anyone"} [Permission ID: ${p.id}]`);
        return {
          content: [{ type: "text", text: `Permissions for file ${file_id} [Account: ${account.name}]:\n\n${lines.join("\n")}` }],
          structuredContent: data
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error listing permissions: ${err.message}` }] };
      }
    }
  );

  // 11. Share File / Add Permission
  server.registerTool(
    "gdrive_share_file",
    {
      title: "Share file / add permission",
      description: "Share a file or folder with a user, group, domain, or anyone with the link.\n\nArgs: file_id (string), role ('reader'|'commenter'|'writer'), type ('user'|'group'|'domain'|'anyone'), email_address (optional), send_notification_email (default true), account (optional account name/number).",
      inputSchema: {
        file_id: z.string().min(1).describe("ID of the file or folder to share"),
        account: z.string().optional().describe("Account name or number (1, 2, 3) to execute against. Defaults to first enabled account."),
        role: z.enum(["reader", "commenter", "writer"]).describe("Access role"),
        type: z.enum(["user", "group", "domain", "anyone"]).describe("Target entity type"),
        email_address: z.string().optional().describe("User or group email address (required if type is 'user' or 'group')"),
        domain: z.string().optional().describe("Domain name (if type is 'domain')"),
        send_notification_email: z.boolean().default(true).describe("Whether to send a notification email")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ file_id, account: reqAccount, role, type, email_address, domain, send_notification_email }) => {
      const settings = getSettings();
      try {
        if ((type === "user" || type === "group") && !email_address) {
          return { content: [{ type: "text", text: "Error: email_address is required when type is 'user' or 'group'." }] };
        }
        if (type === "domain" && !domain) {
          return { content: [{ type: "text", text: "Error: domain is required when type is 'domain'." }] };
        }

        const body = { role, type };
        if (email_address) body.emailAddress = email_address;
        if (domain) body.domain = domain;

        const params = new URLSearchParams({
          supportsAllDrives: "true",
          sendNotificationEmail: String(send_notification_email)
        });

        const { data: perm, account } = await gdriveRequest(
          `/files/${encodeURIComponent(file_id)}/permissions?${params.toString()}`,
          {
            method: "POST",
            body
          },
          settings,
          fetchJson,
          reqAccount
        );

        return {
          content: [
            {
              type: "text",
              text: `Permission granted for file ${file_id} on ${account.name}.\n- Role: ${role}\n- Type: ${type}\n- Target: ${email_address || domain || "anyone"}\n- Permission ID: ${perm.id}`
            }
          ],
          structuredContent: perm
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error sharing file: ${err.message}` }] };
      }
    }
  );

  // 12. Remove Permission
  server.registerTool(
    "gdrive_remove_permission",
    {
      title: "Remove permission",
      description: "Revoke a permission from a file or folder in Google Drive.\n\nArgs: file_id (string), permission_id (string), account (optional account name/number).",
      inputSchema: {
        file_id: z.string().min(1).describe("ID of the file or folder"),
        permission_id: z.string().min(1).describe("ID of the permission to delete"),
        account: z.string().optional().describe("Account name or number (1, 2, 3) to execute against. Defaults to first enabled account.")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ file_id, permission_id, account: reqAccount }) => {
      const settings = getSettings();
      try {
        const { account } = await gdriveRequest(
          `/files/${encodeURIComponent(file_id)}/permissions/${encodeURIComponent(permission_id)}?supportsAllDrives=true`,
          {
            method: "DELETE"
          },
          settings,
          fetchJson,
          reqAccount
        );

        return { content: [{ type: "text", text: `Permission ${permission_id} removed from file ${file_id} on ${account.name}.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error removing permission: ${err.message}` }] };
      }
    }
  );

  // 13. Get Storage Quota & User Info
  server.registerTool(
    "gdrive_get_storage_quota",
    {
      title: "Get storage quota",
      description: "Get Google Drive storage quota metrics (used bytes, total limit, trash usage) and current user info.\n\nArgs: account (optional account name/number).\nReturns: user name, email, storage limit, storage usage in GB.",
      inputSchema: {
        account: z.string().optional().describe("Account name or number (1, 2, 3) to execute against. Defaults to first enabled account.")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ account: reqAccount } = {}) => {
      const settings = getSettings();
      try {
        const { data: about, account } = await gdriveRequest("/about?fields=user,storageQuota,maxUploadSize", { method: "GET" }, settings, fetchJson, reqAccount);
        const u = about.user || {};
        const q = about.storageQuota || {};

        const limitGB = q.limit ? (Number(q.limit) / 1024 ** 3).toFixed(2) + " GB" : "Unlimited";
        const usageGB = q.usage ? (Number(q.usage) / 1024 ** 3).toFixed(2) + " GB" : "0 GB";
        const driveUsageGB = q.usageInDrive ? (Number(q.usageInDrive) / 1024 ** 3).toFixed(2) + " GB" : "0 GB";
        const trashUsageGB = q.usageInDriveTrash ? (Number(q.usageInDriveTrash) / 1024 ** 3).toFixed(2) + " GB" : "0 GB";

        const text = `### Google Drive Account & Storage Quota [Account: ${account.name}]\n- **User**: ${u.displayName || "Unknown"} (${u.emailAddress || "N/A"})\n- **Total Used**: ${usageGB} / ${limitGB}\n- **Drive Usage**: ${driveUsageGB}\n- **Trash Usage**: ${trashUsageGB}\n- **Max Upload Size**: ${about.maxUploadSize ? (Number(about.maxUploadSize) / 1024 ** 3).toFixed(2) + " GB" : "N/A"}`;

        return { content: [{ type: "text", text }], structuredContent: about };
      } catch (err) {
        return { content: [{ type: "text", text: `Error getting storage quota: ${err.message}` }] };
      }
    }
  );

  // 14. List Shared Drives
  server.registerTool(
    "gdrive_list_shared_drives",
    {
      title: "List shared drives",
      description: "List Google Workspace Shared Drives (Team Drives) accessible to the account.\n\nArgs: account (optional account name/number), page_size (1-100, default 25), page_token (optional).",
      inputSchema: {
        account: z.string().optional().describe("Account name or number (1, 2, 3) to execute against. Defaults to first enabled account."),
        page_size: z.number().int().min(1).max(100).default(25).describe("Number of shared drives to return"),
        page_token: z.string().optional().describe("Token for fetching next page of drives")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ account: reqAccount, page_size, page_token }) => {
      const settings = getSettings();
      try {
        const params = new URLSearchParams({
          pageSize: String(page_size || 25),
          fields: "nextPageToken,drives(id,name,createdTime,hidden,restrictions)"
        });
        if (page_token) params.set("pageToken", page_token);

        const { data, account } = await gdriveRequest(`/drives?${params.toString()}`, { method: "GET" }, settings, fetchJson, reqAccount);
        const drives = data.drives || [];

        if (drives.length === 0) {
          return { content: [{ type: "text", text: `[Account: ${account.name}] No Shared Drives found.` }], structuredContent: data };
        }

        const lines = drives.map((d) => `- **${d.name}** (ID: \`${d.id}\`) | Created: ${d.createdTime || "N/A"}`);
        const text = `[Account: ${account.name}] Found ${drives.length} Shared Drive(s)${data.nextPageToken ? ` (Next page token: ${data.nextPageToken})` : ""}:\n\n${lines.join("\n")}`;

        return { content: [{ type: "text", text }], structuredContent: data };
      } catch (err) {
        return { content: [{ type: "text", text: `Error listing shared drives: ${err.message}` }] };
      }
    }
  );
}

async function testService(settings, { fetchJson }) {
  const missing = configurationError("gdrive", settings);
  if (missing) return { ok: false, message: `${missing}. Open Settings.` };
  const active = getActiveAccounts(settings);
  const directToken = cleanVal(settings.access_token);
  const clientId = cleanVal(settings.client_id);
  const clientSecret = cleanVal(settings.client_secret);

  if (active.length === 0 && !directToken) {
    return {
      ok: false,
      message: "No enabled accounts with refresh tokens found. Make sure at least one account is enabled and has a refresh token pasted in Settings."
    };
  }

  if (active.length > 0 && (!clientId || !clientSecret)) {
    return {
      ok: false,
      message: "Missing OAuth Client ID or Client Secret. Google requires client_id and client_secret to exchange refresh tokens for all accounts."
    };
  }

  if (active.length === 0 && settings.access_token) {
    try {
      const { token } = await getAccessToken(settings, fetchJson);
      const data = await fetchJson("https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)", {
        headers: { Authorization: `Bearer ${token}` }
      });
      return { ok: true, message: `Connected via Direct Token as ${data.user?.displayName || data.user?.emailAddress || "Google User"}` };
    } catch (e) {
      return { ok: false, message: `Direct Token connection failed: ${e.message}` };
    }
  }

  const results = [];
  let allOk = true;

  for (const acc of active) {
    try {
      const { token } = await getAccessToken(settings, fetchJson, acc.key);
      const data = await fetchJson("https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress),storageQuota", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const user = data.user?.displayName ? `${data.user.displayName} (${data.user.emailAddress})` : data.user?.emailAddress || "Connected";
      const used = data.storageQuota?.usage ? `${(Number(data.storageQuota.usage) / 1024 ** 3).toFixed(2)} GB used` : "";
      results.push(`✓ [${acc.name}]: ${user}${used ? ` - ${used}` : ""}`);
    } catch (e) {
      allOk = false;
      results.push(`✗ [${acc.name}]: ${e.message}`);
    }
  }

  return {
    ok: allOk,
    message: results.join(" | ")
  };
}

/** UI connectivity checks never expose provider bodies or account/session details. */
export async function test(settings, context = {}) {
  const missing = configurationError("gdrive", settings);
  if (missing) return { ok: false, message: `${missing}. Open Settings.` };
  try {
    const result = await testService(settings, context);
    return result.ok ? { ok: true, message: "Connection successful." } :
      { ok: false, message: "Connection failed. Check Settings, permissions and service availability." };
  } catch {
    return { ok: false, message: "Connection failed. Check Settings, permissions and service availability." };
  }
}
