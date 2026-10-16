import { configurationError, guardedServer } from "./bundle.js";
export function register({ server, z, getSettings, log, fetchJson }) {
  server = guardedServer(server, "dockerhub", getSettings, []);

  // Helper to authenticate and get JWT
  async function getHeaders() {
    const { username, pat } = getSettings();
    if (!username || !pat) {
      throw new Error("Missing 'username' or 'pat' (Personal Access Token) in Docker Hub settings. Please configure them in the MCP Station UI.");
    }
    try {
      const res = await fetchJson("https://hub.docker.com/v2/users/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: pat })
      });
      if (res && res.token) {
        return {
          "Authorization": `Bearer ${res.token}`,
          "Content-Type": "application/json"
        };
      }
      throw new Error("No token returned in login response.");
    } catch (e) {
      throw new Error(`Docker Hub authentication failed: ${e.message}`);
    }
  }

  // Helper to standardise query construction
  function buildQueryString(params) {
    const activeParams = Object.entries(params).filter(([_, val]) => val !== undefined && val !== null);
    if (activeParams.length === 0) return "";
    return "?" + activeParams.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  }

  // Tool 1: Get Profile Details
  server.registerTool(
    "dockerhub_get_profile",
    {
      title: "Get Profile",
      description: "Gets profile details of a user or organization. Defaults to the logged-in user if no username is provided.",
      inputSchema: {
        username: z.string().optional().describe("Docker Hub username or organization (optional, defaults to configured username)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ username }) => {
      try {
        const headers = await getHeaders();
        const targetUsername = username || getSettings().username;
        const res = await fetchJson(`https://hub.docker.com/v2/users/${encodeURIComponent(targetUsername)}/`, { headers });
        return {
          content: [{ type: "text", text: `### Profile for ${targetUsername}\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 2: List Organizations
  server.registerTool(
    "dockerhub_list_orgs",
    {
      title: "List Organizations",
      description: "Lists organizations for the logged-in user.",
      inputSchema: {
        page: z.number().int().min(1).default(1).describe("Page number"),
        pageSize: z.number().int().min(1).max(100).default(10).describe("Number of items per page")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ page, pageSize }) => {
      try {
        const headers = await getHeaders();
        const { username } = getSettings();
        const query = buildQueryString({ page, page_size: pageSize });
        const res = await fetchJson(`https://hub.docker.com/v2/users/${encodeURIComponent(username)}/orgs/${query}`, { headers });
        return {
          content: [{ type: "text", text: `### Organizations\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 3: List Repositories
  server.registerTool(
    "dockerhub_list_repositories",
    {
      title: "List Repositories",
      description: "Lists repositories in a namespace (user or organization). Defaults to the logged-in user's namespace.",
      inputSchema: {
        namespace: z.string().optional().describe("Namespace (username or org name)"),
        page: z.number().int().min(1).default(1).describe("Page number"),
        pageSize: z.number().int().min(1).max(100).default(10).describe("Number of items per page")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ namespace, page, pageSize }) => {
      try {
        const headers = await getHeaders();
        const targetNamespace = namespace || getSettings().username;
        const query = buildQueryString({ page, page_size: pageSize });
        const res = await fetchJson(`https://hub.docker.com/v2/repositories/${encodeURIComponent(targetNamespace)}/${query}`, { headers });

        let markdown = `### Repositories in namespace: ${targetNamespace} (Page ${page})\n\n`;
        if (res.results && Array.isArray(res.results)) {
          res.results.forEach(repo => {
            markdown += `- **${repo.name}**: ${repo.description || "No description"} (Stars: ${repo.star_count}, Pulls: ${repo.pull_count}, Last updated: ${repo.last_updated})\n`;
          });
        } else {
          markdown += "No repositories found or unexpected response format.";
        }

        return {
          content: [{ type: "text", text: markdown }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 4: Get Repository
  server.registerTool(
    "dockerhub_get_repository",
    {
      title: "Get Repository",
      description: "Gets detailed information about a specific repository.",
      inputSchema: {
        namespace: z.string().optional().describe("Namespace (username or org name, defaults to configured username)"),
        repository: z.string().describe("Repository name")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ namespace, repository }) => {
      try {
        const headers = await getHeaders();
        const targetNamespace = namespace || getSettings().username;
        const res = await fetchJson(`https://hub.docker.com/v2/repositories/${encodeURIComponent(targetNamespace)}/${encodeURIComponent(repository)}/`, { headers });
        return {
          content: [{ type: "text", text: `### Repository details: ${targetNamespace}/${repository}\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 5: List Tags
  server.registerTool(
    "dockerhub_list_tags",
    {
      title: "List Repository Tags",
      description: "Lists tags for a repository, including details like size, last updated, and images.",
      inputSchema: {
        namespace: z.string().optional().describe("Namespace (username or org name, defaults to configured username)"),
        repository: z.string().describe("Repository name"),
        page: z.number().int().min(1).default(1).describe("Page number"),
        pageSize: z.number().int().min(1).max(100).default(10).describe("Number of items per page")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ namespace, repository, page, pageSize }) => {
      try {
        const headers = await getHeaders();
        const targetNamespace = namespace || getSettings().username;
        const query = buildQueryString({ page, page_size: pageSize });
        const res = await fetchJson(`https://hub.docker.com/v2/repositories/${encodeURIComponent(targetNamespace)}/${encodeURIComponent(repository)}/tags/${query}`, { headers });

        let markdown = `### Tags for ${targetNamespace}/${repository} (Page ${page})\n\n`;
        if (res.results && Array.isArray(res.results)) {
          res.results.forEach(tag => {
            const sizeMB = tag.full_size ? (tag.full_size / (1024 * 1024)).toFixed(2) + " MB" : "unknown size";
            markdown += `- **${tag.name}** (${sizeMB}) - Last updated: ${tag.last_updated}\n`;
          });
        } else {
          markdown += "No tags found or unexpected response format.";
        }

        return {
          content: [{ type: "text", text: markdown }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 6: Get Tag Details
  server.registerTool(
    "dockerhub_get_tag",
    {
      title: "Get Tag Details",
      description: "Gets detailed information for a specific repository tag.",
      inputSchema: {
        namespace: z.string().optional().describe("Namespace (username or org name, defaults to configured username)"),
        repository: z.string().describe("Repository name"),
        tag: z.string().describe("Tag name")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ namespace, repository, tag }) => {
      try {
        const headers = await getHeaders();
        const targetNamespace = namespace || getSettings().username;
        const res = await fetchJson(`https://hub.docker.com/v2/repositories/${encodeURIComponent(targetNamespace)}/${encodeURIComponent(repository)}/tags/${encodeURIComponent(tag)}/`, { headers });
        return {
          content: [{ type: "text", text: `### Tag Details: ${targetNamespace}/${repository}:${tag}\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 7: Search
  server.registerTool(
    "dockerhub_search",
    {
      title: "Search Repositories",
      description: "Search public and private repositories on Docker Hub.",
      inputSchema: {
        query: z.string().describe("Search term"),
        page: z.number().int().min(1).default(1).describe("Page number"),
        pageSize: z.number().int().min(1).max(100).default(10).describe("Number of items per page")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ query, page, pageSize }) => {
      try {
        const headers = await getHeaders();
        const qParams = buildQueryString({ query, page, page_size: pageSize });
        const res = await fetchJson(`https://hub.docker.com/v2/search/repositories/${qParams}`, { headers });

        let markdown = `### Search Results for "${query}" (Page ${page})\n\n`;
        if (res.results && Array.isArray(res.results)) {
          res.results.forEach(repo => {
            markdown += `- **${repo.repo_name}**: ${repo.short_description || "No description"} (Stars: ${repo.star_count}, Pulls: ${repo.pull_count})\n`;
          });
        } else {
          markdown += "No results found.";
        }

        return {
          content: [{ type: "text", text: markdown }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 8: Get Build History
  server.registerTool(
    "dockerhub_get_build_history",
    {
      title: "Get Build History",
      description: "Retrieves automated build history for a repository.",
      inputSchema: {
        namespace: z.string().optional().describe("Namespace (username or org name, defaults to configured username)"),
        repository: z.string().describe("Repository name"),
        page: z.number().int().min(1).default(1).describe("Page number"),
        pageSize: z.number().int().min(1).max(100).default(10).describe("Number of items per page")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ namespace, repository, page, pageSize }) => {
      try {
        const headers = await getHeaders();
        const targetNamespace = namespace || getSettings().username;
        const query = buildQueryString({ page, page_size: pageSize });
        const res = await fetchJson(`https://hub.docker.com/v2/repositories/${encodeURIComponent(targetNamespace)}/${encodeURIComponent(repository)}/buildhistory/${query}`, { headers });

        let markdown = `### Build History for ${targetNamespace}/${repository} (Page ${page})\n\n`;
        if (res.results && Array.isArray(res.results)) {
          res.results.forEach(build => {
            markdown += `- **Build #${build.build_code}**: Status ${build.status} - Triggered by ${build.cause || "Unknown"} (Created: ${build.created_date})\n`;
          });
        } else {
          markdown += "No builds or build history found.";
        }

        return {
          content: [{ type: "text", text: markdown }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 9: Create Repository (Write)
  server.registerTool(
    "dockerhub_create_repository",
    {
      title: "Create Repository",
      description: "Creates a new repository in Docker Hub under your namespace or organization.",
      inputSchema: {
        name: z.string().describe("Repository name"),
        namespace: z.string().optional().describe("Target namespace (defaults to configured username)"),
        description: z.string().optional().describe("Short description"),
        fullDescription: z.string().optional().describe("Markdown full description/readme"),
        isPrivate: z.boolean().default(false).describe("Whether the repository should be private")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ name, namespace, description, fullDescription, isPrivate }) => {
      try {
        const headers = await getHeaders();
        const targetNamespace = namespace || getSettings().username;
        const body = {
          namespace: targetNamespace,
          name,
          description: description || "",
          full_description: fullDescription || "",
          is_private: isPrivate
        };
        const res = await fetchJson("https://hub.docker.com/v2/repositories/", {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        });
        return {
          content: [{ type: "text", text: `### Repository Created Successfully!\n\n**Repo:** ${targetNamespace}/${name}\n**Privacy:** ${isPrivate ? "Private" : "Public"}\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 10: Update Repository (Write)
  server.registerTool(
    "dockerhub_update_repository",
    {
      title: "Update Repository",
      description: "Updates a repository's metadata (description, readme/full description) in Docker Hub.",
      inputSchema: {
        repository: z.string().describe("Repository name"),
        namespace: z.string().optional().describe("Namespace (defaults to configured username)"),
        description: z.string().optional().describe("Short description"),
        fullDescription: z.string().optional().describe("Markdown full description/readme")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, namespace, description, fullDescription }) => {
      try {
        const headers = await getHeaders();
        const targetNamespace = namespace || getSettings().username;
        const body = {};
        if (description !== undefined) body.description = description;
        if (fullDescription !== undefined) body.full_description = fullDescription;

        const res = await fetchJson(`https://hub.docker.com/v2/repositories/${encodeURIComponent(targetNamespace)}/${encodeURIComponent(repository)}/`, {
          method: "PATCH",
          headers,
          body: JSON.stringify(body)
        });
        return {
          content: [{ type: "text", text: `### Repository Updated Successfully!\n\n**Repo:** ${targetNamespace}/${repository}\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 11: Delete Repository (Destructive Write)
  server.registerTool(
    "dockerhub_delete_repository",
    {
      title: "Delete Repository",
      description: "Permanently deletes a repository from Docker Hub.",
      inputSchema: {
        repository: z.string().describe("Repository name to delete"),
        namespace: z.string().optional().describe("Namespace (defaults to configured username)")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, namespace }) => {
      try {
        const headers = await getHeaders();
        const targetNamespace = namespace || getSettings().username;
        await fetchJson(`https://hub.docker.com/v2/repositories/${encodeURIComponent(targetNamespace)}/${encodeURIComponent(repository)}/`, {
          method: "DELETE",
          headers
        });
        return {
          content: [{ type: "text", text: `### Repository Deleted Successfully!\n\n**Repo:** ${targetNamespace}/${repository}` }]
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 12: Delete Tag (Destructive Write)
  server.registerTool(
    "dockerhub_delete_tag",
    {
      title: "Delete Tag",
      description: "Permanently deletes a specific tag from a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name"),
        tag: z.string().describe("Tag name to delete"),
        namespace: z.string().optional().describe("Namespace (defaults to configured username)")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, tag, namespace }) => {
      try {
        const headers = await getHeaders();
        const targetNamespace = namespace || getSettings().username;
        await fetchJson(`https://hub.docker.com/v2/repositories/${encodeURIComponent(targetNamespace)}/${encodeURIComponent(repository)}/tags/${encodeURIComponent(tag)}/`, {
          method: "DELETE",
          headers
        });
        return {
          content: [{ type: "text", text: `### Tag Deleted Successfully!\n\n**Repo:** ${targetNamespace}/${repository}:${tag}` }]
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 13: List Build Triggers (Read)
  server.registerTool(
    "dockerhub_list_build_triggers",
    {
      title: "List Build Triggers",
      description: "Retrieves list of configured build triggers for automated builds on a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name"),
        namespace: z.string().optional().describe("Namespace (defaults to configured username)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ repository, namespace }) => {
      try {
        const headers = await getHeaders();
        const targetNamespace = namespace || getSettings().username;
        const res = await fetchJson(`https://hub.docker.com/v2/repositories/${encodeURIComponent(targetNamespace)}/${encodeURIComponent(repository)}/buildtrigger/`, { headers });
        return {
          content: [{ type: "text", text: `### Build Triggers for ${targetNamespace}/${repository}\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 14: Create Build Trigger (Write)
  server.registerTool(
    "dockerhub_create_build_trigger",
    {
      title: "Create Build Trigger",
      description: "Creates a new automated build trigger for a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name"),
        name: z.string().describe("Name/label for the trigger"),
        namespace: z.string().optional().describe("Namespace (defaults to configured username)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, name, namespace }) => {
      try {
        const headers = await getHeaders();
        const targetNamespace = namespace || getSettings().username;
        const res = await fetchJson(`https://hub.docker.com/v2/repositories/${encodeURIComponent(targetNamespace)}/${encodeURIComponent(repository)}/buildtrigger/`, {
          method: "POST",
          headers,
          body: JSON.stringify({ name })
        });
        return {
          content: [{ type: "text", text: `### Build Trigger Created Successfully!\n\n**Repo:** ${targetNamespace}/${repository}\n**Trigger Name:** ${name}\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 15: Trigger Build (Action/Write)
  server.registerTool(
    "dockerhub_trigger_build",
    {
      title: "Trigger Automated Build",
      description: "Triggers an automated build for a repository using a trigger token or direct trigger URL.",
      inputSchema: {
        repository: z.string().describe("Repository name"),
        triggerToken: z.string().describe("The secret build trigger token (or UUID)"),
        namespace: z.string().optional().describe("Namespace (defaults to configured username)"),
        sourceType: z.string().optional().describe("Source type, e.g. 'Branch' or 'Tag'"),
        sourceName: z.string().optional().describe("Name of branch or tag to build")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, triggerToken, namespace, sourceType, sourceName }) => {
      try {
        const targetNamespace = namespace || getSettings().username;
        const triggerUrl = `https://registry.hub.docker.com/u/${encodeURIComponent(targetNamespace)}/${encodeURIComponent(repository)}/trigger/${encodeURIComponent(triggerToken)}/trigger/`;

        const body = {};
        if (sourceType) body.source_type = sourceType;
        if (sourceName) body.source_name = sourceName;

        const res = await fetchJson(triggerUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        return {
          content: [{ type: "text", text: `### Build Triggered!\n\n**Repo:** ${targetNamespace}/${repository}\n**Response:**\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 16: List Tag Images (Multi-arch digests, layers, OS, arch)
  server.registerTool(
    "dockerhub_list_tag_images",
    {
      title: "List Tag Images & Architectures",
      description: "Lists all architecture-specific images, digests, OS, and layer sizes for a given repository tag.",
      inputSchema: {
        repository: z.string().describe("Repository name"),
        tag: z.string().describe("Tag name (e.g. 'latest')"),
        namespace: z.string().optional().describe("Namespace (defaults to configured username)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ repository, tag, namespace }) => {
      try {
        const headers = await getHeaders();
        const targetNamespace = namespace || getSettings().username;
        const res = await fetchJson(`https://hub.docker.com/v2/repositories/${encodeURIComponent(targetNamespace)}/${encodeURIComponent(repository)}/tags/${encodeURIComponent(tag)}/images`, { headers });
        return {
          content: [{ type: "text", text: `### Images for ${targetNamespace}/${repository}:${tag}\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 17: List Webhooks
  server.registerTool(
    "dockerhub_list_webhooks",
    {
      title: "List Repository Webhooks",
      description: "Lists configured webhook pipelines for a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name"),
        namespace: z.string().optional().describe("Namespace (defaults to configured username)"),
        page: z.number().int().min(1).default(1).describe("Page number"),
        pageSize: z.number().int().min(1).max(100).default(10).describe("Number of items per page")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ repository, namespace, page, pageSize }) => {
      try {
        const headers = await getHeaders();
        const targetNamespace = namespace || getSettings().username;
        const query = buildQueryString({ page, page_size: pageSize });
        const res = await fetchJson(`https://hub.docker.com/v2/repositories/${encodeURIComponent(targetNamespace)}/${encodeURIComponent(repository)}/webhook_pipeline/${query}`, { headers });
        return {
          content: [{ type: "text", text: `### Webhooks for ${targetNamespace}/${repository} (Page ${page})\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 18: Create Webhook
  server.registerTool(
    "dockerhub_create_webhook",
    {
      title: "Create Repository Webhook",
      description: "Creates a webhook pipeline triggered upon successful image pushes to a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name"),
        name: z.string().describe("Webhook name / description"),
        targetUrl: z.string().url().describe("Target callback webhook URL (HTTP/HTTPS)"),
        namespace: z.string().optional().describe("Namespace (defaults to configured username)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, name, targetUrl, namespace }) => {
      try {
        const headers = await getHeaders();
        const targetNamespace = namespace || getSettings().username;
        const body = {
          name,
          expect_final_callback: false,
          webhooks: [{ name, target_url: targetUrl }]
        };
        const res = await fetchJson(`https://hub.docker.com/v2/repositories/${encodeURIComponent(targetNamespace)}/${encodeURIComponent(repository)}/webhook_pipeline/`, {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        });
        return {
          content: [{ type: "text", text: `### Webhook Created!\n\n**Repo:** ${targetNamespace}/${repository}\n**Target:** ${targetUrl}\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 19: Delete Webhook
  server.registerTool(
    "dockerhub_delete_webhook",
    {
      title: "Delete Repository Webhook",
      description: "Deletes a webhook pipeline from a repository.",
      inputSchema: {
        repository: z.string().describe("Repository name"),
        webhookUuid: z.string().describe("Webhook UUID / ID to delete"),
        namespace: z.string().optional().describe("Namespace (defaults to configured username)")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ repository, webhookUuid, namespace }) => {
      try {
        const headers = await getHeaders();
        const targetNamespace = namespace || getSettings().username;
        await fetchJson(`https://hub.docker.com/v2/repositories/${encodeURIComponent(targetNamespace)}/${encodeURIComponent(repository)}/webhook_pipeline/${encodeURIComponent(webhookUuid)}/`, {
          method: "DELETE",
          headers
        });
        return {
          content: [{ type: "text", text: `### Webhook ${webhookUuid} Deleted Successfully from ${targetNamespace}/${repository}` }]
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Helper to format token error when Hub forbids PAT-to-PAT operations
  function formatTokenError(err) {
    const msg = err.message || "";
    if (msg.includes("token issued from personal access token is not allowed") || msg.includes("403")) {
      return `Docker Hub Policy Notice: Docker Hub forbids a Personal Access Token (PAT) from managing or minting other PATs / OATs.\n\n` +
        `• Why: When authenticated using a PAT, Docker Hub blocks access to the /v2/access-tokens endpoints for security.\n` +
        `• Solution 1 (Web UI): Create a token directly at https://hub.docker.com/settings/security\n` +
        `• Solution 2 (API Automation): In MCP Station → Docker Hub Settings, configure your primary account password instead of a PAT.`;
    }
    return `Error: ${msg}`;
  }

  // Tool 20: List Access Tokens (PATs)
  server.registerTool(
    "dockerhub_list_access_tokens",
    {
      title: "List Personal Access Tokens",
      description: "Lists personal access tokens (PATs) created for your Docker Hub account. Note: Docker Hub requires account password authentication to manage tokens; PAT credentials return 403.",
      inputSchema: {
        page: z.number().int().min(1).default(1).describe("Page number"),
        pageSize: z.number().int().min(1).max(100).default(10).describe("Number of items per page")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ page, pageSize }) => {
      try {
        const headers = await getHeaders();
        const query = buildQueryString({ page, page_size: pageSize });
        const res = await fetchJson(`https://hub.docker.com/v2/access-tokens${query}`, { headers });
        return {
          content: [{ type: "text", text: `### Personal Access Tokens (Page ${page})\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: formatTokenError(e) }] };
      }
    }
  );

  // Tool 21: Create Access Token (PAT)
  server.registerTool(
    "dockerhub_create_access_token",
    {
      title: "Create Personal Access Token",
      description: "Creates a new Personal Access Token (PAT) with specified permissions (e.g. read, write, admin). Note: Docker Hub requires account password authentication to mint tokens; PAT credentials return 403.",
      inputSchema: {
        tokenLabel: z.string().describe("Friendly label for the access token"),
        scopes: z.array(z.string()).default(["repo:read", "repo:write", "repo:admin"]).describe("Token scopes/permissions (e.g. ['repo:read'], ['repo:read', 'repo:write'], etc.)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ tokenLabel, scopes }) => {
      try {
        const headers = await getHeaders();
        const res = await fetchJson("https://hub.docker.com/v2/access-tokens", {
          method: "POST",
          headers,
          body: JSON.stringify({
            token_label: tokenLabel,
            scopes
          })
        });
        return {
          content: [{ type: "text", text: `### Personal Access Token Created!\n\n**Label:** ${tokenLabel}\n**Token UUID:** ${res.uuid || "N/A"}\n**Token:** \`${res.token || "N/A"}\`\n\n*Save this token securely now, as it cannot be viewed again.*` }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: formatTokenError(e) }] };
      }
    }
  );

  // Tool 22: Revoke/Delete Access Token (PAT)
  server.registerTool(
    "dockerhub_delete_access_token",
    {
      title: "Delete Personal Access Token",
      description: "Permanently revokes and deletes a Personal Access Token (PAT) by its UUID.",
      inputSchema: {
        tokenUuid: z.string().describe("UUID of the access token to revoke")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ tokenUuid }) => {
      try {
        const headers = await getHeaders();
        await fetchJson(`https://hub.docker.com/v2/access-tokens/${encodeURIComponent(tokenUuid)}`, {
          method: "DELETE",
          headers
        });
        return {
          content: [{ type: "text", text: `### Access Token ${tokenUuid} Deleted/Revoked Successfully.` }]
        };
      } catch (e) {
        return { content: [{ type: "text", text: formatTokenError(e) }] };
      }
    }
  );

  // Tool 23: Generate Token for GitHub Actions / CI-CD Workflows
  server.registerTool(
    "dockerhub_generate_github_token",
    {
      title: "Generate GitHub Actions Token & Setup",
      description: "Generates or guides Docker Hub token setup for GitHub Actions / CI-CD workflows. If using password auth, mints a new PAT via API. If using PAT auth (Hub 403 restriction), guides immediate secret setup with your configured PAT and complete workflow YAML.",
      inputSchema: {
        description: z.string().default("GitHub Actions CI/CD").describe("Description or label for the token (e.g. 'GitHub Actions - my-repo')"),
        permission: z.enum(["read", "write", "admin"]).default("write").describe("Permission level: 'read' (pull only), 'write' (pull & push), or 'admin' (full access)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ description, permission }) => {
      const { username, pat } = getSettings();
      let scopes = ["repo:read", "repo:write"];
      if (permission === "read") scopes = ["repo:read"];
      else if (permission === "admin") scopes = ["repo:read", "repo:write", "repo:admin"];

      try {
        const headers = await getHeaders();
        const res = await fetchJson("https://hub.docker.com/v2/access-tokens", {
          method: "POST",
          headers,
          body: JSON.stringify({
            token_label: description,
            scopes
          })
        });

        const token = res.token || "N/A";
        const uuid = res.uuid || "N/A";

        const markdown = `### Docker Hub Token for GitHub Generated Successfully! 🎉

**Token Label:** \`${description}\`
**Token UUID:** \`${uuid}\`
**Permission Level:** \`${permission}\` (Scopes: \`${scopes.join(", ")}\`)
**Raw Token:** \`${token}\`

---

### Step 1: Add Secrets to GitHub
In your GitHub repository, navigate to **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
1. **Secret Name:** \`DOCKERHUB_USERNAME\`
   **Value:** \`${username}\`
2. **Secret Name:** \`DOCKERHUB_TOKEN\`
   **Value:** \`${token}\`

*(GitHub secrets are write-only once created — paste the token now!)*

---

### Step 2: GitHub Actions Workflow
Add or update your \`.github/workflows/docker-build-push.yml\`:

\`\`\`yaml
name: Build and Push Docker Image

on:
  push:
    branches: [ "main" ]
  workflow_dispatch:

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up QEMU (for multi-architecture builds)
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Docker Hub
        uses: docker/login-action@v3
        with:
          username: \${{ secrets.DOCKERHUB_USERNAME }}
          password: \${{ secrets.DOCKERHUB_TOKEN }}

      - name: Build and push Docker image
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${username}/<your-repo-name>:latest
\`\`\``;

        return {
          content: [{ type: "text", text: markdown }],
          structuredContent: {
            ...res,
            username,
            permission,
            githubSecretUsername: "DOCKERHUB_USERNAME",
            githubSecretToken: "DOCKERHUB_TOKEN"
          }
        };
      } catch (e) {
        // Docker Hub returns 403 if authenticated via PAT instead of password
        const workflowYaml = `name: Build and Push Docker Image

on:
  push:
    branches: [ "main" ]
  workflow_dispatch:

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up QEMU (for multi-architecture builds)
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Docker Hub
        uses: docker/login-action@v3
        with:
          username: \${{ secrets.DOCKERHUB_USERNAME }}
          password: \${{ secrets.DOCKERHUB_TOKEN }}

      - name: Build and push Docker image
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${username || "<username>"}/<your-repo-name>:latest`;

        const fallbackMarkdown = `### GitHub Actions CI/CD Docker Hub Setup

Docker Hub policy prevents minting new PATs using an existing PAT (returns 403). Here is how to complete your GitHub Actions setup:

---

### Option A: Create a Dedicated PAT in Docker Hub (Recommended)
1. Open Docker Hub: **https://hub.docker.com/settings/security**
2. Click **New Access Token**.
3. Name it \`${description}\` and choose permissions (\`${permission === "read" ? "Read-only" : permission === "admin" ? "Admin" : "Read, Write, Delete"}\`).
4. Copy the generated token string immediately.

---

### Option B: Use Your Existing PAT
If your currently configured PAT in MCP Station has \`repo:write\` permissions, you can use it directly in GitHub.

---

### Step 2: Add Secrets in GitHub (Write-Only)
In your GitHub repository, go to **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
1. **Name:** \`DOCKERHUB_USERNAME\`
   **Value:** \`${username || "<your-dockerhub-username>"}\`
2. **Name:** \`DOCKERHUB_TOKEN\`
   **Value:** *(Your generated PAT from Docker Hub or MCP Station setting)*

*(Note: GitHub secrets are write-only once saved for security).*

---

### Step 3: Workflow File (\`.github/workflows/docker-build-push.yml\`)

\`\`\`yaml
${workflowYaml}
\`\`\``;

        return {
          content: [{ type: "text", text: fallbackMarkdown }],
          structuredContent: {
            username,
            permission,
            githubSecretUsername: "DOCKERHUB_USERNAME",
            githubSecretToken: "DOCKERHUB_TOKEN",
            workflowYaml,
            policyNotice: "Docker Hub does not permit a PAT to mint other PATs via API. Create dedicated tokens at https://hub.docker.com/settings/security or configure password in Settings."
          }
        };
      }
    }
  );

  // Tool 24: List Organization Access Tokens (OATs)
  server.registerTool(
    "dockerhub_list_org_access_tokens",
    {
      title: "List Organization Access Tokens",
      description: "Lists organization access tokens (OATs) configured for an organization.",
      inputSchema: {
        org: z.string().describe("Organization name"),
        page: z.number().int().min(1).default(1).describe("Page number"),
        pageSize: z.number().int().min(1).max(100).default(10).describe("Number of items per page")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ org, page, pageSize }) => {
      try {
        const headers = await getHeaders();
        const query = buildQueryString({ page, page_size: pageSize });
        const res = await fetchJson(`https://hub.docker.com/v2/orgs/${encodeURIComponent(org)}/access-tokens${query}`, { headers });
        return {
          content: [{ type: "text", text: `### Organization Access Tokens for "${org}" (Page ${page})\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: formatTokenError(e) }] };
      }
    }
  );

  // Tool 25: Create Organization Access Token (OAT)
  server.registerTool(
    "dockerhub_create_org_access_token",
    {
      title: "Create Organization Access Token",
      description: "Creates a new Organization Access Token (OAT) for automation, CI/CD, or GitHub Actions under an organization.",
      inputSchema: {
        org: z.string().describe("Organization name"),
        label: z.string().describe("Token label / friendly name"),
        description: z.string().optional().describe("Description for the token"),
        expiresAt: z.string().optional().describe("Optional ISO-8601 expiration date (e.g. '2026-12-31T23:59:59Z')")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ org, label, description, expiresAt }) => {
      try {
        const headers = await getHeaders();
        const body = {
          label,
          description: description || "",
          expires_at: expiresAt || null
        };
        const res = await fetchJson(`https://hub.docker.com/v2/orgs/${encodeURIComponent(org)}/access-tokens`, {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        });
        return {
          content: [{ type: "text", text: `### Organization Access Token Created for "${org}"!\n\n**Label:** ${label}\n**Token ID:** ${res.id || "N/A"}\n**Token:** \`${res.token || "N/A"}\`\n\n*Save this token securely now, as it cannot be viewed again.*` }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: formatTokenError(e) }] };
      }
    }
  );

  // Tool 26: Delete Organization Access Token (OAT)
  server.registerTool(
    "dockerhub_delete_org_access_token",
    {
      title: "Delete Organization Access Token",
      description: "Permanently deletes / revokes an Organization Access Token (OAT) by its token ID.",
      inputSchema: {
        org: z.string().describe("Organization name"),
        tokenId: z.string().describe("ID / UUID of the organization access token to delete")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ org, tokenId }) => {
      try {
        const headers = await getHeaders();
        await fetchJson(`https://hub.docker.com/v2/orgs/${encodeURIComponent(org)}/access-tokens/${encodeURIComponent(tokenId)}`, {
          method: "DELETE",
          headers
        });
        return {
          content: [{ type: "text", text: `### Org Access Token ${tokenId} Deleted Successfully from "${org}".` }]
        };
      } catch (e) {
        return { content: [{ type: "text", text: formatTokenError(e) }] };
      }
    }
  );

  // Tool 27: List Org Members
  server.registerTool(
    "dockerhub_list_org_members",
    {
      title: "List Organization Members",
      description: "Lists members of an organization.",
      inputSchema: {
        org: z.string().describe("Organization name"),
        page: z.number().int().min(1).default(1).describe("Page number"),
        pageSize: z.number().int().min(1).max(100).default(10).describe("Number of items per page")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ org, page, pageSize }) => {
      try {
        const headers = await getHeaders();
        const query = buildQueryString({ page, page_size: pageSize });
        const res = await fetchJson(`https://hub.docker.com/v2/orgs/${encodeURIComponent(org)}/members/${query}`, { headers });
        return {
          content: [{ type: "text", text: `### Members of Org "${org}" (Page ${page})\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 28: List Org Teams
  server.registerTool(
    "dockerhub_list_org_teams",
    {
      title: "List Organization Teams",
      description: "Lists teams/groups within an organization.",
      inputSchema: {
        org: z.string().describe("Organization name"),
        page: z.number().int().min(1).default(1).describe("Page number"),
        pageSize: z.number().int().min(1).max(100).default(10).describe("Number of items per page")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ org, page, pageSize }) => {
      try {
        const headers = await getHeaders();
        const query = buildQueryString({ page, page_size: pageSize });
        const res = await fetchJson(`https://hub.docker.com/v2/orgs/${encodeURIComponent(org)}/groups/${query}`, { headers });
        return {
          content: [{ type: "text", text: `### Teams in Org "${org}" (Page ${page})\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 29: List Team Members
  server.registerTool(
    "dockerhub_list_team_members",
    {
      title: "List Team Members",
      description: "Lists members of a specific team/group within an organization.",
      inputSchema: {
        org: z.string().describe("Organization name"),
        team: z.string().describe("Team / group name"),
        page: z.number().int().min(1).default(1).describe("Page number"),
        pageSize: z.number().int().min(1).max(100).default(10).describe("Number of items per page")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ org, team, page, pageSize }) => {
      try {
        const headers = await getHeaders();
        const query = buildQueryString({ page, page_size: pageSize });
        const res = await fetchJson(`https://hub.docker.com/v2/orgs/${encodeURIComponent(org)}/groups/${encodeURIComponent(team)}/members/${query}`, { headers });
        return {
          content: [{ type: "text", text: `### Members of Team "${team}" in Org "${org}" (Page ${page})\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 30: List Starred Repositories
  server.registerTool(
    "dockerhub_list_starred",
    {
      title: "List Starred Repositories",
      description: "Lists repositories starred by a user.",
      inputSchema: {
        username: z.string().optional().describe("Username (defaults to configured username)"),
        page: z.number().int().min(1).default(1).describe("Page number"),
        pageSize: z.number().int().min(1).max(100).default(10).describe("Number of items per page")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ username, page, pageSize }) => {
      try {
        const headers = await getHeaders();
        const targetUsername = username || getSettings().username;
        const query = buildQueryString({ page, page_size: pageSize });
        const res = await fetchJson(`https://hub.docker.com/v2/users/${encodeURIComponent(targetUsername)}/starred/${query}`, { headers });
        return {
          content: [{ type: "text", text: `### Starred Repositories for ${targetUsername} (Page ${page})\n\n` + JSON.stringify(res, null, 2) }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );
}

async function testService(settings, { fetchJson }) {
  const missing = configurationError("dockerhub", settings);
  if (missing) return { ok: false, message: `${missing}. Open Settings.` };
  if (!settings.username || !settings.pat) {
    return { ok: false, message: "Missing username or PAT settings" };
  }
  try {
    const res = await fetchJson("https://hub.docker.com/v2/users/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: settings.username, password: settings.pat })
    });
    if (res && res.token) {
      return { ok: true, message: `Successfully authenticated as ${settings.username}` };
    }
    return { ok: false, message: "Authentication failed: No token returned." };
  } catch (e) {
    return { ok: false, message: `Authentication failed: ${e.message}` };
  }
}

/** UI connectivity checks never expose provider bodies or account/session details. */
export async function test(settings, context = {}) {
  const missing = configurationError("dockerhub", settings);
  if (missing) return { ok: false, message: `${missing}. Open Settings.` };
  try {
    const result = await testService(settings, context);
    return result.ok ? { ok: true, message: "Connection successful." } :
      { ok: false, message: "Connection failed. Check Settings, permissions and service availability." };
  } catch {
    return { ok: false, message: "Connection failed. Check Settings, permissions and service availability." };
  }
}
