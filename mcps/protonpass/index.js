import { configurationError, guardedServer } from "./bundle.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

// Helper to run pass-cli commands with PAT or session env

// pass-cli item commands take either a pass:// URI (positional) or --item-id/--item-title flags.
function itemSelector(item) {
  if (item.startsWith("pass://")) return { uri: true, args: [item] };
  if (/^[A-Za-z0-9_-]{40,}={0,2}$/.test(item)) return { uri: false, args: ["--item-id", item] };
  return { uri: false, args: ["--item-title", item] };
}

async function runPassCli(args, settings = {}) {
  const cliPath = settings.cli_path || "pass-cli";
  if (!settings.personal_access_token?.trim()) throw new Error("Configure personal_access_token in Settings.");
  if (!["pass-cli", "/usr/local/bin/pass-cli"].includes(cliPath)) throw new Error("cli_path must be pass-cli or /usr/local/bin/pass-cli.");
  const env = { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" };

  if (settings.personal_access_token) {
    env.PROTON_PASS_PERSONAL_ACCESS_TOKEN = settings.personal_access_token;
  }

  try {
    const { stdout, stderr } = await execFileAsync(cliPath, args, { env, timeout: 30000 });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `Proton Pass CLI binary '${cliPath}' was not found. Install pass-cli: 'curl -fsSL https://proton.me/download/pass-cli/install.sh | bash' or configure cli_path in Settings.`
      );
    }
    throw new Error("pass-cli operation failed. Check the configured PAT, permissions and CLI installation.");
  }
}

// Built-in fallback password generation if pass-cli is unavailable
function generatePasswordLocally({ length = 20, uppercase = true, lowercase = true, numbers = true, symbols = true }) {
  let chars = "";
  if (lowercase) chars += "abcdefghijklmnopqrstuvwxyz";
  if (uppercase) chars += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (numbers) chars += "0123456789";
  if (symbols) chars += "!@#$%^&*()-_=+[]{}|;:,.<>?";
  if (!chars) chars = "abcdefghijklmnopqrstuvwxyz" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ" + "0123456789";

  let result = "";

  for (let i = 0; i < length; i++) {
    result += chars[crypto.randomInt(chars.length)];
  }
  return result;
}

export function register({ server, z, getSettings, log }) {
  server = guardedServer(server, "protonpass", getSettings, []);
  // 1. Info / Status
  server.registerTool(
    "protonpass_info",
    {
      title: "Get Proton Pass session info",
      description: "Get current Proton Pass CLI authentication session and account details.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async () => {
      const settings = getSettings();
      try {
        const { stdout } = await runPassCli(["info", "--output", "json"], settings);
        try {
          const json = JSON.parse(stdout);
          return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }], structuredContent: json };
        } catch {
          return { content: [{ type: "text", text: stdout }] };
        }
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 2. List Vaults
  server.registerTool(
    "protonpass_list_vaults",
    {
      title: "List vaults",
      description: "List all Proton Pass vaults accessible to the current session.",
      inputSchema: {
        output: z.enum(["json", "human"]).default("json").describe("Output format")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ output }) => {
      const settings = getSettings();
      try {
        const { stdout } = await runPassCli(["vault", "list", "--output", output], settings);
        if (output === "json") {
          try {
            const data = JSON.parse(stdout);
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { vaults: data } };
          } catch {
            // fallback
          }
        }
        return { content: [{ type: "text", text: stdout || "No vaults found." }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 3. Create Vault
  server.registerTool(
    "protonpass_create_vault",
    {
      title: "Create vault",
      description: "Create a new vault in Proton Pass.",
      inputSchema: {
        name: z.string().min(1).describe("Name of the new vault")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ name }) => {
      const settings = getSettings();
      try {
        const { stdout } = await runPassCli(["vault", "create", "--name", name], settings);
        return { content: [{ type: "text", text: stdout || `Vault '${name}' created successfully.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 4. Update Vault
  server.registerTool(
    "protonpass_update_vault",
    {
      title: "Update vault",
      description: "Rename an existing vault by Share ID or current name.",
      inputSchema: {
        new_name: z.string().min(1).describe("New name for the vault"),
        share_id: z.string().optional().describe("Share ID of the vault"),
        vault_name: z.string().optional().describe("Current name of the vault")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ new_name, share_id, vault_name }) => {
      const settings = getSettings();
      if (!share_id && !vault_name) {
        return { content: [{ type: "text", text: "Error: You must provide either share_id or vault_name." }] };
      }
      const args = ["vault", "update"];
      if (share_id) args.push("--share-id", share_id);
      else if (vault_name) args.push("--vault-name", vault_name);
      args.push("--name", new_name);

      try {
        const { stdout } = await runPassCli(args, settings);
        return { content: [{ type: "text", text: stdout || `Vault updated successfully to '${new_name}'.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 5. Delete Vault
  server.registerTool(
    "protonpass_delete_vault",
    {
      title: "Delete vault",
      description: "Permanently delete a vault and all items within it. Warning: Cannot be undone!",
      inputSchema: {
        share_id: z.string().optional().describe("Share ID of the vault to delete"),
        vault_name: z.string().optional().describe("Name of the vault to delete")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    async ({ share_id, vault_name }) => {
      const settings = getSettings();
      if (!share_id && !vault_name) {
        return { content: [{ type: "text", text: "Error: You must provide either share_id or vault_name." }] };
      }
      const args = ["vault", "delete"];
      if (share_id) args.push("--share-id", share_id);
      else if (vault_name) args.push("--vault-name", vault_name);

      try {
        const { stdout } = await runPassCli(args, settings);
        return { content: [{ type: "text", text: stdout || "Vault deleted successfully." }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 6. List Vault Members
  server.registerTool(
    "protonpass_list_vault_members",
    {
      title: "List vault members",
      description: "List all members and roles with access to a specific vault.",
      inputSchema: {
        share_id: z.string().optional().describe("Share ID of the vault"),
        vault_name: z.string().optional().describe("Name of the vault")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ share_id, vault_name }) => {
      const settings = getSettings();
      const args = ["vault", "member", "list", "--output", "json"];
      if (share_id) args.push("--share-id", share_id);
      else if (vault_name) args.push("--vault-name", vault_name);

      try {
        const { stdout } = await runPassCli(args, settings);
        try {
          const data = JSON.parse(stdout);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { members: data } };
        } catch {
          return { content: [{ type: "text", text: stdout }] };
        }
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 7. Share Vault
  server.registerTool(
    "protonpass_share_vault",
    {
      title: "Share vault",
      description: "Share a vault with another user by email.",
      inputSchema: {
        email: z.string().email().describe("Email address of user to share with"),
        role: z.enum(["viewer", "editor", "manager"]).default("viewer").describe("Role to assign"),
        share_id: z.string().optional().describe("Share ID of the vault"),
        vault_name: z.string().optional().describe("Name of the vault")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ email, role, share_id, vault_name }) => {
      const settings = getSettings();
      const args = ["vault", "share"];
      if (share_id) args.push("--share-id", share_id);
      else if (vault_name) args.push("--vault-name", vault_name);
      args.push(email, "--role", role);

      try {
        const { stdout } = await runPassCli(args, settings);
        return { content: [{ type: "text", text: stdout || `Vault shared with ${email} as ${role}.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 8. List Items
  server.registerTool(
    "protonpass_list_items",
    {
      title: "List items",
      description: "List items (logins, notes, credit cards, aliases, SSH keys) in a vault.",
      inputSchema: {
        vault_name: z.string().optional().describe("Vault name"),
        share_id: z.string().optional().describe("Vault Share ID"),
        output: z.enum(["json", "human"]).default("json").describe("Output format")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ vault_name, share_id, output }) => {
      const settings = getSettings();
      const args = ["item", "list", "--output", output];
      if (share_id) args.push("--share-id", share_id);
      else if (vault_name) args.push("--vault-name", vault_name);
      else if (settings.default_vault) args.push("--vault-name", settings.default_vault);

      try {
        const { stdout } = await runPassCli(args, settings);
        if (output === "json") {
          try {
            const data = JSON.parse(stdout);
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { items: data } };
          } catch {
            // fallback
          }
        }
        return { content: [{ type: "text", text: stdout || "No items found." }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 9. Get / View Item
  server.registerTool(
    "protonpass_get_item",
    {
      title: "Get item",
      description: "View full item details (username, password, urls, custom fields) by item title or ID.",
      inputSchema: {
        item: z.string().min(1).describe("Item title or Item ID"),
        vault_name: z.string().optional().describe("Vault name"),
        share_id: z.string().optional().describe("Vault Share ID")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ item, vault_name, share_id }) => {
      const settings = getSettings();
      const sel = itemSelector(item);
      const args = ["item", "view", ...sel.args, "--output", "json"];
      if (sel.uri) {}
      else if (share_id) args.push("--share-id", share_id);
      else if (vault_name) args.push("--vault-name", vault_name);
      else if (settings.default_vault) args.push("--vault-name", settings.default_vault);

      try {
        const { stdout } = await runPassCli(args, settings);
        try {
          const data = JSON.parse(stdout);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
        } catch {
          return { content: [{ type: "text", text: stdout }] };
        }
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 10. Create Login Item
  server.registerTool(
    "protonpass_create_login",
    {
      title: "Create login item",
      description: "Create a new login item in a vault with title, username, password, and URL.",
      inputSchema: {
        title: z.string().min(1).describe("Item title (e.g. GitHub, AWS)"),
        username: z.string().optional().describe("Username or account handle"),
        email: z.string().optional().describe("Email address"),
        password: z.string().optional().describe("Password (if omitted and generate_password is true, auto-generates)"),
        generate_password: z.boolean().default(false).describe("Auto-generate a strong password"),
        url: z.string().optional().describe("Website URL"),
        vault_name: z.string().optional().describe("Vault name"),
        share_id: z.string().optional().describe("Vault Share ID")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ title, username, email, password, generate_password, url, vault_name, share_id }) => {
      const settings = getSettings();
      const args = ["item", "create", "login", "--title", title];
      if (share_id) args.push("--share-id", share_id);
      else if (vault_name) args.push("--vault-name", vault_name);
      else if (settings.default_vault) args.push("--vault-name", settings.default_vault);

      if (username) args.push("--username", username);
      if (email) args.push("--email", email);
      if (password) args.push("--password", password);
      else if (generate_password) args.push("--generate-password");
      if (url) args.push("--url", url);

      try {
        const { stdout } = await runPassCli(args, settings);
        return { content: [{ type: "text", text: stdout || `Login item '${title}' created successfully.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 11. Create SSH Key Item
  server.registerTool(
    "protonpass_create_ssh_key",
    {
      title: "Create SSH key item",
      description: "Generate a new SSH key pair or import an existing private key into Proton Pass.",
      inputSchema: {
        title: z.string().min(1).describe("Title for the SSH key item"),
        action: z.enum(["generate", "import"]).default("generate").describe("Action: generate or import"),
        key_type: z.enum(["ed25519", "rsa2048", "rsa4096"]).default("ed25519").describe("Key type for generation"),
        comment: z.string().optional().describe("Comment for generated key"),
        from_private_key_path: z.string().optional().describe("Path to private key file when importing"),
        vault_name: z.string().optional().describe("Vault name"),
        share_id: z.string().optional().describe("Vault Share ID")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ title, action, key_type, comment, from_private_key_path, vault_name, share_id }) => {
      const settings = getSettings();
      const args = ["item", "create", "ssh-key", action, "--title", title];
      if (share_id) args.push("--share-id", share_id);
      else if (vault_name) args.push("--vault-name", vault_name);
      else if (settings.default_vault) args.push("--vault-name", settings.default_vault);

      if (action === "generate") {
        args.push("--key-type", key_type);
        if (comment) args.push("--comment", comment);
      } else if (action === "import") {
        if (!from_private_key_path) {
          return { content: [{ type: "text", text: "Error: from_private_key_path is required when action is 'import'." }] };
        }
        args.push("--from-private-key", from_private_key_path);
      }

      try {
        const { stdout } = await runPassCli(args, settings);
        return { content: [{ type: "text", text: stdout || `SSH Key '${title}' saved successfully.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 12. Update Item
  server.registerTool(
    "protonpass_update_item",
    {
      title: "Update item",
      description: "Update fields of an existing item by title or ID.",
      inputSchema: {
        item: z.string().min(1).describe("Item title or Item ID to update"),
        title: z.string().optional().describe("New title"),
        username: z.string().optional().describe("New username"),
        password: z.string().optional().describe("New password"),
        url: z.string().optional().describe("New URL"),
        vault_name: z.string().optional().describe("Vault name"),
        share_id: z.string().optional().describe("Vault Share ID")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ item, title, username, password, url, vault_name, share_id }) => {
      const settings = getSettings();
      const sel = itemSelector(item);
      const args = ["item", "update", ...sel.args];
      if (share_id) args.push("--share-id", share_id);
      else if (vault_name) args.push("--vault-name", vault_name);
      else if (settings.default_vault) args.push("--vault-name", settings.default_vault);

      if (title) args.push("--title", title);
      if (username) args.push("--username", username);
      if (password) args.push("--password", password);
      if (url) args.push("--url", url);

      try {
        const { stdout } = await runPassCli(args, settings);
        return { content: [{ type: "text", text: stdout || `Item '${item}' updated successfully.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 13. Delete Item
  server.registerTool(
    "protonpass_delete_item",
    {
      title: "Delete item",
      description: "Delete an item from a vault by title or ID.",
      inputSchema: {
        item: z.string().min(1).describe("Item title or Item ID to delete"),
        vault_name: z.string().optional().describe("Vault name"),
        share_id: z.string().optional().describe("Vault Share ID")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    async ({ item, vault_name, share_id }) => {
      const settings = getSettings();
      const sel = itemSelector(item);
      const args = ["item", "delete", ...sel.args];
      if (share_id) args.push("--share-id", share_id);
      else if (vault_name) args.push("--vault-name", vault_name);
      else if (settings.default_vault) args.push("--vault-name", settings.default_vault);

      try {
        const { stdout } = await runPassCli(args, settings);
        return { content: [{ type: "text", text: stdout || `Item '${item}' deleted successfully.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 14. Get TOTP code
  server.registerTool(
    "protonpass_get_totp",
    {
      title: "Get item TOTP code",
      description: "Generate the current TOTP / 2FA verification code for an item stored in Proton Pass.",
      inputSchema: {
        item: z.string().min(1).describe("Item title or Item ID"),
        vault_name: z.string().optional().describe("Vault name"),
        share_id: z.string().optional().describe("Vault Share ID")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ item, vault_name, share_id }) => {
      const settings = getSettings();
      const sel = itemSelector(item);
      const args = ["item", "totp", ...sel.args];
      if (share_id) args.push("--share-id", share_id);
      else if (vault_name) args.push("--vault-name", vault_name);
      else if (settings.default_vault) args.push("--vault-name", settings.default_vault);

      try {
        const { stdout } = await runPassCli(args, settings);
        return { content: [{ type: "text", text: stdout || "No TOTP code returned." }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 15. Password Generator
  server.registerTool(
    "protonpass_generate_password",
    {
      title: "Generate password or passphrase",
      description: "Generate a cryptographically secure random password or memorable passphrase.",
      inputSchema: {
        type: z.enum(["random", "passphrase"]).default("random").describe("Password type"),
        length: z.number().int().min(8).max(128).default(20).describe("Length for random password"),
        numbers: z.boolean().default(true).describe("Include numbers"),
        uppercase: z.boolean().default(true).describe("Include uppercase letters"),
        symbols: z.boolean().default(true).describe("Include symbols"),
        words: z.number().int().min(3).max(12).default(5).describe("Word count for passphrase"),
        separator: z.string().default("-").describe("Separator for passphrase")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ type, length, numbers, uppercase, symbols, words, separator }) => {
      const settings = getSettings();
      try {
        let args = ["password", "generate"];
        if (type === "passphrase") {
          args.push("passphrase", "--count", String(words), "--separator", separator);
        } else {
          args.push(
            "random",
            "--length",
            String(length),
            "--numbers",
            String(numbers),
            "--uppercase",
            String(uppercase),
            "--symbols",
            String(symbols)
          );
        }
        const { stdout } = await runPassCli(args, settings);
        return { content: [{ type: "text", text: stdout }] };
      } catch (e) {
        // Fallback to local cryptographic generator if pass-cli binary is missing
        if (type === "random") {
          const generated = generatePasswordLocally({ length, uppercase, numbers, symbols });
          return { content: [{ type: "text", text: generated }] };
        }
        return { content: [{ type: "text", text: `Error generating password: ${e.message}` }] };
      }
    }
  );

  // 16. Score / Analyze Password
  server.registerTool(
    "protonpass_score_password",
    {
      title: "Score password strength",
      description: "Analyze a password's strength, entropy, and vulnerability penalties.",
      inputSchema: {
        password: z.string().min(1).describe("Password to analyze")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ password }) => {
      const settings = getSettings();
      try {
        const { stdout } = await runPassCli(["password", "score", password, "--output", "json"], settings);
        try {
          const data = JSON.parse(stdout);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
        } catch {
          return { content: [{ type: "text", text: stdout }] };
        }
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 17. List PATs
  server.registerTool(
    "protonpass_list_pats",
    {
      title: "List personal access tokens",
      description: "List all personal access tokens (PATs) and their expiration dates.",
      inputSchema: {
        output: z.enum(["json", "human"]).default("json").describe("Output format")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ output }) => {
      const settings = getSettings();
      try {
        const { stdout } = await runPassCli(["pat", "list", "--output", output], settings);
        if (output === "json") {
          try {
            const data = JSON.parse(stdout);
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { tokens: data } };
          } catch {
            // fallback
          }
        }
        return { content: [{ type: "text", text: stdout || "No personal access tokens found." }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 18. Create PAT
  server.registerTool(
    "protonpass_create_pat",
    {
      title: "Create personal access token",
      description: "Create a new Proton Pass Personal Access Token (PAT). Note: The token value is only displayed once.",
      inputSchema: {
        name: z.string().min(1).describe("Descriptive name for the token (e.g. ci-runner, mcp-agent)"),
        expiration: z.enum(["1h", "1d", "1w", "1m", "3m", "6m", "1y"]).default("3m").describe("Token expiration timeframe")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ name, expiration }) => {
      const settings = getSettings();
      try {
        const { stdout } = await runPassCli(["pat", "create", "--name", name, "--expiration", expiration], settings);
        return { content: [{ type: "text", text: stdout }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 19. Delete PAT
  server.registerTool(
    "protonpass_delete_pat",
    {
      title: "Delete personal access token",
      description: "Permanently delete/revoke a personal access token by ID.",
      inputSchema: {
        pat_id: z.string().min(1).describe("Personal Access Token ID")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    async ({ pat_id }) => {
      const settings = getSettings();
      try {
        const { stdout } = await runPassCli(["pat", "delete", "--personal-access-token-id", pat_id], settings);
        return { content: [{ type: "text", text: stdout || `PAT ${pat_id} revoked.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 20. List PAT Access
  server.registerTool(
    "protonpass_list_pat_access",
    {
      title: "List PAT access permissions",
      description: "List all vaults and items a Personal Access Token has access to.",
      inputSchema: {
        pat_id: z.string().optional().describe("PAT ID"),
        pat_name: z.string().optional().describe("PAT name")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ pat_id, pat_name }) => {
      const settings = getSettings();
      if (!pat_id && !pat_name) {
        return { content: [{ type: "text", text: "Error: Either pat_id or pat_name must be provided." }] };
      }
      const args = ["pat", "access", "list-access", "--output", "json"];
      if (pat_id) args.push("--personal-access-token-id", pat_id);
      else if (pat_name) args.push("--personal-access-token-name", pat_name);

      try {
        const { stdout } = await runPassCli(args, settings);
        try {
          const data = JSON.parse(stdout);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { access: data } };
        } catch {
          return { content: [{ type: "text", text: stdout }] };
        }
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // 21. Grant PAT Access
  server.registerTool(
    "protonpass_grant_pat_access",
    {
      title: "Grant PAT access",
      description: "Grant a Personal Access Token access to a vault or specific item.",
      inputSchema: {
        pat_id: z.string().optional().describe("PAT ID"),
        pat_name: z.string().optional().describe("PAT name"),
        share_id: z.string().optional().describe("Vault Share ID"),
        vault_name: z.string().optional().describe("Vault name"),
        item_id: z.string().optional().describe("Item ID (optional, scopes access to this item only)"),
        item_title: z.string().optional().describe("Item title (optional)"),
        role: z.enum(["viewer", "editor", "manager"]).default("viewer").describe("Access role")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ pat_id, pat_name, share_id, vault_name, item_id, item_title, role }) => {
      const settings = getSettings();
      if (!pat_id && !pat_name) {
        return { content: [{ type: "text", text: "Error: Either pat_id or pat_name must be provided." }] };
      }
      if (!share_id && !vault_name) {
        return { content: [{ type: "text", text: "Error: Either share_id or vault_name must be provided." }] };
      }

      const args = ["pat", "access", "grant"];
      if (pat_id) args.push("--personal-access-token-id", pat_id);
      else if (pat_name) args.push("--personal-access-token-name", pat_name);

      if (share_id) args.push("--share-id", share_id);
      else if (vault_name) args.push("--vault-name", vault_name);

      if (item_id) args.push("--item-id", item_id);
      else if (item_title) args.push("--item-title", item_title);

      args.push("--role", role);

      try {
        const { stdout } = await runPassCli(args, settings);
        return { content: [{ type: "text", text: stdout || "Access granted successfully." }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );
}

// Test connectivity via pass-cli info or binary check
async function testService(settings) {
  const missing = configurationError("protonpass", settings);
  if (missing) return { ok: false, message: `${missing}. Open Settings.` };
  try {
    const { stdout } = await runPassCli(["info", "--output", "json"], settings);
    return { ok: true, message: "Connected to Proton Pass" };
  } catch (err) {
    if (err.message.includes("was not found")) {
      return {
        ok: false,
        message: "pass-cli is not installed on this host. Install: curl -fsSL https://proton.me/download/pass-cli/install.sh | bash"
      };
    }
    return { ok: false, message: err.message };
  }
}

/** UI connectivity checks never expose provider bodies or account/session details. */
export async function test(settings, context = {}) {
  const missing = configurationError("protonpass", settings);
  if (missing) return { ok: false, message: `${missing}. Open Settings.` };
  try {
    const result = await testService(settings, context);
    return result.ok ? { ok: true, message: "Connection successful." } :
      { ok: false, message: "Connection failed. Check Settings, permissions and service availability." };
  } catch {
    return { ok: false, message: "Connection failed. Check Settings, permissions and service availability." };
  }
}
