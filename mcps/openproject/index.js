// mcps/openproject/index.js
// OpenProject module for MCP Station.
// Full tool set: work packages (get/list/create+parent), projects (list/get/create/delete/update),
// users, statuses, types. Auth = HTTP Basic ("apikey":<api_key>) against OpenProject API v3.
//
// Fixes vs the previous build:
//  1. makeRequest tolerates empty-body responses (DELETE → 202/204) instead of crashing on JSON parse.
//  2. list_work_packages builds ONE url-encoded `filters` array (previously multiple `filters=` params
//     silently dropped all but the last, and the JSON was unencoded).

// Helper to normalize API URL (removes trailing slash if present)
function normalizeApiUrl(url) {
  if (!url) return null;
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

// Helper for making authenticated requests to OpenProject API.
// Uses the module's fetchJson helper but tolerates empty success bodies (e.g. DELETE).
async function makeRequest(settings, fetchJson, method, path, body = null) {
  const apiUrl = normalizeApiUrl(settings.api_url);
  const { api_key } = settings;
  if (!apiUrl || !api_key) {
    throw new Error("OpenProject API URL or API Key is not configured. Open MCP Station → OpenProject → Settings.");
  }
  // Basic Auth with "apikey" as username and the token as password
  const authString = btoa(`apikey:${api_key}`); // btoa is a global in Node 18+
  const headers = {
    "Authorization": `Basic ${authString}`,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
  const url = `${apiUrl}${path}`;
  const options = {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  };
  try {
    const response = await fetchJson(url, options);
    return response;
  } catch (e) {
    // A successful DELETE/202/204 returns an empty body; fetchJson tries to JSON-parse it and throws.
    // If there's no HTTP error attached (no e.response), treat an empty/parse failure as success.
    if (!e.response && /JSON|Unexpected end|parse|Empty/i.test(e.message || "")) {
      return null;
    }
    const errorBody = e.response && e.response.body ? JSON.stringify(e.response.body) : 'No specific error details.';
    if (e.response && e.response.status === 401) {
      throw new Error(`Authentication failed. Check your API Key. OpenProject API responded with 401. Details: ${errorBody}`);
    }
    if (e.response && e.response.status === 403) {
      throw new Error(`Permission denied (403) at ${url}. The API key's user needs project admin rights (Create/Delete project). Details: ${errorBody}`);
    }
    throw new Error(`OpenProject API Error: ${e.message} at ${url}. Details: ${errorBody}`);
  }
}

// --- Formatters for tool output ---
function formatWorkPackage(wp) {
  if (!wp) return "Work package not found.";
  const assign = wp._links.assignee ? wp._links.assignee.title : 'Unassigned';
  const project = wp._links.project ? wp._links.project.title : 'N/A';
  const type = wp._links.type ? wp._links.type.title : 'N/A';
  const status = wp._links.status ? wp._links.status.title : 'N/A';
  const priority = wp._links.priority ? wp._links.priority.title : 'N/A';
  const parent = wp._links.parent && wp._links.parent.title ? wp._links.parent.title : 'None';
  const startDate = wp.startDate ? new Date(wp.startDate).toLocaleDateString() : 'N/A';
  const dueDate = wp.dueDate ? new Date(wp.dueDate).toLocaleDateString() : 'N/A';
  const url = wp._links.self && wp._links.self.href ? wp._links.self.href.replace('/api/v3', '') : '';
  const rawDescription = wp.description && wp.description.raw ? wp.description.raw : '';
  const description = rawDescription.length > 200 ? rawDescription.substring(0, 200) + '...' : rawDescription;
  return `### Work Package: ${wp.subject} (ID: ${wp.id})
-   **Project**: ${project}
-   **Type**: ${type}
-   **Status**: ${status}
-   **Priority**: ${priority}
-   **Parent**: ${parent}
-   **Assignee**: ${assign}
-   **Start Date**: ${startDate}
-   **Due Date**: ${dueDate}
-   **Description**: ${description || 'No description.'}
-   **URL**: ${url}`;
}

function formatWorkPackagesList(wps, total) {
  if (!wps || !wps._embedded || wps._embedded.elements.length === 0) return "No work packages found matching criteria.";
  let output = `Found ${total} work packages. Showing ${wps._embedded.elements.length}:\n\n`;
  wps._embedded.elements.forEach(wp => {
    const assign = wp._links.assignee ? wp._links.assignee.title : 'Unassigned';
    const project = wp._links.project ? wp._links.project.title : 'N/A';
    const type = wp._links.type ? wp._links.type.title : 'N/A';
    const status = wp._links.status ? wp._links.status.title : 'N/A';
    output += `- **${wp.subject}** (ID: ${wp.id}) - Project: ${project}, Type: ${type}, Status: ${status}, Assignee: ${assign}\n`;
  });
  if (total > wps._embedded.elements.length) {
    output += `\n...There are ${total - wps._embedded.elements.length} more. Use 'offset' to retrieve them.`;
  }
  return output;
}

function formatProject(proj) {
  if (!proj) return "Project not found.";
  const status = proj._links && proj._links.status ? proj._links.status.title : 'Active';
  const parent = proj._links && proj._links.parent && proj._links.parent.title ? proj._links.parent.title : 'None (top-level)';
  const createdAt = proj.createdAt ? new Date(proj.createdAt).toLocaleDateString() : 'N/A';
  const description = proj.description && proj.description.raw ? (proj.description.raw.length > 200 ? proj.description.raw.substring(0, 200) + '...' : proj.description.raw) : 'No description.';
  return `### Project: ${proj.name} (ID: ${proj.id})
-   **Identifier**: ${proj.identifier}
-   **Parent**: ${parent}
-   **Description**: ${description}
-   **Status**: ${status}
-   **Created At**: ${createdAt}
-   **Public**: ${proj.public ? 'Yes' : 'No'}
-   **Active**: ${proj.active ? 'Yes' : 'No'}`;
}

function formatProjectsList(projects, total) {
  if (!projects || !projects._embedded || projects._embedded.elements.length === 0) return "No projects found.";
  let output = `Found ${total} projects. Showing ${projects._embedded.elements.length}:\n\n`;
  projects._embedded.elements.forEach(proj => {
    const parent = proj._links && proj._links.parent && proj._links.parent.title ? ` (parent: ${proj._links.parent.title})` : '';
    output += `- **${proj.name}** (ID: ${proj.id}) - Identifier: ${proj.identifier}${parent}\n`;
  });
  if (total > projects._embedded.elements.length) {
    output += `\n...There are ${total - projects._embedded.elements.length} more. Use 'offset' to retrieve them.`;
  }
  return output;
}

function formatUser(user) {
  if (!user) return "User not found.";
  return `### User: ${user.name} (ID: ${user.id})
-   **First Name**: ${user.firstName || 'N/A'}
-   **Last Name**: ${user.lastName || 'N/A'}
-   **Email**: ${user.email || 'N/A'}
-   **Status**: ${user.status || 'N/A'}`;
}

function formatUsersList(users, total) {
  if (!users || !users._embedded || users._embedded.elements.length === 0) return "No users found.";
  let output = `Found ${total} users. Showing ${users._embedded.elements.length}:\n\n`;
  users._embedded.elements.forEach(user => {
    output += `- **${user.name}** (ID: ${user.id}) - Email: ${user.email}\n`;
  });
  if (total > users._embedded.elements.length) {
    output += `\n...There are ${total - users._embedded.elements.length} more. Use 'offset' to retrieve them.`;
  }
  return output;
}

function formatStatus(status) {
  if (!status) return "Status not found.";
  return `### Work Package Status: ${status.name} (ID: ${status.id})
-   **Is Default**: ${status.isDefault ? 'Yes' : 'No'}
-   **Is Closed**: ${status.isClosed ? 'Yes' : 'No'}`;
}

function formatStatusesList(statuses, total) {
  if (!statuses || !statuses._embedded || statuses._embedded.elements.length === 0) return "No statuses found.";
  let output = `Found ${total} statuses. Showing ${statuses._embedded.elements.length}:\n\n`;
  statuses._embedded.elements.forEach(status => {
    output += `- **${status.name}** (ID: ${status.id}) - Is Closed: ${status.isClosed ? 'Yes' : 'No'}\n`;
  });
  if (total > statuses._embedded.elements.length) {
    output += `\n...There are ${total - statuses._embedded.elements.length} more. Use 'offset' to retrieve them.`;
  }
  return output;
}

function formatType(type) {
  if (!type) return "Type not found.";
  return `### Work Package Type: ${type.name} (ID: ${type.id})
-   **Is Default**: ${type.isDefault ? 'Yes' : 'No'}
-   **Is Milestone**: ${type.isMilestone ? 'Yes' : 'No'}
-   **Color**: ${type.color || 'N/A'}`;
}

function formatTypesList(types, total) {
  if (!types || !types._embedded || types._embedded.elements.length === 0) return "No types found.";
  let output = `Found ${total} types. Showing ${types._embedded.elements.length}:\n\n`;
  types._embedded.elements.forEach(type => {
    output += `- **${type.name}** (ID: ${type.id})\n`;
  });
  if (total > types._embedded.elements.length) {
    output += `\n...There are ${total - types._embedded.elements.length} more. Use 'offset' to retrieve them.`;
  }
  return output;
}

export function register({ server, z, getSettings, log, fetchJson }) {
  // --- Work Package Tools ---
  server.registerTool(
    "openproject_get_work_package",
    {
      title: "Get Work Package Details",
      description: "Retrieves details for a specific work package by its ID.\n\nArgs: id (number, required).\nReturns: Markdown formatted work package details including subject, project, status, assignee, dates, and description.\nErrors: 'Work package not found.' or API error.",
      inputSchema: {
        id: z.number().int().positive().describe("The ID of the work package to retrieve")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ id }) => {
      try {
        const wp = await makeRequest(getSettings(), fetchJson, "GET", `/work_packages/${id}`);
        return { content: [{ type: "text", text: formatWorkPackage(wp) }], structuredContent: wp };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "openproject_list_work_packages",
    {
      title: "List Work Packages",
      description: "Lists work packages, optionally filtered by project, assignee, status, or type. Supports pagination.\n\nArgs: `projectId` (number, optional), `assigneeId` (number, optional), `statusId` (number, optional), `typeId` (number, optional), `subject` (string, optional, full-text search), `pageSize` (number, default 20), `offset` (number, default 0).\nReturns: A markdown list of work packages.\nErrors: API error.",
      inputSchema: {
        projectId: z.number().int().positive().optional().describe("Filter by project ID"),
        assigneeId: z.number().int().positive().optional().describe("Filter by assignee user ID"),
        statusId: z.number().int().positive().optional().describe("Filter by work package status ID"),
        typeId: z.number().int().positive().optional().describe("Filter by work package type ID"),
        subject: z.string().min(1).optional().describe("Full-text search in work package subject"),
        pageSize: z.number().int().min(1).max(100).default(20).describe("Number of items to return per page"),
        offset: z.number().int().min(0).default(0).describe("Offset for pagination (e.g., 20 for second page)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ projectId, assigneeId, statusId, typeId, subject, pageSize, offset }) => {
      try {
        // Build ONE filters array and url-encode it once.
        const filters = [];
        if (projectId)  filters.push({ project:  { operator: "=", values: [String(projectId)]  } });
        if (assigneeId) filters.push({ assignee: { operator: "=", values: [String(assigneeId)] } });
        if (statusId)   filters.push({ status:   { operator: "=", values: [String(statusId)]   } });
        if (typeId)     filters.push({ type:     { operator: "=", values: [String(typeId)]     } });
        if (subject)    filters.push({ subject:  { operator: "~", values: [subject]            } });

        let query = `?pageSize=${pageSize}&offset=${offset}`;
        if (filters.length) query += `&filters=${encodeURIComponent(JSON.stringify(filters))}`;

        const wps = await makeRequest(getSettings(), fetchJson, "GET", `/work_packages${query}`);
        return { content: [{ type: "text", text: formatWorkPackagesList(wps, wps.total) }], structuredContent: wps };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "openproject_create_work_package",
    {
      title: "Create Work Package",
      description: "Creates a new work package within a specified project. Optionally nests it under a parent work package (Epic → Task/Bug).\n\nArgs: `subject` (string, required), `projectId` (number, required), `description` (string, optional), `typeId` (number, optional), `statusId` (number, optional), `assigneeId` (number, optional), `priorityId` (number, optional), `startDate` (string, 'YYYY-MM-DD', optional), `dueDate` (string, 'YYYY-MM-DD', optional), `parentId` (number, optional - nests this under another work package).\nReturns: Markdown formatted details of the created work package.\nErrors: 'Missing project ID', 'Invalid ID', or API error.",
      inputSchema: {
        subject: z.string().min(1).describe("The subject (title) of the work package"),
        projectId: z.number().int().positive().describe("The ID of the project to create the work package in"),
        description: z.string().optional().describe("Description for the work package"),
        typeId: z.number().int().positive().optional().describe("ID of the work package type (e.g., 1 for Task, 2 for Milestone, 5 for Epic, 7 for Bug). Use openproject_list_types to find IDs."),
        statusId: z.number().int().positive().optional().describe("ID of the work package status (e.g., 1 for New). Use openproject_list_statuses to find IDs."),
        assigneeId: z.number().int().positive().optional().describe("ID of the user to assign the work package to."),
        priorityId: z.number().int().positive().optional().describe("ID of the work package priority."),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date in YYYY-MM-DD format"),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Due date in YYYY-MM-DD format"),
        parentId: z.number().int().positive().optional().describe("Parent work package ID (e.g. an Epic) to nest this under.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ subject, projectId, description, typeId, statusId, assigneeId, priorityId, startDate, dueDate, parentId }) => {
      if (!projectId) {
        return { content: [{ type: "text", text: "Error: `projectId` is required to create a work package." }] };
      }
      const body = {
        subject: subject,
        _links: {
          project: { href: `/api/v3/projects/${projectId}` }
        }
      };
      if (description) body.description = { raw: description };
      if (typeId) body._links.type = { href: `/api/v3/types/${typeId}` };
      if (statusId) body._links.status = { href: `/api/v3/statuses/${statusId}` };
      if (assigneeId) body._links.assignee = { href: `/api/v3/users/${assigneeId}` };
      if (priorityId) body._links.priority = { href: `/api/v3/priorities/${priorityId}` };
      if (startDate) body.startDate = startDate;
      if (dueDate) body.dueDate = dueDate;
      if (parentId) body._links.parent = { href: `/api/v3/work_packages/${parentId}` };
      try {
        const newWp = await makeRequest(getSettings(), fetchJson, "POST", "/work_packages", body);
        return { content: [{ type: "text", text: `Successfully created work package:\n${formatWorkPackage(newWp)}` }], structuredContent: newWp };
      } catch (e) {
        return { content: [{ type: "text", text: `Error creating work package: ${e.message}` }] };
      }
    }
  );

  // --- Project Tools ---
  server.registerTool(
    "openproject_list_projects",
    {
      title: "List Projects",
      description: "Lists projects available in OpenProject. Supports pagination.\n\nArgs: `pageSize` (number, default 20), `offset` (number, default 0), `filters` (string, optional, JSON string of filters, e.g. '[{\"name\":{\"operator\":\"=\",\"values\":[\"My Project\"]}}]').\nReturns: A markdown list of project names and IDs.\nErrors: API error.",
      inputSchema: {
        pageSize: z.number().int().min(1).max(100).default(20).describe("Number of items to return per page"),
        offset: z.number().int().min(0).default(0).describe("Offset for pagination"),
        filters: z.string().optional().describe("JSON string of OpenProject API filters (e.g., '[{\"name\":{\"operator\":\"=\",\"values\":[\"My Project\"]}}]')")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ pageSize, offset, filters }) => {
      try {
        let query = `?pageSize=${pageSize}&offset=${offset}`;
        if (filters) query += `&filters=${encodeURIComponent(filters)}`;
        const projects = await makeRequest(getSettings(), fetchJson, "GET", `/projects${query}`);
        return { content: [{ type: "text", text: formatProjectsList(projects, projects.total) }], structuredContent: projects };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "openproject_get_project",
    {
      title: "Get Project Details",
      description: "Retrieves details for a specific project by its ID or identifier.\n\nArgs: `id` (number, optional), `identifier` (string, optional). One of `id` or `identifier` is required.\nReturns: Markdown formatted project details including name, description, and status.\nErrors: 'Project not found.' or API error.",
      inputSchema: {
        id: z.number().int().positive().optional().describe("The ID of the project to retrieve"),
        identifier: z.string().min(1).optional().describe("The string identifier of the project to retrieve")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ id, identifier }) => {
      if (!id && !identifier) {
        return { content: [{ type: "text", text: "Error: Either `id` or `identifier` must be provided to get project details." }] };
      }
      try {
        let path = '';
        if (id) {
          path = `/projects/${id}`;
        } else {
          const projects = await makeRequest(getSettings(), fetchJson, "GET", `/projects?filters=${encodeURIComponent(JSON.stringify([{ identifier: { operator: "=", values: [identifier] } }]))}`);
          if (projects && projects._embedded && projects._embedded.elements.length > 0) {
            path = `/projects/${projects._embedded.elements[0].id}`;
          } else {
            return { content: [{ type: "text", text: `Error: Project with identifier '${identifier}' not found.` }] };
          }
        }
        const project = await makeRequest(getSettings(), fetchJson, "GET", path);
        return { content: [{ type: "text", text: formatProject(project) }], structuredContent: project };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "openproject_create_project",
    {
      title: "Create Project",
      description: "Create a project, optionally nested under a parent (parentId) to make a sub-project.\n\nArgs: `name` (string, required), `identifier` (string, optional - lowercase a-z, 0-9, hyphen; unique. Derived from name if omitted.), `parentId` (number, optional - Parent project ID; set this to create a sub-project.), `description` (string, optional - markdown), `isPublic` (boolean, optional).\nReturns: The new project's ID, name, identifier.\nErrors: API error, or 403 if the API key user lacks 'Create subprojects' permission on the parent.",
      inputSchema: {
        name: z.string().min(1).describe("Project name"),
        identifier: z.string().optional().describe("URL identifier (lowercase a-z, 0-9, hyphen; unique). Derived from name if omitted."),
        parentId: z.number().int().positive().optional().describe("Parent project ID — set this to create a sub-project."),
        description: z.string().optional().describe("Project description (markdown)."),
        isPublic: z.boolean().optional().describe("Whether the project is public.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ name, identifier, parentId, description, isPublic }) => {
      try {
        const body = { name };
        if (identifier) body.identifier = identifier;
        if (typeof isPublic === "boolean") body.public = isPublic;
        if (description) body.description = { raw: description };
        if (parentId) body._links = { parent: { href: `/api/v3/projects/${parentId}` } };

        const res = await makeRequest(getSettings(), fetchJson, "POST", "/projects", body);
        return {
          content: [{
            type: "text",
            text: `Created project #${res.id} — ${res.name} (identifier: ${res.identifier}` +
                  (parentId ? `, parent #${parentId})` : ")")
          }],
          structuredContent: res
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error creating project: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "openproject_delete_project",
    {
      title: "Delete Project",
      description: "Delete a project by ID. Deletion is permanent and runs as a background job (202).\n\nArgs: `id` (number, required).\nReturns: A confirmation string.\nErrors: API error, or 403 if the API key user lacks 'Delete project' permission.",
      inputSchema: {
        id: z.number().int().positive().describe("Project ID to delete.")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    async ({ id }) => {
      try {
        await makeRequest(getSettings(), fetchJson, "DELETE", `/projects/${id}`);
        return { content: [{ type: "text", text: `Delete accepted for project #${id} (async).` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error deleting project: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "openproject_update_project",
    {
      title: "Update Project",
      description: "Update a project's name, description, or parent. Set parentId to null to detach to top level.\n\nArgs: `id` (number, required), `name` (string, optional), `description` (string, optional, markdown), `parentId` (number or null, optional - null detaches to top level).\nReturns: A confirmation string with the updated project name.\nErrors: API error.",
      inputSchema: {
        id: z.number().int().positive().describe("Project ID."),
        name: z.string().optional().describe("New name."),
        description: z.string().optional().describe("New description (markdown)."),
        parentId: z.number().int().positive().nullable().optional().describe("New parent ID; null to detach to top level.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ id, name, description, parentId }) => {
      try {
        const body = {};
        if (name) body.name = name;
        if (description) body.description = { raw: description };
        if (parentId === null) body._links = { parent: { href: null } };
        else if (parentId) body._links = { parent: { href: `/api/v3/projects/${parentId}` } };

        const res = await makeRequest(getSettings(), fetchJson, "PATCH", `/projects/${id}`, body);
        return { content: [{ type: "text", text: `Updated project #${res.id} — ${res.name}` }], structuredContent: res };
      } catch (e) {
        return { content: [{ type: "text", text: `Error updating project: ${e.message}` }] };
      }
    }
  );

  // --- User Tools ---
  server.registerTool(
    "openproject_list_users",
    {
      title: "List Users",
      description: "Lists users in OpenProject. Supports pagination.\n\nArgs: `pageSize` (number, default 20), `offset` (number, default 0).\nReturns: A markdown list of user names and IDs.\nErrors: API error.",
      inputSchema: {
        pageSize: z.number().int().min(1).max(100).default(20).describe("Number of items to return per page"),
        offset: z.number().int().min(0).default(0).describe("Offset for pagination")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ pageSize, offset }) => {
      try {
        const users = await makeRequest(getSettings(), fetchJson, "GET", `/users?pageSize=${pageSize}&offset=${offset}`);
        return { content: [{ type: "text", text: formatUsersList(users, users.total) }], structuredContent: users };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "openproject_get_user",
    {
      title: "Get User Details",
      description: "Retrieves details for a specific user by ID.\n\nArgs: `id` (number, required).\nReturns: Markdown formatted user details including name, email, and status.\nErrors: 'User not found.' or API error.",
      inputSchema: {
        id: z.number().int().positive().describe("The ID of the user to retrieve")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ id }) => {
      try {
        const user = await makeRequest(getSettings(), fetchJson, "GET", `/users/${id}`);
        return { content: [{ type: "text", text: formatUser(user) }], structuredContent: user };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // --- Status Tools ---
  server.registerTool(
    "openproject_list_statuses",
    {
      title: "List Work Package Statuses",
      description: "Lists all available work package statuses.\n\nArgs: `pageSize` (number, default 20), `offset` (number, default 0).\nReturns: A markdown list of status names and IDs.\nErrors: API error.",
      inputSchema: {
        pageSize: z.number().int().min(1).max(100).default(20).describe("Number of items to return per page"),
        offset: z.number().int().min(0).default(0).describe("Offset for pagination")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ pageSize, offset }) => {
      try {
        const statuses = await makeRequest(getSettings(), fetchJson, "GET", `/statuses?pageSize=${pageSize}&offset=${offset}`);
        return { content: [{ type: "text", text: formatStatusesList(statuses, statuses.total) }], structuredContent: statuses };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "openproject_get_status",
    {
      title: "Get Work Package Status Details",
      description: "Retrieves details for a specific work package status by ID.\n\nArgs: `id` (number, required).\nReturns: Markdown formatted status details.\nErrors: 'Status not found.' or API error.",
      inputSchema: {
        id: z.number().int().positive().describe("The ID of the status to retrieve")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ id }) => {
      try {
        const status = await makeRequest(getSettings(), fetchJson, "GET", `/statuses/${id}`);
        return { content: [{ type: "text", text: formatStatus(status) }], structuredContent: status };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // --- Type Tools ---
  server.registerTool(
    "openproject_list_types",
    {
      title: "List Work Package Types",
      description: "Lists all available work package types.\n\nArgs: `pageSize` (number, default 20), `offset` (number, default 0).\nReturns: A markdown list of type names and IDs.\nErrors: API error.",
      inputSchema: {
        pageSize: z.number().int().min(1).max(100).default(20).describe("Number of items to return per page"),
        offset: z.number().int().min(0).default(0).describe("Offset for pagination")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ pageSize, offset }) => {
      try {
        const types = await makeRequest(getSettings(), fetchJson, "GET", `/types?pageSize=${pageSize}&offset=${offset}`);
        return { content: [{ type: "text", text: formatTypesList(types, types.total) }], structuredContent: types };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "openproject_get_type",
    {
      title: "Get Work Package Type Details",
      description: "Retrieves details for a specific work package type by ID.\n\nArgs: `id` (number, required).\nReturns: Markdown formatted type details.\nErrors: 'Type not found.' or API error.",
      inputSchema: {
        id: z.number().int().positive().describe("The ID of the type to retrieve")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ id }) => {
      try {
        const type = await makeRequest(getSettings(), fetchJson, "GET", `/types/${id}`);
        return { content: [{ type: "text", text: formatType(type) }], structuredContent: type };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  log && log("openproject module registered (14 tools)");
}