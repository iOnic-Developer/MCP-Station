// mcps/n8n/index.js — n8n workflow automation for MCP Station.
// Complete n8n Public API v1 coverage (103 endpoints, API spec v1.1.1 as served by the
// instance's own /api/v1/docs): workflows + versions/publish/archive, executions,
// credentials, tags, variables, users, projects, folders, data tables, evaluation test
// runs, community packages, security audit, insights, source control, instance settings
// (security policy / OTel / SAML / log streaming) and n8n package export/import.
// Auth: X-N8N-API-KEY header; optional Cloudflare Access service-token headers
// (CF-Access-Client-Id / CF-Access-Client-Secret) for instances behind CF Access.
// Licensed features (variables, projects, folders, insights, SAML, log streaming…)
// return readable 402/403 errors on unlicensed instances — surfaced as-is.

export function register({ server, z, getSettings, log, fetchJson }) {
  const MAX_OUTPUT = 24000;

  function conn() {
    const s = getSettings();
    if (!s.n8n_url || !s.api_key) {
      throw new Error('n8n_url or api_key is not configured. Open MCP Station → n8n → Settings.');
    }
    const base = s.n8n_url.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
    const headers = { 'X-N8N-API-KEY': s.api_key };
    if (s.cf_access_client_id && s.cf_access_client_secret) {
      headers['CF-Access-Client-Id'] = s.cf_access_client_id;
      headers['CF-Access-Client-Secret'] = s.cf_access_client_secret;
    }
    return { base: `${base}/api/v1`, headers };
  }

  function qs(params = {}) {
    const parts = [];
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    return parts.length ? `?${parts.join('&')}` : '';
  }

  async function api(path, { method = 'GET', body, query, timeoutMs } = {}) {
    const { base, headers } = conn();
    try {
      return await fetchJson(`${base}${path}${qs(query)}`, {
        method, headers, timeoutMs,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });
    } catch (e) {
      log(`n8n: ${method} ${path} failed — ${e.message}`);
      let hint = '';
      if (e.status === 401) hint = ' (API key rejected — regenerate under n8n → Settings → n8n API; if the instance is behind Cloudflare Access, also set both CF Access fields in Settings)';
      else if (e.status === 402 || (e.status === 403 && /licen|feature|plan/i.test(e.message))) hint = ' (this n8n feature is license-gated and not enabled on this instance)';
      else if (e.status === 403) hint = ' (forbidden — the API key owner lacks permission for this operation)';
      else if (e.status === 404) hint = ' (not found — check the ID)';
      throw new Error(`n8n ${method} ${path}: ${e.message}${hint}`);
    }
  }

  function clip(md, max = MAX_OUTPUT) {
    if (md.length <= max) return md;
    return md.slice(0, max) + `\n\n…(output truncated at ${max} chars — narrow with filters/limit, or raise maxChars where the tool offers it)`;
  }

  const j = (x) => JSON.stringify(x, null, 2);
  const cursorFoot = (d) => (d && d.nextCursor ? `\n\n➡️ More available — repeat the call with cursor: \`${d.nextCursor}\`` : '');

  // Cuts registerTool boilerplate; handlers return {text, data?, maxChars?} or a full result.
  function tool(name, title, description, schema, annotations, handler) {
    server.registerTool(name, { title, description, inputSchema: schema, annotations }, async (args) => {
      try {
        const out = await handler(args);
        if (out && out.content) return out;
        // MCP structuredContent must be an object — wrap arrays/primitives from the API.
        const sc = out.data === undefined ? undefined
          : (out.data !== null && typeof out.data === 'object' && !Array.isArray(out.data)) ? out.data
            : { result: out.data };
        return {
          content: [{ type: 'text', text: clip(out.text, out.maxChars) }],
          ...(sc !== undefined ? { structuredContent: sc } : {})
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    });
  }

  const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const WR = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
  const DEL = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

  const maxCharsArg = z.number().int().min(2000).max(120000).default(24000)
    .describe('Cap on returned characters (raise for big payloads)');

  // ───────────────────────────── workflows ─────────────────────────────

  const WF_EMOJI = (w) => (w.isArchived ? '🗄️' : w.active ? '🟢' : '⚪');
  const wfLine = (w) => {
    const tags = (w.tags || []).map((t) => t.name).filter(Boolean);
    return `- ${WF_EMOJI(w)} **${w.name}** (\`${w.id}\`) — ${(w.nodes || []).length} nodes` +
      `${w.isArchived ? ' | archived' : w.active ? ' | active' : ''}` +
      `${tags.length ? ` | tags: ${tags.join(', ')}` : ''} | updated ${String(w.updatedAt || '').slice(0, 10)}`;
  };
  const slimWf = (w) => ({
    id: w.id, name: w.name, active: w.active, isArchived: w.isArchived,
    nodeCount: (w.nodes || []).length, tags: (w.tags || []).map((t) => t.name),
    createdAt: w.createdAt, updatedAt: w.updatedAt
  });

  tool('n8n_list_workflows', 'List workflows',
    'List workflows (name, id, active/archived, node count, tags). Filter by active state, tag names, name or project. Node data is summarised — use n8n_get_workflow for the full definition.',
    {
      active: z.boolean().optional().describe('Only active (true) or inactive (false) workflows'),
      tags: z.string().optional().describe('Comma-separated tag names, e.g. "prod,daily"'),
      name: z.string().optional().describe('Filter by exact workflow name'),
      projectId: z.string().optional(),
      excludePinnedData: z.boolean().default(true).describe('Skip pinned sample data (keeps responses small)'),
      limit: z.number().int().min(1).max(250).default(100),
      cursor: z.string().optional().describe('nextCursor from the previous page')
    }, RO,
    async ({ active, tags, name, projectId, excludePinnedData, limit, cursor }) => {
      const d = await api('/workflows', { query: { active, tags, name, projectId, excludePinnedData, limit, cursor } });
      const rows = d.data || [];
      if (!rows.length) return { text: 'No workflows matched.' };
      return {
        text: `### Workflows (${rows.length} returned)\n\n${rows.map(wfLine).join('\n')}${cursorFoot(d)}`,
        data: { count: rows.length, nextCursor: d.nextCursor, workflows: rows.map(slimWf) }
      };
    });

  tool('n8n_get_workflow', 'Get workflow',
    'Fetch one workflow. format "summary" gives a compact node/connection overview; "full" returns the complete JSON definition (what n8n_update_workflow edits).',
    {
      id: z.string().describe('Workflow ID (from n8n_list_workflows)'),
      format: z.enum(['summary', 'full']).default('full'),
      excludePinnedData: z.boolean().default(true).describe('Skip pinned sample data'),
      maxChars: maxCharsArg
    }, RO,
    async ({ id, format, excludePinnedData, maxChars }) => {
      const w = await api(`/workflows/${encodeURIComponent(id)}`, { query: { excludePinnedData } });
      if (format === 'summary') {
        const nodes = (w.nodes || []).map((n) => `| ${n.name} | \`${n.type}\` | ${n.disabled ? '🚫 disabled' : '·'} |`).join('\n');
        const conns = Object.entries(w.connections || {}).map(([from, o]) =>
          `- ${from} → ${(o.main || []).flat().filter(Boolean).map((c) => c.node).join(', ') || '—'}`).join('\n');
        return {
          text: `### ${WF_EMOJI(w)} ${w.name} (\`${w.id}\`)\n` +
            `active: ${w.active} | archived: ${w.isArchived} | versionId: \`${w.versionId || '—'}\` | updated: ${w.updatedAt}\n` +
            `tags: ${(w.tags || []).map((t) => t.name).join(', ') || '—'}\n\n` +
            `| Node | Type | State |\n|---|---|---|\n${nodes || '| — | — | — |'}\n\n**Connections**\n${conns || '—'}\n\n` +
            `settings: \`${JSON.stringify(w.settings || {})}\``,
          data: slimWf(w), maxChars
        };
      }
      return { text: j(w), maxChars };
    });

  tool('n8n_create_workflow', 'Create workflow',
    'Create a workflow (inactive; use n8n_set_workflow_state to activate). nodes is an array of n8n node objects ({name, type, typeVersion, position, parameters, …}); connections keys are source node NAMES.',
    {
      name: z.string().min(1),
      nodes: z.array(z.record(z.any())).default([]).describe('n8n node objects; [] for an empty workflow'),
      connections: z.record(z.any()).default({}).describe('e.g. {"Node A":{"main":[[{"node":"Node B","type":"main","index":0}]]}}'),
      settings: z.record(z.any()).default({ executionOrder: 'v1' }).describe('Workflow settings (executionOrder, timezone, errorWorkflow…)'),
      staticData: z.record(z.any()).optional(),
      projectId: z.string().optional().describe('Target project (defaults to the key owner\'s personal project)'),
      parentFolderId: z.string().optional().describe('Folder to create the workflow in'),
      description: z.string().optional()
    }, WR,
    async ({ name, nodes, connections, settings, staticData, projectId, parentFolderId, description }) => {
      const body = { name, nodes, connections, settings };
      if (staticData) body.staticData = staticData;
      if (projectId) body.projectId = projectId;
      if (parentFolderId) body.parentFolderId = parentFolderId;
      if (description) body.description = description;
      const w = await api('/workflows', { method: 'POST', body });
      return { text: `✅ Workflow **${w.name}** created — id \`${w.id}\`, ${(w.nodes || []).length} nodes, inactive. Activate with n8n_set_workflow_state.`, data: slimWf(w) };
    });

  tool('n8n_update_workflow', 'Update workflow',
    'Update a workflow by merge: current definition is fetched, the fields you pass replace their counterparts, and the result is PUT back (n8n requires full-body updates). Pass only what changes — e.g. just name, or just nodes+connections.',
    {
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      nodes: z.array(z.record(z.any())).optional().describe('REPLACES the whole node array'),
      connections: z.record(z.any()).optional().describe('REPLACES all connections'),
      settings: z.record(z.any()).optional().describe('REPLACES all settings'),
      staticData: z.record(z.any()).optional(),
      parentFolderId: z.string().nullable().optional().describe('Move to this folder; null = project root')
    }, WR,
    async ({ id, name, description, nodes, connections, settings, staticData, parentFolderId }) => {
      const cur = await api(`/workflows/${encodeURIComponent(id)}`);
      const body = {};
      for (const k of ['name', 'description', 'nodes', 'connections', 'settings', 'staticData', 'pinData', 'nodeGroups']) {
        if (cur[k] !== undefined && cur[k] !== null) body[k] = cur[k];
      }
      body.name = name ?? body.name;
      body.nodes = nodes ?? body.nodes ?? [];
      body.connections = connections ?? body.connections ?? {};
      body.settings = settings ?? body.settings ?? {};
      if (description !== undefined) body.description = description;
      if (staticData !== undefined) body.staticData = staticData;
      if (parentFolderId !== undefined) body.parentFolderId = parentFolderId;
      const w = await api(`/workflows/${encodeURIComponent(id)}`, { method: 'PUT', body });
      return { text: `✅ Workflow **${w.name}** (\`${w.id}\`) updated — ${(w.nodes || []).length} nodes, versionId \`${w.versionId || '—'}\`.`, data: slimWf(w) };
    });

  tool('n8n_delete_workflow', 'Delete workflow',
    'Permanently delete a workflow (and its executions). Consider n8n_set_workflow_state action "archive" for a reversible removal.',
    { id: z.string() }, DEL,
    async ({ id }) => {
      const w = await api(`/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return { text: `🗑️ Workflow **${w?.name || id}** deleted.` };
    });

  tool('n8n_set_workflow_state', 'Activate / archive workflow',
    'Change a workflow\'s lifecycle state: activate | deactivate (triggers on/off), publish | unpublish (same operation under workflow versioning), archive | unarchive. versionId/versionName/versionDescription apply to activate/publish only.',
    {
      id: z.string(),
      action: z.enum(['activate', 'deactivate', 'publish', 'unpublish', 'archive', 'unarchive']),
      versionId: z.string().optional().describe('Specific version to activate/publish (default: latest)'),
      versionName: z.string().optional(),
      versionDescription: z.string().optional()
    }, WR,
    async ({ id, action, versionId, versionName, versionDescription }) => {
      let body;
      if ((action === 'activate' || action === 'publish') && (versionId || versionName || versionDescription)) {
        body = {};
        if (versionId) body.versionId = versionId;
        if (versionName) body.name = versionName;
        if (versionDescription) body.description = versionDescription;
      }
      const w = await api(`/workflows/${encodeURIComponent(id)}/${action}`, { method: 'POST', body });
      return { text: `✅ ${action} done — **${w.name}** is now ${WF_EMOJI(w)} active: ${w.active}, archived: ${Boolean(w.isArchived)}.`, data: slimWf(w) };
    });

  tool('n8n_transfer_workflow', 'Transfer workflow',
    'Move a workflow to another project (get project IDs from n8n_list_projects).',
    { id: z.string(), destinationProjectId: z.string() }, WR,
    async ({ id, destinationProjectId }) => {
      await api(`/workflows/${encodeURIComponent(id)}/transfer`, { method: 'PUT', body: { destinationProjectId } });
      return { text: `✅ Workflow \`${id}\` transferred to project \`${destinationProjectId}\`.` };
    });

  tool('n8n_workflow_history', 'Workflow version history',
    'Without versionId: list a workflow\'s saved versions. With versionId: fetch that version\'s full JSON (restore by passing its nodes/connections to n8n_update_workflow, or activate it via n8n_set_workflow_state).',
    {
      id: z.string(),
      versionId: z.string().optional(),
      limit: z.number().int().min(1).max(250).default(20),
      offset: z.number().int().min(0).optional(),
      cursor: z.string().optional(),
      maxChars: maxCharsArg
    }, RO,
    async ({ id, versionId, limit, offset, cursor, maxChars }) => {
      if (versionId) {
        const v = await api(`/workflows/${encodeURIComponent(id)}/${encodeURIComponent(versionId)}`);
        return { text: j(v), maxChars };
      }
      const d = await api(`/workflows/${encodeURIComponent(id)}/history`, { query: { limit, offset, cursor } });
      const rows = d.data || [];
      if (!rows.length) return { text: 'No version history (workflow history may be disabled or the workflow has a single version).' };
      const lines = rows.map((v) => `- \`${v.versionId || v.id}\` — ${v.createdAt || ''}${v.name ? ` | ${v.name}` : ''}${v.description ? ` — ${v.description}` : ''}${(v.authors ? ` | by ${v.authors}` : '')}`);
      return { text: `### Versions of \`${id}\`\n\n${lines.join('\n')}${cursorFoot(d)}`, data: { count: rows.length, nextCursor: d.nextCursor, versions: rows } };
    });

  tool('n8n_workflow_tags', 'Get / set workflow tags',
    'Without setTagIds: list the tags on a workflow. With setTagIds: REPLACE the workflow\'s tags with exactly those tag IDs (create tags first with n8n_create_tag; [] clears all).',
    { id: z.string(), setTagIds: z.array(z.string()).optional().describe('Tag IDs that should be the complete new set') }, WR,
    async ({ id, setTagIds }) => {
      const tags = setTagIds
        ? await api(`/workflows/${encodeURIComponent(id)}/tags`, { method: 'PUT', body: setTagIds.map((t) => ({ id: t })) })
        : await api(`/workflows/${encodeURIComponent(id)}/tags`);
      const list = (Array.isArray(tags) ? tags : []).map((t) => `- **${t.name}** (\`${t.id}\`)`).join('\n');
      return { text: `${setTagIds ? '✅ Tags replaced.\n\n' : ''}${list || 'No tags on this workflow.'}`, data: { tags } };
    });

  // ───────────────────────────── executions ─────────────────────────────

  const EX_EMOJI = { success: '✅', error: '❌', crashed: '💥', running: '🏃', waiting: '⏸️', canceled: '🚫', new: '🆕', unknown: '❔' };
  const exLine = (e) => {
    const dur = e.startedAt && e.stoppedAt ? ` | ${((new Date(e.stoppedAt) - new Date(e.startedAt)) / 1000).toFixed(1)}s` : '';
    return `- ${EX_EMOJI[e.status] || '❔'} **#${e.id}** wf \`${e.workflowId}\` — ${e.status} | ${e.mode}${e.retryOf ? ` | retry of #${e.retryOf}` : ''} | ${e.startedAt || e.createdAt || ''}${dur}`;
  };

  tool('n8n_list_executions', 'List executions',
    'List workflow executions, newest first. Filter by status, workflow or project. includeData pulls full run data for EVERY row — huge; prefer n8n_get_execution for one run.',
    {
      status: z.enum(['canceled', 'crashed', 'error', 'new', 'running', 'success', 'unknown', 'waiting']).optional(),
      workflowId: z.string().optional(),
      projectId: z.string().optional(),
      includeData: z.boolean().default(false),
      limit: z.number().int().min(1).max(250).default(20),
      cursor: z.string().optional()
    }, RO,
    async ({ status, workflowId, projectId, includeData, limit, cursor }) => {
      const d = await api('/executions', { query: { status, workflowId, projectId, includeData, limit, cursor } });
      const rows = d.data || [];
      if (!rows.length) return { text: 'No executions matched.' };
      return {
        text: `### Executions (${rows.length} returned)\n\n${rows.map(exLine).join('\n')}${cursorFoot(d)}`,
        data: { count: rows.length, nextCursor: d.nextCursor, executions: rows.map((e) => ({ id: e.id, workflowId: e.workflowId, status: e.status, mode: e.mode, startedAt: e.startedAt, stoppedAt: e.stoppedAt })) }
      };
    });

  tool('n8n_get_execution', 'Get execution',
    'One execution\'s detail. includeData=true returns full node-by-node run data (can be very large — raise maxChars if truncated); redactExecutionData masks values the instance policy flags as sensitive.',
    {
      id: z.number().int().describe('Execution ID'),
      includeData: z.boolean().default(false),
      redactExecutionData: z.boolean().optional(),
      ignoreDataSizeLimit: z.boolean().optional().describe('Bypass the instance\'s response-size guard for big runs'),
      maxChars: maxCharsArg
    }, RO,
    async ({ id, includeData, redactExecutionData, ignoreDataSizeLimit, maxChars }) => {
      const e = await api(`/executions/${id}`, { query: { includeData, redactExecutionData, ignoreDataSizeLimit } });
      if (includeData) return { text: j(e), maxChars };
      const err = e.data?.resultData?.error?.message;
      return {
        text: `${EX_EMOJI[e.status] || '❔'} Execution **#${e.id}** — wf \`${e.workflowId}\`\nstatus: ${e.status} | mode: ${e.mode} | started: ${e.startedAt} | stopped: ${e.stoppedAt || '—'}${e.retryOf ? `\nretry of: #${e.retryOf}` : ''}${e.retrySuccessId ? `\nretried successfully as: #${e.retrySuccessId}` : ''}${err ? `\n❗ ${err}` : ''}\n\n(pass includeData=true for node-by-node run data)`,
        data: { id: e.id, workflowId: e.workflowId, status: e.status, mode: e.mode, startedAt: e.startedAt, stoppedAt: e.stoppedAt }
      };
    });

  tool('n8n_delete_execution', 'Delete execution',
    'Delete one execution record.',
    { id: z.number().int() }, DEL,
    async ({ id }) => {
      await api(`/executions/${id}`, { method: 'DELETE' });
      return { text: `🗑️ Execution #${id} deleted.` };
    });

  tool('n8n_retry_execution', 'Retry execution',
    'Re-run a failed execution. loadWorkflow=true retries with the CURRENT saved workflow instead of the version that originally ran.',
    { id: z.number().int(), loadWorkflow: z.boolean().default(false) }, WR,
    async ({ id, loadWorkflow }) => {
      const r = await api(`/executions/${id}/retry`, { method: 'POST', body: { loadWorkflow } });
      return { text: `🔁 Retry of #${id} started${r?.id ? ` — new execution #${r.id}` : ''}.`, data: r ?? undefined };
    });

  tool('n8n_stop_executions', 'Stop executions',
    'Stop a running execution by id, OR bulk-stop by statuses (queued/running/waiting) optionally narrowed by workflowId and a started-time window. Provide id or statuses, not neither.',
    {
      id: z.number().int().optional().describe('Stop just this execution'),
      statuses: z.array(z.enum(['queued', 'running', 'waiting'])).optional().describe('Bulk mode: stop all executions in these states'),
      workflowId: z.string().optional().describe('Bulk mode: only this workflow\'s executions'),
      startedAfter: z.string().optional().describe('Bulk mode: ISO date-time lower bound'),
      startedBefore: z.string().optional().describe('Bulk mode: ISO date-time upper bound')
    }, WR,
    async ({ id, statuses, workflowId, startedAfter, startedBefore }) => {
      if (id !== undefined) {
        const r = await api(`/executions/${id}/stop`, { method: 'POST' });
        return { text: `🛑 Execution #${id} stop requested${r?.status ? ` — status now ${r.status}` : ''}.`, data: r ?? undefined };
      }
      if (!statuses?.length) return { text: 'Error: pass id (single stop) or statuses (bulk stop).' };
      const body = { status: statuses };
      if (workflowId) body.workflowId = workflowId;
      if (startedAfter) body.startedAfter = startedAfter;
      if (startedBefore) body.startedBefore = startedBefore;
      const r = await api('/executions/stop', { method: 'POST', body });
      return { text: `🛑 Bulk stop requested for [${statuses.join(', ')}]${workflowId ? ` on wf \`${workflowId}\`` : ''}.\n\n${clip(j(r), 4000)}`, data: r ?? undefined };
    });

  tool('n8n_execution_tags', 'Get / set execution tags',
    'Annotation tags on one execution. Without setTagIds: list them. With setTagIds: replace them (tag IDs from n8n_list_tags; [] clears).',
    { id: z.number().int(), setTagIds: z.array(z.string()).optional() }, WR,
    async ({ id, setTagIds }) => {
      const tags = setTagIds
        ? await api(`/executions/${id}/tags`, { method: 'PUT', body: setTagIds.map((t) => ({ id: t })) })
        : await api(`/executions/${id}/tags`);
      const arr = Array.isArray(tags) ? tags : (tags?.data || []);
      return { text: `${setTagIds ? '✅ Tags replaced.\n\n' : ''}${arr.map((t) => `- **${t.name}** (\`${t.id}\`)`).join('\n') || 'No tags on this execution.'}`, data: { tags: arr } };
    });

  // ───────────────────────────── tags ─────────────────────────────

  tool('n8n_list_tags', 'List tags',
    'List all tags (or fetch one by id). Tags label workflows and executions.',
    { id: z.string().optional(), limit: z.number().int().min(1).max(250).default(100), cursor: z.string().optional() }, RO,
    async ({ id, limit, cursor }) => {
      if (id) {
        const t = await api(`/tags/${encodeURIComponent(id)}`);
        return { text: `**${t.name}** (\`${t.id}\`) — created ${t.createdAt}`, data: t };
      }
      const d = await api('/tags', { query: { limit, cursor } });
      const rows = d.data || [];
      return { text: rows.length ? `### Tags\n\n${rows.map((t) => `- **${t.name}** (\`${t.id}\`)`).join('\n')}${cursorFoot(d)}` : 'No tags yet.', data: { count: rows.length, nextCursor: d.nextCursor, tags: rows } };
    });

  tool('n8n_create_tag', 'Create tag',
    'Create a tag. Names are limited to 24 characters (n8n reports longer names as a misleading "Tag already exists").',
    { name: z.string().min(1).max(24) }, WR,
    async ({ name }) => {
      const t = await api('/tags', { method: 'POST', body: { name } });
      return { text: `✅ Tag **${t.name}** created (\`${t.id}\`).`, data: t };
    });

  tool('n8n_update_tag', 'Rename tag',
    'Rename a tag (max 24 characters).',
    { id: z.string(), name: z.string().min(1).max(24) }, WR,
    async ({ id, name }) => {
      const t = await api(`/tags/${encodeURIComponent(id)}`, { method: 'PUT', body: { name } });
      return { text: `✅ Tag \`${t.id}\` renamed to **${t.name}**.`, data: t };
    });

  tool('n8n_delete_tag', 'Delete tag',
    'Delete a tag (removed from all workflows/executions).',
    { id: z.string() }, DEL,
    async ({ id }) => {
      const t = await api(`/tags/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return { text: `🗑️ Tag **${t?.name || id}** deleted.` };
    });

  // ───────────────────────────── credentials ─────────────────────────────

  tool('n8n_list_credentials', 'List credentials',
    'List stored credentials (or fetch one by id) — names, types and IDs only; secret values are never returned by the API.',
    { id: z.string().optional(), limit: z.number().int().min(1).max(250).default(100), cursor: z.string().optional() }, RO,
    async ({ id, limit, cursor }) => {
      if (id) {
        const c = await api(`/credentials/${encodeURIComponent(id)}`);
        return { text: j(c), data: c };
      }
      const d = await api('/credentials', { query: { limit, cursor } });
      const rows = d.data || [];
      return {
        text: rows.length ? `### Credentials\n\n${rows.map((c) => `- **${c.name}** (\`${c.id}\`) — type \`${c.type}\``).join('\n')}${cursorFoot(d)}` : 'No credentials.',
        data: { count: rows.length, nextCursor: d.nextCursor, credentials: rows.map((c) => ({ id: c.id, name: c.name, type: c.type })) }
      };
    });

  tool('n8n_create_credential', 'Create credential',
    'Create a credential. Get the required data fields for a type from n8n_credential_schema first (e.g. type "httpHeaderAuth" needs {name, value}).',
    {
      name: z.string().min(1),
      type: z.string().describe('Credential type name, e.g. httpBasicAuth, telegramApi'),
      data: z.record(z.any()).describe('Type-specific fields (see n8n_credential_schema)'),
      projectId: z.string().optional()
    }, WR,
    async ({ name, type, data, projectId }) => {
      const body = { name, type, data };
      if (projectId) body.projectId = projectId;
      const c = await api('/credentials', { method: 'POST', body });
      return { text: `✅ Credential **${c.name}** created (\`${c.id}\`, type \`${c.type}\`).`, data: { id: c.id, name: c.name, type: c.type } };
    });

  tool('n8n_update_credential', 'Update credential',
    'Update a credential\'s name, type and/or data. isPartialData=true merges the data you send into the existing secret values instead of replacing them all.',
    {
      id: z.string(),
      name: z.string().optional(),
      type: z.string().optional().describe('If changing type, data must be provided too'),
      data: z.record(z.any()).optional(),
      isPartialData: z.boolean().default(false)
    }, WR,
    async ({ id, name, type, data, isPartialData }) => {
      const body = {};
      if (name !== undefined) body.name = name;
      if (type !== undefined) body.type = type;
      if (data !== undefined) { body.data = data; body.isPartialData = isPartialData; }
      const c = await api(`/credentials/${encodeURIComponent(id)}`, { method: 'PATCH', body });
      return { text: `✅ Credential **${c?.name || id}** updated.`, data: c ?? undefined };
    });

  tool('n8n_delete_credential', 'Delete credential',
    'Delete a credential. Workflows using it will fail until given a replacement.',
    { id: z.string() }, DEL,
    async ({ id }) => {
      const c = await api(`/credentials/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return { text: `🗑️ Credential **${c?.name || id}** deleted.` };
    });

  tool('n8n_test_credential', 'Test credential',
    'Run n8n\'s connection test for a stored credential.',
    { id: z.string() }, RO,
    async ({ id }) => {
      const r = await api(`/credentials/${encodeURIComponent(id)}/test`, { method: 'POST', timeoutMs: 60000 });
      return { text: `Credential test for \`${id}\`:\n\n${clip(j(r), 4000)}`, data: r ?? undefined };
    });

  tool('n8n_credential_schema', 'Credential type schema',
    'The JSON schema of fields a credential type expects — check before n8n_create_credential.',
    { credentialTypeName: z.string().describe('e.g. httpBasicAuth, githubApi, telegramApi'), maxChars: maxCharsArg }, RO,
    async ({ credentialTypeName, maxChars }) => {
      const s = await api(`/credentials/schema/${encodeURIComponent(credentialTypeName)}`);
      return { text: j(s), maxChars, data: s };
    });

  tool('n8n_transfer_credential', 'Transfer credential',
    'Move a credential to another project.',
    { id: z.string(), destinationProjectId: z.string() }, WR,
    async ({ id, destinationProjectId }) => {
      await api(`/credentials/${encodeURIComponent(id)}/transfer`, { method: 'PUT', body: { destinationProjectId } });
      return { text: `✅ Credential \`${id}\` transferred to project \`${destinationProjectId}\`.` };
    });

  // ───────────────────────────── variables ─────────────────────────────

  tool('n8n_list_variables', 'List variables',
    'List instance variables (usable in workflows as $vars.key). state="empty" filters to variables with no value. License-gated on some n8n plans.',
    {
      limit: z.number().int().min(1).max(250).default(100),
      cursor: z.string().optional(),
      projectId: z.string().optional(),
      state: z.enum(['empty']).optional()
    }, RO,
    async ({ limit, cursor, projectId, state }) => {
      const d = await api('/variables', { query: { limit, cursor, projectId, state } });
      const rows = d.data || [];
      return {
        text: rows.length ? `### Variables\n\n${rows.map((v) => `- **${v.key}** = \`${String(v.value ?? '').slice(0, 120)}\` (\`${v.id}\`${v.projectId ? `, project ${v.projectId}` : ''})`).join('\n')}${cursorFoot(d)}` : 'No variables.',
        data: { count: rows.length, nextCursor: d.nextCursor, variables: rows }
      };
    });

  tool('n8n_set_variable', 'Create / update variable',
    'Create a variable (no id) or update an existing one (with id). key and value are always required — an update replaces both.',
    {
      id: z.string().optional().describe('Existing variable ID to update; omit to create'),
      key: z.string().min(1).describe('Variable name, referenced as $vars.<key> in workflows'),
      value: z.string().describe('Variable value (strings only in n8n)'),
      projectId: z.string().optional()
    }, WR,
    async ({ id, key, value, projectId }) => {
      const body = { key, value };
      if (projectId) body.projectId = projectId;
      if (id) {
        await api(`/variables/${encodeURIComponent(id)}`, { method: 'PUT', body });
        return { text: `✅ Variable **${key}** updated.` };
      }
      const v = await api('/variables', { method: 'POST', body });
      return { text: `✅ Variable **${key}** created${v?.id ? ` (\`${v.id}\`)` : ''}.`, data: v ?? undefined };
    });

  tool('n8n_delete_variable', 'Delete variable',
    'Delete a variable. Workflows referencing $vars.<key> will resolve it as undefined afterwards.',
    { id: z.string() }, DEL,
    async ({ id }) => {
      await api(`/variables/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return { text: `🗑️ Variable \`${id}\` deleted.` };
    });

  // ───────────────────────────── users ─────────────────────────────

  tool('n8n_list_users', 'List users',
    'List instance users (or fetch one by id or email). Owner-scoped API keys only.',
    {
      user: z.string().optional().describe('User ID or email — fetch just this user'),
      includeRole: z.boolean().default(true),
      projectId: z.string().optional(),
      limit: z.number().int().min(1).max(250).default(100),
      offset: z.number().int().min(0).optional(),
      cursor: z.string().optional()
    }, RO,
    async ({ user, includeRole, projectId, limit, offset, cursor }) => {
      if (user) {
        const u = await api(`/users/${encodeURIComponent(user)}`, { query: { includeRole } });
        return { text: j(u), data: u };
      }
      const d = await api('/users', { query: { includeRole, projectId, limit, offset, cursor } });
      const rows = d.data || [];
      return {
        text: rows.length ? `### Users\n\n${rows.map((u) => `- **${u.email}** (\`${u.id}\`) — ${u.role || (u.isOwner ? 'owner' : 'member')}${u.isPending ? ' | ⏳ invite pending' : ''}`).join('\n')}${cursorFoot(d)}` : 'No users returned.',
        data: { count: rows.length, nextCursor: d.nextCursor, users: rows.map((u) => ({ id: u.id, email: u.email, role: u.role, isPending: u.isPending })) }
      };
    });

  tool('n8n_invite_users', 'Invite users',
    'Invite one or more users by email; response includes invite-accept URLs to pass on.',
    {
      users: z.array(z.object({
        email: z.string().describe('Email address'),
        role: z.enum(['global:admin', 'global:member']).optional().describe('Default global:member')
      })).min(1)
    }, WR,
    async ({ users }) => {
      const r = await api('/users', { method: 'POST', body: users });
      return { text: `✅ Invited ${users.length} user(s).\n\n${clip(j(r), 6000)}`, data: r ?? undefined };
    });

  tool('n8n_set_user_role', 'Change user role',
    'Change a user\'s global role.',
    { user: z.string().describe('User ID or email'), newRoleName: z.enum(['global:admin', 'global:member']) }, WR,
    async ({ user, newRoleName }) => {
      await api(`/users/${encodeURIComponent(user)}/role`, { method: 'PATCH', body: { newRoleName } });
      return { text: `✅ ${user} is now ${newRoleName}.` };
    });

  tool('n8n_delete_user', 'Delete user',
    'Remove a user from the instance.',
    { user: z.string().describe('User ID or email') }, DEL,
    async ({ user }) => {
      await api(`/users/${encodeURIComponent(user)}`, { method: 'DELETE' });
      return { text: `🗑️ User ${user} deleted.` };
    });

  // ───────────────────────────── projects ─────────────────────────────

  tool('n8n_list_projects', 'List projects',
    'List projects (license-gated feature; the personal project always exists).',
    { limit: z.number().int().min(1).max(250).default(100), cursor: z.string().optional() }, RO,
    async ({ limit, cursor }) => {
      const d = await api('/projects', { query: { limit, cursor } });
      const rows = d.data || [];
      return {
        text: rows.length ? `### Projects\n\n${rows.map((p) => `- **${p.name}** (\`${p.id}\`) — ${p.type || 'team'}`).join('\n')}${cursorFoot(d)}` : 'No projects.',
        data: { count: rows.length, nextCursor: d.nextCursor, projects: rows }
      };
    });

  tool('n8n_create_project', 'Create project',
    'Create a team project (license-gated).',
    { name: z.string().min(1) }, WR,
    async ({ name }) => {
      const p = await api('/projects', { method: 'POST', body: { name } });
      return { text: `✅ Project **${p?.name || name}** created${p?.id ? ` (\`${p.id}\`)` : ''}.`, data: p ?? undefined };
    });

  tool('n8n_update_project', 'Rename project',
    'Rename a project.',
    { projectId: z.string(), name: z.string().min(1) }, WR,
    async ({ projectId, name }) => {
      await api(`/projects/${encodeURIComponent(projectId)}`, { method: 'PUT', body: { name } });
      return { text: `✅ Project \`${projectId}\` renamed to **${name}**.` };
    });

  tool('n8n_delete_project', 'Delete project',
    'Delete a project and everything in it. Transfer workflows/credentials out first if they must survive.',
    { projectId: z.string() }, DEL,
    async ({ projectId }) => {
      await api(`/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
      return { text: `🗑️ Project \`${projectId}\` deleted.` };
    });

  tool('n8n_project_users', 'Manage project members',
    'list members | add users [{userId, role}] | remove a userId | set_role of a userId. Roles: project:admin, project:editor, project:viewer.',
    {
      projectId: z.string(),
      action: z.enum(['list', 'add', 'remove', 'set_role']).default('list'),
      users: z.array(z.object({
        userId: z.string(),
        role: z.enum(['project:admin', 'project:editor', 'project:viewer']).optional().describe('Required for add/set_role; default project:viewer')
      })).optional().describe('For add (many allowed); for remove/set_role pass exactly one'),
      limit: z.number().int().min(1).max(250).default(100),
      cursor: z.string().optional()
    }, WR,
    async ({ projectId, action, users, limit, cursor }) => {
      const pid = encodeURIComponent(projectId);
      if (action === 'list') {
        const d = await api(`/projects/${pid}/users`, { query: { limit, cursor } });
        const rows = d.data || d || [];
        const arr = Array.isArray(rows) ? rows : [];
        return { text: arr.length ? `### Members of \`${projectId}\`\n\n${arr.map((u) => `- \`${u.userId || u.id}\` — ${u.role}`).join('\n')}${cursorFoot(d)}` : 'No members.', data: { members: arr } };
      }
      if (!users?.length) return { text: `Error: action "${action}" needs the users array.` };
      if (action === 'add') {
        await api(`/projects/${pid}/users`, { method: 'POST', body: { relations: users.map((u) => ({ userId: u.userId, role: u.role || 'project:viewer' })) } });
        return { text: `✅ Added ${users.length} user(s) to project \`${projectId}\`.` };
      }
      const u = users[0];
      if (action === 'remove') {
        await api(`/projects/${pid}/users/${encodeURIComponent(u.userId)}`, { method: 'DELETE' });
        return { text: `🗑️ User \`${u.userId}\` removed from project \`${projectId}\`.` };
      }
      await api(`/projects/${pid}/users/${encodeURIComponent(u.userId)}`, { method: 'PATCH', body: { role: u.role || 'project:viewer' } });
      return { text: `✅ User \`${u.userId}\` is now ${u.role || 'project:viewer'} in project \`${projectId}\`.` };
    });

  // ───────────────────────────── folders ─────────────────────────────

  tool('n8n_list_folders', 'List folders',
    'List folders in a project (or fetch one by folderId). filter narrows by parentFolderId / name / tags.',
    {
      projectId: z.string(),
      folderId: z.string().optional().describe('Fetch just this folder'),
      filter: z.record(z.any()).optional().describe('e.g. {"parentFolderId":"abc"} or {"name":"Ops"}'),
      sortBy: z.string().optional().describe('e.g. name:asc, createdAt:desc, updatedAt:asc'),
      skip: z.number().int().min(0).optional(),
      take: z.number().int().min(1).max(250).optional()
    }, RO,
    async ({ projectId, folderId, filter, sortBy, skip, take }) => {
      const pid = encodeURIComponent(projectId);
      if (folderId) {
        const f = await api(`/projects/${pid}/folders/${encodeURIComponent(folderId)}`);
        return { text: j(f), data: f };
      }
      const d = await api(`/projects/${pid}/folders`, { query: { filter: filter ? JSON.stringify(filter) : undefined, sortBy, skip, take } });
      const rows = d.data || [];
      return {
        text: rows.length ? `### Folders in \`${projectId}\`\n\n${rows.map((f) => `- 📁 **${f.name}** (\`${f.id}\`)${f.parentFolder?.id || f.parentFolderId ? ` — in \`${f.parentFolder?.id || f.parentFolderId}\`` : ''}`).join('\n')}${cursorFoot(d)}` : 'No folders.',
        data: { count: rows.length, folders: rows }
      };
    });

  tool('n8n_create_folder', 'Create folder',
    'Create a folder in a project (optionally nested under parentFolderId).',
    { projectId: z.string(), name: z.string().min(1), parentFolderId: z.string().optional() }, WR,
    async ({ projectId, name, parentFolderId }) => {
      const body = { name };
      if (parentFolderId) body.parentFolderId = parentFolderId;
      const f = await api(`/projects/${encodeURIComponent(projectId)}/folders`, { method: 'POST', body });
      return { text: `✅ Folder **${f?.name || name}** created${f?.id ? ` (\`${f.id}\`)` : ''}.`, data: f ?? undefined };
    });

  tool('n8n_update_folder', 'Update folder',
    'Rename a folder and/or move it under another parent.',
    { projectId: z.string(), folderId: z.string(), name: z.string().optional(), parentFolderId: z.string().optional() }, WR,
    async ({ projectId, folderId, name, parentFolderId }) => {
      const body = {};
      if (name !== undefined) body.name = name;
      if (parentFolderId !== undefined) body.parentFolderId = parentFolderId;
      await api(`/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderId)}`, { method: 'PATCH', body });
      return { text: `✅ Folder \`${folderId}\` updated.` };
    });

  tool('n8n_delete_folder', 'Delete folder',
    'Delete a folder. Its workflows are deleted too unless transferToFolderId names a folder to move them into.',
    { projectId: z.string(), folderId: z.string(), transferToFolderId: z.string().optional() }, DEL,
    async ({ projectId, folderId, transferToFolderId }) => {
      await api(`/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderId)}`, { method: 'DELETE', query: { transferToFolderId } });
      return { text: `🗑️ Folder \`${folderId}\` deleted${transferToFolderId ? ` (contents moved to \`${transferToFolderId}\`)` : ''}.` };
    });

  // ───────────────────────────── data tables ─────────────────────────────

  const FILTER_SHAPE = {
    type: z.enum(['and', 'or']).optional().describe('How filters combine (default and)'),
    filters: z.array(z.object({
      columnName: z.string(),
      condition: z.enum(['eq', 'neq', 'like', 'ilike', 'gt', 'gte', 'lt', 'lte']),
      value: z.any()
    })).min(1)
  };

  tool('n8n_list_data_tables', 'List data tables',
    'List data tables (or fetch one with columns by dataTableId).',
    {
      dataTableId: z.string().optional(),
      filter: z.record(z.any()).optional().describe('e.g. {"name":"customers"} or {"projectId":"..."}'),
      sortBy: z.string().optional().describe('e.g. name:asc, updatedAt:desc'),
      limit: z.number().int().min(1).max(250).default(100),
      cursor: z.string().optional()
    }, RO,
    async ({ dataTableId, filter, sortBy, limit, cursor }) => {
      if (dataTableId) {
        const t = await api(`/data-tables/${encodeURIComponent(dataTableId)}`);
        return { text: j(t), data: t };
      }
      const d = await api('/data-tables', { query: { filter: filter ? JSON.stringify(filter) : undefined, sortBy, limit, cursor } });
      const rows = d.data || [];
      return {
        text: rows.length ? `### Data tables\n\n${rows.map((t) => `- 🗃️ **${t.name}** (\`${t.id}\`) — ${(t.columns || []).map((c) => `${c.name}:${c.type}`).join(', ') || 'no columns'}`).join('\n')}${cursorFoot(d)}` : 'No data tables.',
        data: { count: rows.length, nextCursor: d.nextCursor, dataTables: rows }
      };
    });

  tool('n8n_create_data_table', 'Create data table',
    'Create a data table with typed columns.',
    {
      name: z.string().min(1).max(128),
      columns: z.array(z.object({
        name: z.string().min(1),
        type: z.enum(['string', 'number', 'boolean', 'date', 'json'])
      })).min(1),
      projectId: z.string().optional()
    }, WR,
    async ({ name, columns, projectId }) => {
      const body = { name, columns };
      if (projectId) body.projectId = projectId;
      const t = await api('/data-tables', { method: 'POST', body });
      return { text: `✅ Data table **${t?.name || name}** created${t?.id ? ` (\`${t.id}\`)` : ''}.`, data: t ?? undefined };
    });

  tool('n8n_update_data_table', 'Rename data table',
    'Rename a data table (columns are managed with n8n_data_table_columns).',
    { dataTableId: z.string(), name: z.string().min(1).max(128) }, WR,
    async ({ dataTableId, name }) => {
      const t = await api(`/data-tables/${encodeURIComponent(dataTableId)}`, { method: 'PATCH', body: { name } });
      return { text: `✅ Data table \`${dataTableId}\` renamed to **${name}**.`, data: t ?? undefined };
    });

  tool('n8n_delete_data_table', 'Delete data table',
    'Delete a data table and ALL its rows.',
    { dataTableId: z.string() }, DEL,
    async ({ dataTableId }) => {
      await api(`/data-tables/${encodeURIComponent(dataTableId)}`, { method: 'DELETE' });
      return { text: `🗑️ Data table \`${dataTableId}\` deleted.` };
    });

  tool('n8n_data_table_columns', 'Manage data table columns',
    'list | add (name+type, optional index) | update (rename/move by columnId) | delete a column. Deleting a column drops its data.',
    {
      dataTableId: z.string(),
      action: z.enum(['list', 'add', 'update', 'delete']).default('list'),
      columnId: z.string().optional().describe('For update/delete'),
      name: z.string().optional().describe('Column name (add/update)'),
      type: z.enum(['string', 'number', 'boolean', 'date']).optional().describe('Column type (add)'),
      index: z.number().int().min(0).optional().describe('Zero-based position (add/update)')
    }, WR,
    async ({ dataTableId, action, columnId, name, type, index }) => {
      const tid = encodeURIComponent(dataTableId);
      if (action === 'list') {
        const cols = await api(`/data-tables/${tid}/columns`);
        const arr = Array.isArray(cols) ? cols : (cols?.data || []);
        return { text: arr.length ? arr.map((c) => `- **${c.name}** (\`${c.id}\`) — ${c.type}${c.index !== undefined ? ` @${c.index}` : ''}`).join('\n') : 'No columns.', data: { columns: arr } };
      }
      if (action === 'add') {
        if (!name || !type) return { text: 'Error: add needs name and type.' };
        const body = { name, type };
        if (index !== undefined) body.index = index;
        const c = await api(`/data-tables/${tid}/columns`, { method: 'POST', body });
        return { text: `✅ Column **${name}** (${type}) added${c?.id ? ` (\`${c.id}\`)` : ''}.`, data: c ?? undefined };
      }
      if (!columnId) return { text: `Error: ${action} needs columnId (see action "list").` };
      if (action === 'delete') {
        await api(`/data-tables/${tid}/columns/${encodeURIComponent(columnId)}`, { method: 'DELETE' });
        return { text: `🗑️ Column \`${columnId}\` deleted (its data is gone).` };
      }
      const body = {};
      if (name !== undefined) body.name = name;
      if (index !== undefined) body.index = index;
      await api(`/data-tables/${tid}/columns/${encodeURIComponent(columnId)}`, { method: 'PATCH', body });
      return { text: `✅ Column \`${columnId}\` updated.` };
    });

  tool('n8n_get_data_table_rows', 'Get data table rows',
    'Read rows from a data table, with filtering, sorting, search and cursor pagination.',
    {
      dataTableId: z.string(),
      filter: z.object(FILTER_SHAPE).optional().describe('Condition filter on column values'),
      sortBy: z.string().optional().describe('columnName:asc or columnName:desc'),
      search: z.string().optional().describe('Text search across all string columns'),
      limit: z.number().int().min(1).max(250).default(50),
      cursor: z.string().optional(),
      maxChars: maxCharsArg
    }, RO,
    async ({ dataTableId, filter, sortBy, search, limit, cursor, maxChars }) => {
      const d = await api(`/data-tables/${encodeURIComponent(dataTableId)}/rows`, {
        query: { filter: filter ? JSON.stringify(filter) : undefined, sortBy, search, limit, cursor }
      });
      const rows = d.data || [];
      return { text: `### Rows (${rows.length} returned${d.count !== undefined ? ` of ${d.count}` : ''})\n\n${j(rows)}${cursorFoot(d)}`, data: { count: rows.length, total: d.count, nextCursor: d.nextCursor }, maxChars };
    });

  tool('n8n_insert_data_table_rows', 'Insert data table rows',
    'Insert rows (objects keyed by column name). returnType: count | id | all.',
    {
      dataTableId: z.string(),
      rows: z.array(z.record(z.any())).min(1),
      returnType: z.enum(['count', 'id', 'all']).default('count')
    }, WR,
    async ({ dataTableId, rows, returnType }) => {
      const r = await api(`/data-tables/${encodeURIComponent(dataTableId)}/rows`, { method: 'POST', body: { data: rows, returnType } });
      return { text: `✅ Inserted ${rows.length} row(s).\n\n${clip(j(r), 4000)}`, data: r ?? undefined };
    });

  tool('n8n_update_data_table_rows', 'Update / upsert data table rows',
    'mode "update": set data on every row matching filter. mode "upsert": update the matching row or insert data as a new row when none matches. dryRun previews without writing.',
    {
      dataTableId: z.string(),
      mode: z.enum(['update', 'upsert']).default('update'),
      filter: z.object(FILTER_SHAPE).describe('Which rows to match'),
      data: z.record(z.any()).describe('Column values to write'),
      returnData: z.boolean().default(false).describe('Return affected rows instead of a success flag'),
      dryRun: z.boolean().default(false)
    }, WR,
    async ({ dataTableId, mode, filter, data, returnData, dryRun }) => {
      const path = `/data-tables/${encodeURIComponent(dataTableId)}/rows/${mode === 'upsert' ? 'upsert' : 'update'}`;
      const r = await api(path, { method: mode === 'upsert' ? 'POST' : 'PATCH', body: { filter, data, returnData, dryRun } });
      return { text: `${dryRun ? '🔍 Dry run — no changes written.' : `✅ ${mode} done.`}\n\n${clip(j(r), 6000)}`, data: r ?? undefined };
    });

  tool('n8n_delete_data_table_rows', 'Delete data table rows',
    'Delete rows matching filter, or ALL rows with all=true (ignores filter). dryRun previews what would be deleted.',
    {
      dataTableId: z.string(),
      filter: z.object(FILTER_SHAPE).optional().describe('Required unless all=true'),
      all: z.boolean().default(false).describe('true = clear the entire table'),
      returnData: z.boolean().default(false),
      dryRun: z.boolean().default(false)
    }, DEL,
    async ({ dataTableId, filter, all, returnData, dryRun }) => {
      const tid = encodeURIComponent(dataTableId);
      if (all) {
        await api(`/data-tables/${tid}/rows/clear`, { method: 'DELETE' });
        return { text: `🗑️ All rows cleared from data table \`${dataTableId}\`.` };
      }
      if (!filter) return { text: 'Error: pass filter, or all=true to clear the whole table.' };
      const r = await api(`/data-tables/${tid}/rows/delete`, { method: 'DELETE', query: { filter: JSON.stringify(filter), returnData, dryRun } });
      return { text: `${dryRun ? '🔍 Dry run — nothing deleted.' : '🗑️ Rows deleted.'}\n\n${clip(j(r), 6000)}`, data: r ?? undefined };
    });

  // ───────────────────────────── evaluation test runs ─────────────────────────────

  tool('n8n_list_test_runs', 'List test runs',
    'Evaluation test runs of a workflow. With runId: that run\'s detail; with runId + cases=true: its per-case results.',
    {
      workflowId: z.string(),
      runId: z.string().optional(),
      cases: z.boolean().default(false).describe('With runId: return the run\'s test cases'),
      status: z.string().optional().describe('Filter list by status, e.g. completed, running, error'),
      limit: z.number().int().min(1).max(250).default(50),
      cursor: z.string().optional()
    }, RO,
    async ({ workflowId, runId, cases, status, limit, cursor }) => {
      const wid = encodeURIComponent(workflowId);
      if (runId && cases) {
        const d = await api(`/workflows/${wid}/test-runs/${encodeURIComponent(runId)}/test-cases`, { query: { limit, cursor } });
        return { text: `### Test cases of run \`${runId}\`\n\n${clip(j(d.data || d), 20000)}${cursorFoot(d)}`, data: d ?? undefined };
      }
      if (runId) {
        const r = await api(`/workflows/${wid}/test-runs/${encodeURIComponent(runId)}`);
        return { text: j(r), data: r };
      }
      const d = await api(`/workflows/${wid}/test-runs`, { query: { status, limit, cursor } });
      const rows = d.data || [];
      return {
        text: rows.length ? `### Test runs of \`${workflowId}\`\n\n${rows.map((r) => `- \`${r.id}\` — ${r.status} | ${r.createdAt || r.runAt || ''}`).join('\n')}${cursorFoot(d)}` : 'No test runs.',
        data: { count: rows.length, nextCursor: d.nextCursor, testRuns: rows }
      };
    });

  tool('n8n_trigger_test_run', 'Trigger test run',
    'Start an evaluation test run for a workflow (needs an evaluation set up in n8n).',
    { workflowId: z.string() }, WR,
    async ({ workflowId }) => {
      const r = await api(`/workflows/${encodeURIComponent(workflowId)}/test-runs`, { method: 'POST', timeoutMs: 60000 });
      return { text: `🧪 Test run started${r?.id ? ` — id \`${r.id}\`` : ''}.`, data: r ?? undefined };
    });

  tool('n8n_cancel_test_run', 'Cancel test run',
    'Cancel a running evaluation test run.',
    { workflowId: z.string(), runId: z.string() }, WR,
    async ({ workflowId, runId }) => {
      await api(`/workflows/${encodeURIComponent(workflowId)}/test-runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
      return { text: `🛑 Test run \`${runId}\` cancelled.` };
    });

  // ───────────────────────────── community packages ─────────────────────────────

  tool('n8n_list_community_packages', 'List community packages',
    'Installed community node packages with their versions and update status.',
    {}, RO,
    async () => {
      const d = await api('/community-packages');
      const rows = d?.data || (Array.isArray(d) ? d : []);
      return {
        text: rows.length ? `### Community packages\n\n${rows.map((p) => `- **${p.packageName || p.name}** ${p.installedVersion || ''}${p.updateAvailable ? ` → ⬆️ ${p.updateAvailable}` : ''}`).join('\n')}` : 'No community packages installed.',
        data: { packages: rows }
      };
    });

  tool('n8n_manage_community_package', 'Install / update / uninstall community package',
    'install (name, optional version), update (to latest or a version), uninstall. verify=false allows packages outside n8n\'s vetted list when the instance permits. Uninstalling breaks workflows using the package\'s nodes.',
    {
      action: z.enum(['install', 'update', 'uninstall']),
      name: z.string().describe('npm package, must start with n8n-nodes-'),
      version: z.string().optional(),
      verify: z.boolean().optional()
    }, DEL,
    async ({ action, name, version, verify }) => {
      const enc = encodeURIComponent(name);
      if (action === 'uninstall') {
        await api(`/community-packages/${enc}`, { method: 'DELETE' });
        return { text: `🗑️ Package **${name}** uninstalled.` };
      }
      const body = {};
      if (version) body.version = version;
      if (verify !== undefined) body.verify = verify;
      const r = action === 'install'
        ? await api('/community-packages', { method: 'POST', body: { name, ...body }, timeoutMs: 120000 })
        : await api(`/community-packages/${enc}`, { method: 'PATCH', body, timeoutMs: 120000 });
      return { text: `✅ ${action} of **${name}** done.\n\n${clip(j(r), 4000)}`, data: r ?? undefined };
    });

  // ───────────────────────────── audit / insights / discovery ─────────────────────────────

  tool('n8n_generate_audit', 'Generate security audit',
    'Run n8n\'s built-in security audit (credentials, database, nodes, filesystem, instance risk reports). Can take a while on big instances.',
    {
      categories: z.array(z.enum(['credentials', 'database', 'nodes', 'filesystem', 'instance'])).optional().describe('Default: all'),
      daysAbandonedWorkflow: z.number().int().min(1).optional().describe('Days without execution before a workflow counts as abandoned'),
      maxChars: maxCharsArg
    }, RO,
    async ({ categories, daysAbandonedWorkflow, maxChars }) => {
      const additionalOptions = {};
      if (categories?.length) additionalOptions.categories = categories;
      if (daysAbandonedWorkflow) additionalOptions.daysAbandonedWorkflow = daysAbandonedWorkflow;
      const r = await api('/audit', { method: 'POST', timeoutMs: 180000, ...(Object.keys(additionalOptions).length ? { body: { additionalOptions } } : { body: {} }) });
      return { text: j(r), maxChars };
    });

  tool('n8n_insights_summary', 'Insights summary',
    'Execution insights (totals, failures, time saved) for an optional date range / project. License-gated on some plans.',
    {
      startDate: z.string().optional().describe('ISO date, e.g. 2026-08-01'),
      endDate: z.string().optional(),
      projectId: z.string().optional()
    }, RO,
    async ({ startDate, endDate, projectId }) => {
      const r = await api('/insights/summary', { query: { startDate, endDate, projectId } });
      return { text: clip(j(r), 8000), data: r ?? undefined };
    });

  tool('n8n_discover', 'Discover API capabilities',
    'What this n8n instance\'s API key can actually do — active scopes plus available resources/operations (license- and role-aware). Run when an endpoint unexpectedly 403s.',
    {
      include: z.string().optional().describe('Extra detail sections, e.g. endpoints'),
      resource: z.string().optional().describe('Narrow to one resource, e.g. workflows'),
      operation: z.string().optional()
    }, RO,
    async ({ include, resource, operation }) => {
      const r = await api('/discover', { query: { include, resource, operation } });
      return { text: clip(j(r), 16000), data: r ?? undefined };
    });

  tool('n8n_source_control_pull', 'Source control pull',
    'Pull workflow/credential changes from the connected git repository (source control must be configured in n8n). autoPublish: none | all | published.',
    {
      force: z.boolean().default(false),
      autoPublish: z.enum(['none', 'all', 'published']).default('none')
    }, WR,
    async ({ force, autoPublish }) => {
      const r = await api('/source-control/pull', { method: 'POST', body: { force, autoPublish }, timeoutMs: 120000 });
      return { text: `✅ Pull done.\n\n${clip(j(r), 8000)}`, data: r ?? undefined };
    });

  // ───────────────────────────── instance settings ─────────────────────────────

  tool('n8n_get_settings', 'Get instance settings',
    'Read instance settings: security-policy | otel | saml | log-streaming-destinations (id for one) | log-streaming-event-types. Several areas are license-gated.',
    {
      area: z.enum(['security-policy', 'otel', 'saml', 'log-streaming-destinations', 'log-streaming-event-types']),
      id: z.string().optional().describe('Destination ID (log-streaming-destinations only)')
    }, RO,
    async ({ area, id }) => {
      const paths = {
        'security-policy': '/settings/security-policy',
        otel: '/settings/otel',
        saml: '/settings/sso/saml',
        'log-streaming-destinations': id ? `/settings/log-streaming/destinations/${encodeURIComponent(id)}` : '/settings/log-streaming/destinations',
        'log-streaming-event-types': '/settings/log-streaming/event-types'
      };
      const r = await api(paths[area]);
      return { text: clip(j(r), 16000), data: r ?? undefined };
    });

  tool('n8n_update_settings', 'Update instance settings',
    'Full-replacement PUT of an instance settings area (security-policy | otel | saml). Workflow: n8n_get_settings → edit the returned object → send it back as config (read-only counter fields are ignored server-side).',
    {
      area: z.enum(['security-policy', 'otel', 'saml']),
      config: z.record(z.any()).describe('The COMPLETE settings object for that area')
    }, WR,
    async ({ area, config }) => {
      const paths = { 'security-policy': '/settings/security-policy', otel: '/settings/otel', saml: '/settings/sso/saml' };
      const r = await api(paths[area], { method: 'PUT', body: config });
      return { text: `✅ ${area} updated.\n\n${clip(j(r), 6000)}`, data: r ?? undefined };
    });

  tool('n8n_test_otel_trace', 'Test OTel trace',
    'Send a test trace to an OTLP collector. Omit config to test the currently saved OTel settings.',
    { config: z.record(z.any()).optional().describe('Override: {exporterEndpoint, exporterTracingPath, exporterServiceName, exporterHeaders, startupConnectivityTimeoutMs}') }, RO,
    async ({ config }) => {
      let body = config;
      if (!body) {
        const cur = await api('/settings/otel');
        body = {
          exporterEndpoint: cur.exporterEndpoint, exporterTracingPath: cur.exporterTracingPath,
          exporterServiceName: cur.exporterServiceName, exporterHeaders: cur.exporterHeaders ?? '',
          startupConnectivityTimeoutMs: cur.startupConnectivityTimeoutMs ?? 2000
        };
      }
      const r = await api('/settings/otel/test-trace', { method: 'POST', body, timeoutMs: 60000 });
      return { text: `OTel test result:\n\n${clip(j(r), 4000)}`, data: r ?? undefined };
    });

  tool('n8n_log_streaming_destinations', 'Manage log streaming destinations',
    'create | update | delete | test a log streaming destination (license-gated). destination is the full object; its "type" picks the variant: webhook, syslog or sentry. Read with n8n_get_settings.',
    {
      action: z.enum(['create', 'update', 'delete', 'test']),
      id: z.string().optional().describe('Destination ID (update/delete/test)'),
      destination: z.record(z.any()).optional().describe('Full destination object (create/update)')
    }, DEL,
    async ({ action, id, destination }) => {
      if (action === 'create') {
        if (!destination) return { text: 'Error: create needs the destination object.' };
        const r = await api('/settings/log-streaming/destinations', { method: 'POST', body: destination });
        return { text: `✅ Destination created.\n\n${clip(j(r), 4000)}`, data: r ?? undefined };
      }
      if (!id) return { text: `Error: ${action} needs id.` };
      const enc = encodeURIComponent(id);
      if (action === 'update') {
        if (!destination) return { text: 'Error: update needs the destination object.' };
        const r = await api(`/settings/log-streaming/destinations/${enc}`, { method: 'PUT', body: destination });
        return { text: `✅ Destination \`${id}\` updated.`, data: r ?? undefined };
      }
      if (action === 'delete') {
        await api(`/settings/log-streaming/destinations/${enc}`, { method: 'DELETE' });
        return { text: `🗑️ Destination \`${id}\` deleted.` };
      }
      const r = await api(`/settings/log-streaming/destinations/${enc}/test`, { method: 'POST' });
      return { text: `Test message sent to \`${id}\`.\n\n${clip(j(r), 4000)}`, data: r ?? undefined };
    });

  // ───────────────────────────── n8n packages (beta export/import) ─────────────────────────────

  // These two speak binary (gzip tar / multipart), so they use Node's global fetch
  // rather than the JSON-only fetchJson helper.

  tool('n8n_export_package', 'Export n8n package',
    'Beta: export workflows/folders OR whole projects as a portable .n8np package (gzip). Small packages (≤48 KB) are returned as base64 — hand that to n8n_import_package or the Files MCP\'s save_base64. Bigger ones report counts only; narrow the selection.',
    {
      workflowIds: z.array(z.string()).optional(),
      folderIds: z.array(z.string()).optional(),
      projectIds: z.array(z.string()).optional().describe('Whole projects — cannot be combined with workflowIds/folderIds'),
      includeVariableValues: z.boolean().default(true),
      missingWorkflowDependencyPolicy: z.enum(['fail', 'reference-only', 'include-in-package']).optional()
    }, RO,
    async ({ workflowIds, folderIds, projectIds, includeVariableValues, missingWorkflowDependencyPolicy }) => {
      const { base, headers } = conn();
      const body = { includeVariableValues };
      if (workflowIds?.length) body.workflowIds = workflowIds;
      if (folderIds?.length) body.folderIds = folderIds;
      if (projectIds?.length) body.projectIds = projectIds;
      if (missingWorkflowDependencyPolicy) body.missingWorkflowDependencyPolicy = missingWorkflowDependencyPolicy;
      const r = await fetch(`${base}/n8n-packages/export`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/gzip, application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000)
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`n8n POST /n8n-packages/export: HTTP ${r.status}: ${t.slice(0, 400)}`);
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const counts = r.headers.get('x-n8n-export-counts') || '';
      const head = `📦 Package exported — ${buf.length} bytes${counts ? ` | counts: ${counts}` : ''}`;
      if (buf.length > 48 * 1024) {
        return { text: `${head}\n\nToo large to hand back through chat as base64 — export a smaller selection, or import it programmatically on the target instance.`, data: { sizeBytes: buf.length, counts } };
      }
      return { text: `${head}\n\npackageBase64 is in this result's structured content.`, data: { sizeBytes: buf.length, counts, packageBase64: buf.toString('base64') } };
    });

  tool('n8n_import_package', 'Import n8n package',
    'Beta: import a .n8np package (base64 of the gzip file, e.g. from n8n_export_package). workflowConflictPolicy decides what happens when a package workflow already exists: new-version | fail | skip.',
    {
      packageBase64: z.string().min(1).describe('Base64 of the .n8np file'),
      workflowConflictPolicy: z.enum(['new-version', 'fail', 'skip']),
      projectId: z.string().optional().describe('Target project (default: personal)'),
      folderId: z.string().optional(),
      credentialMatchingMode: z.enum(['id-only', 'name-and-type', 'type-only']).optional(),
      credentialMissingMode: z.enum(['must-preexist', 'create-stub']).optional(),
      workflowIdPolicy: z.enum(['new', 'source']).optional(),
      missingNodeTypeMode: z.enum(['fail', 'import-anyway']).optional(),
      workflowPublishingPolicy: z.enum(['preserve-published-state', 'match-source', 'publish-all', 'unpublish-all']).optional(),
      folderConflictPolicy: z.enum(['merge', 'fail']).optional(),
      dataTableMissingMode: z.enum(['create', 'must-preexist', 'do-nothing']).optional(),
      variableMissingMode: z.enum(['do-nothing', 'must-preexist']).optional(),
      bindings: z.record(z.any()).optional().describe('Advanced: explicit credential/variable bindings object')
    }, WR,
    async (a) => {
      const { base, headers } = conn();
      const fd = new FormData();
      fd.append('package', new Blob([Buffer.from(a.packageBase64, 'base64')], { type: 'application/gzip' }), 'package.n8np');
      fd.append('workflowConflictPolicy', a.workflowConflictPolicy);
      for (const k of ['projectId', 'folderId', 'credentialMatchingMode', 'credentialMissingMode', 'workflowIdPolicy', 'missingNodeTypeMode', 'workflowPublishingPolicy', 'folderConflictPolicy', 'dataTableMissingMode', 'variableMissingMode']) {
        if (a[k] !== undefined) fd.append(k, String(a[k]));
      }
      if (a.bindings) fd.append('bindings', JSON.stringify(a.bindings));
      const r = await fetch(`${base}/n8n-packages/import`, { method: 'POST', headers, body: fd, signal: AbortSignal.timeout(120000) });
      const text = await r.text();
      let out; try { out = text ? JSON.parse(text) : null; } catch { out = { raw: text.slice(0, 1000) }; }
      if (!r.ok) throw new Error(`n8n POST /n8n-packages/import: HTTP ${r.status}: ${JSON.stringify(out).slice(0, 500)}`);
      return { text: `✅ Package imported.\n\n${clip(j(out), 8000)}`, data: out ?? undefined };
    });
}

// Powers the ▶ Test button in the UI.
export async function test(settings, { fetchJson }) {
  if (!settings.n8n_url || !settings.api_key) {
    return { ok: false, message: 'n8n_url or api_key is missing — set both in Settings.' };
  }
  if (Boolean(settings.cf_access_client_id) !== Boolean(settings.cf_access_client_secret)) {
    return { ok: false, message: 'Cloudflare Access needs BOTH CF-Access-Client-Id and CF-Access-Client-Secret (or neither).' };
  }
  const base = settings.n8n_url.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  const headers = { 'X-N8N-API-KEY': settings.api_key };
  const cf = settings.cf_access_client_id && settings.cf_access_client_secret;
  if (cf) {
    headers['CF-Access-Client-Id'] = settings.cf_access_client_id;
    headers['CF-Access-Client-Secret'] = settings.cf_access_client_secret;
  }
  try {
    await fetchJson(`${base}/api/v1/workflows?limit=1`, { headers });
    let caps = '';
    try {
      const d = await fetchJson(`${base}/api/v1/discover`, { headers });
      const res = d?.data?.resources;
      if (res && typeof res === 'object') caps = `, ${Object.keys(res).length} API resources available`;
    } catch { /* /discover missing on older n8n — fine */ }
    return { ok: true, message: `Connected — n8n Public API reachable${caps}${cf ? ' (via Cloudflare Access)' : ''}.` };
  } catch (e) {
    return { ok: false, message: `Connection failed: ${e.message}` };
  }
}
