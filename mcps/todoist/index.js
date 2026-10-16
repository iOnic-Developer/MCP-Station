import { configurationError, guardedServer } from "./bundle.js";
async function apiRequest(path, { method = "GET", body = null, apiKey }) {
  if (!apiKey) {
    throw new Error("api_key is not configured. Open MCP Station → Todoist → Settings.");
  }
  const url = `https://api.todoist.com/api/v1${path}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
  };
  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) {
    return { success: true };
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Todoist API error (${res.status}): ${text || res.statusText}`);
  }

  return text ? JSON.parse(text) : { success: true };
}

function formatTask(t) {
  const priorityMap = { 4: "🔴 P1 (Urgent)", 3: "🟠 P2 (High)", 2: "🔵 P3 (Medium)", 1: "⚪ P4 (Normal)" };
  const due = t.due ? (t.due.datetime || t.due.date + (t.due.string ? ` (${t.due.string})` : "")) : "No due date";
  const labels = t.labels && t.labels.length > 0 ? ` [${t.labels.map(l => `@${l}`).join(", ")}]` : "";
  return `- **[${t.is_completed ? "x" : " "}] ${t.content}** (ID: \`${t.id}\`)${labels}\n  - Priority: ${priorityMap[t.priority] || t.priority} | Due: ${due}\n  - Project ID: \`${t.project_id}\`${t.description ? `\n  - Description: ${t.description}` : ""}`;
}

export function register({ server, z, getSettings, log }) {
  server = guardedServer(server, "todoist", getSettings, []);
  // 1. List Tasks
  server.registerTool(
    "todoist_list_tasks",
    {
      title: "List Tasks",
      description: "List active tasks in Todoist. Supports filtering by natural query (e.g. 'today', 'tomorrow', 'overdue', 'p1'), project_id, section_id, or label.",
      inputSchema: {
        filter: z.string().optional().describe("Filter query (e.g. 'today', 'overdue', 'p1', 'view all')"),
        project_id: z.string().optional().describe("Filter by project ID"),
        section_id: z.string().optional().describe("Filter by section ID"),
        label: z.string().optional().describe("Filter by label name")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ filter, project_id, section_id, label }) => {
      const { api_key } = getSettings();
      try {
        const params = new URLSearchParams();
        if (filter) params.append("filter", filter);
        if (project_id) params.append("project_id", project_id);
        if (section_id) params.append("section_id", section_id);
        if (label) params.append("label", label);

        const qs = params.toString() ? `?${params.toString()}` : "";
        const tasks = await apiRequest(`/tasks${qs}`, { apiKey: api_key });

        if (!tasks || tasks.length === 0) {
          return { content: [{ type: "text", text: "No tasks found matching the criteria." }] };
        }

        const list = Array.isArray(tasks) ? tasks : (tasks.results || []);
        const summary = `Found ${list.length} task(s):\n\n` + list.map(formatTask).join("\n\n");
        return {
          content: [{ type: "text", text: summary }],
          structuredContent: { count: list.length, tasks: list }
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error listing tasks: ${e.message}` }] };
      }
    }
  );

  // 2. Get Task
  server.registerTool(
    "todoist_get_task",
    {
      title: "Get Task",
      description: "Get full details of a specific Todoist task by ID.",
      inputSchema: {
        task_id: z.string().describe("The ID of the task to retrieve")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ task_id }) => {
      const { api_key } = getSettings();
      try {
        const task = await apiRequest(`/tasks/${encodeURIComponent(task_id)}`, { apiKey: api_key });
        return {
          content: [{ type: "text", text: formatTask(task) }],
          structuredContent: task
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error retrieving task ${task_id}: ${e.message}` }] };
      }
    }
  );

  // 3. Create Task
  server.registerTool(
    "todoist_create_task",
    {
      title: "Create Task",
      description: "Create a new task in Todoist with optional due dates, project, section, priority, and labels.",
      inputSchema: {
        content: z.string().min(1).describe("The task title / text"),
        description: z.string().optional().describe("Optional detailed markdown description"),
        project_id: z.string().optional().describe("Project ID to put the task in (defaults to Inbox)"),
        section_id: z.string().optional().describe("Section ID within the project"),
        due_string: z.string().optional().describe("Natural language due date, e.g. 'tomorrow at 5pm', 'every monday', 'today'"),
        due_date: z.string().optional().describe("Specific due date formatted as YYYY-MM-DD"),
        priority: z.number().int().min(1).max(4).optional().describe("Priority from 1 (normal) to 4 (urgent / P1 in UI)"),
        labels: z.array(z.string()).optional().describe("Array of label names")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ content, description, project_id, section_id, due_string, due_date, priority, labels }) => {
      const { api_key } = getSettings();
      try {
        const payload = { content };
        if (description !== undefined) payload.description = description;
        if (project_id) payload.project_id = project_id;
        if (section_id) payload.section_id = section_id;
        if (due_string) payload.due_string = due_string;
        if (due_date) payload.due_date = due_date;
        if (priority !== undefined) payload.priority = priority;
        if (labels && labels.length > 0) payload.labels = labels;

        const task = await apiRequest("/tasks", { method: "POST", body: payload, apiKey: api_key });
        return {
          content: [{ type: "text", text: `✅ Created task successfully:\n\n${formatTask(task)}` }],
          structuredContent: task
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error creating task: ${e.message}` }] };
      }
    }
  );

  // 4. Update Task
  server.registerTool(
    "todoist_update_task",
    {
      title: "Update Task",
      description: "Update properties of an existing Todoist task.",
      inputSchema: {
        task_id: z.string().describe("The ID of the task to update"),
        content: z.string().optional().describe("Updated task title"),
        description: z.string().optional().describe("Updated description"),
        due_string: z.string().optional().describe("Updated natural language due date"),
        due_date: z.string().optional().describe("Updated due date (YYYY-MM-DD) or 'no date' to remove"),
        priority: z.number().int().min(1).max(4).optional().describe("Priority from 1 (normal) to 4 (urgent / P1 in UI)"),
        labels: z.array(z.string()).optional().describe("Array of label names")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ task_id, content, description, due_string, due_date, priority, labels }) => {
      const { api_key } = getSettings();
      try {
        const payload = {};
        if (content !== undefined) payload.content = content;
        if (description !== undefined) payload.description = description;
        if (due_string !== undefined) payload.due_string = due_string;
        if (due_date !== undefined) payload.due_date = due_date;
        if (priority !== undefined) payload.priority = priority;
        if (labels !== undefined) payload.labels = labels;

        const task = await apiRequest(`/tasks/${encodeURIComponent(task_id)}`, { method: "POST", body: payload, apiKey: api_key });
        return {
          content: [{ type: "text", text: `Updated task:\n\n${formatTask(task)}` }],
          structuredContent: task
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error updating task ${task_id}: ${e.message}` }] };
      }
    }
  );

  // 5. Complete Task
  server.registerTool(
    "todoist_complete_task",
    {
      title: "Complete Task",
      description: "Mark a task as completed/closed in Todoist.",
      inputSchema: {
        task_id: z.string().describe("The ID of the task to complete")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ task_id }) => {
      const { api_key } = getSettings();
      try {
        await apiRequest(`/tasks/${encodeURIComponent(task_id)}/close`, { method: "POST", apiKey: api_key });
        return { content: [{ type: "text", text: `✅ Task \`${task_id}\` marked as completed.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error completing task ${task_id}: ${e.message}` }] };
      }
    }
  );

  // 6. Reopen Task
  server.registerTool(
    "todoist_reopen_task",
    {
      title: "Reopen Task",
      description: "Reopen a previously completed task.",
      inputSchema: {
        task_id: z.string().describe("The ID of the task to reopen")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ task_id }) => {
      const { api_key } = getSettings();
      try {
        await apiRequest(`/tasks/${encodeURIComponent(task_id)}/reopen`, { method: "POST", apiKey: api_key });
        return { content: [{ type: "text", text: `Task \`${task_id}\` reopened.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error reopening task ${task_id}: ${e.message}` }] };
      }
    }
  );

  // 7. Delete Task
  server.registerTool(
    "todoist_delete_task",
    {
      title: "Delete Task",
      description: "Permanently delete a task from Todoist.",
      inputSchema: {
        task_id: z.string().describe("The ID of the task to delete")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ task_id }) => {
      const { api_key } = getSettings();
      try {
        await apiRequest(`/tasks/${encodeURIComponent(task_id)}`, { method: "DELETE", apiKey: api_key });
        return { content: [{ type: "text", text: `🗑️ Task \`${task_id}\` permanently deleted.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error deleting task ${task_id}: ${e.message}` }] };
      }
    }
  );

  // 8. List Projects
  server.registerTool(
    "todoist_list_projects",
    {
      title: "List Projects",
      description: "List all Todoist projects.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async () => {
      const { api_key } = getSettings();
      try {
        const res = await apiRequest("/projects", { apiKey: api_key });
        const projects = Array.isArray(res) ? res : (res.results || []);
        if (!projects || projects.length === 0) {
          return { content: [{ type: "text", text: "No projects found." }] };
        }
        const text = projects.map(p => `- **${p.name}** (ID: \`${p.id}\`)${p.is_favorite ? " ⭐" : ""}${p.is_inbox_project ? " [Inbox]" : ""}`).join("\n");
        return {
          content: [{ type: "text", text: `Found ${projects.length} project(s):\n\n${text}` }],
          structuredContent: projects
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error listing projects: ${e.message}` }] };
      }
    }
  );

  // 9. Create Project
  server.registerTool(
    "todoist_create_project",
    {
      title: "Create Project",
      description: "Create a new Todoist project.",
      inputSchema: {
        name: z.string().min(1).describe("Name of the project"),
        parent_id: z.string().optional().describe("Parent project ID for nesting"),
        is_favorite: z.boolean().optional().describe("Whether to mark as favorite")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ name, parent_id, is_favorite }) => {
      const { api_key } = getSettings();
      try {
        const payload = { name };
        if (parent_id) payload.parent_id = parent_id;
        if (is_favorite !== undefined) payload.is_favorite = is_favorite;

        const project = await apiRequest("/projects", { method: "POST", body: payload, apiKey: api_key });
        return {
          content: [{ type: "text", text: `✅ Created project **${project.name}** (ID: \`${project.id}\`)` }],
          structuredContent: project
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error creating project: ${e.message}` }] };
      }
    }
  );

  // 10. List Sections
  server.registerTool(
    "todoist_list_sections",
    {
      title: "List Sections",
      description: "List sections within a Todoist project.",
      inputSchema: {
        project_id: z.string().describe("Project ID to list sections for")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ project_id }) => {
      const { api_key } = getSettings();
      try {
        const res = await apiRequest(`/sections?project_id=${encodeURIComponent(project_id)}`, { apiKey: api_key });
        const sections = Array.isArray(res) ? res : (res.results || []);
        if (!sections || sections.length === 0) {
          return { content: [{ type: "text", text: `No sections found in project ${project_id}.` }] };
        }
        const text = sections.map(s => `- **${s.name}** (ID: \`${s.id}\`) [Order: ${s.order}]`).join("\n");
        return {
          content: [{ type: "text", text: `Found ${sections.length} section(s):\n\n${text}` }],
          structuredContent: sections
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error listing sections: ${e.message}` }] };
      }
    }
  );
}

async function testService(settings) {
  const missing = configurationError("todoist", settings);
  if (missing) return { ok: false, message: `${missing}. Open Settings.` };
  if (!settings.api_key) return { ok: false, message: "api_key not configured" };
  try {
    const res = await fetch("https://api.todoist.com/api/v1/projects", {
      headers: { Authorization: `Bearer ${settings.api_key}` }
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, message: `HTTP ${res.status}: ${err || res.statusText}` };
    }
    const data = await res.json();
    const count = Array.isArray(data) ? data.length : (data.results?.length ?? 0);
    return { ok: true, message: `Connected to Todoist! Found ${count} project(s).` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/** UI connectivity checks never expose provider bodies or account/session details. */
export async function test(settings, context = {}) {
  const missing = configurationError("todoist", settings);
  if (missing) return { ok: false, message: `${missing}. Open Settings.` };
  try {
    const result = await testService(settings, context);
    return result.ok ? { ok: true, message: "Connection successful." } :
      { ok: false, message: "Connection failed. Check Settings, permissions and service availability." };
  } catch {
    return { ok: false, message: "Connection failed. Check Settings, permissions and service availability." };
  }
}
