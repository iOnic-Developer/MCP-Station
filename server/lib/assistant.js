/**
 * The ✦ popup backend. Runs a small agent loop with REAL tools (create_module,
 * reload_modules) so the assistant builds modules on the station instead of pasting
 * code — then streams the turn to the browser over the same SSE shape as before
 * ({text}, plus {tool} status lines and {modules_changed} for the UI to refresh).
 * Works on both providers: requests are non-streamed per hop and translated for Gemini.
 */
import { cfg } from './env.js';
import { getState, save } from './state.js';
import { decrypt } from './crypto.js';
import { getModules, isConfigured, getModuleById, moduleSource } from './mcpHost.js';
import { SEED_INSTRUCTIONS } from './seedInstructions.js';
import { ASSISTANT_TOOLS, execAssistantTool } from './assistantTools.js';
import { log } from './log.js';

export function ensureInstructions() {
  const st = getState();
  if (!st.instructions || !st.instructions.trim()) {
    st.instructions = SEED_INSTRUCTIONS;
    save();
  }
}

export function getProvider() {
  return getState().global.provider === 'gemini' ? 'gemini' : getState().global.provider === 'anthropic' ? 'anthropic' : cfg.assistantProvider;
}

export function getApiKey(provider = getProvider()) {
  // Env var wins; UI-stored key (encrypted) is the fallback.
  const st = getState().global;
  return provider === 'gemini'
    ? cfg.geminiApiKey || decrypt(st.geminiApiKey || '')
    : cfg.anthropicApiKey || decrypt(st.anthropicApiKey || '');
}

export function getModel(provider = getProvider()) {
  const st = getState().global;
  return provider === 'gemini' ? st.geminiModel || cfg.geminiModel : st.anthropicModel || cfg.anthropicModel;
}

function liveContext() {
  const st = getState();
  const mods = [...getModules().values()];
  const lines = mods.map((m) => {
    if (!m.manifest) return `- ${m.id} — LOAD ERROR: ${m.error}`;
    const reg = st.mcps[m.id] || {};
    const status = m.error ? `LOAD ERROR: ${m.error}` : !reg.enabled ? 'disabled' : isConfigured(m.id) ? 'enabled + configured' : 'enabled, NEEDS SETTINGS';
    return `- ${m.manifest.icon} ${m.manifest.name} — slug \`${m.manifest.slug}\`, id \`${m.id}\`, ${status}. Settings keys: ${m.manifest.settings.map((s) => s.key + (s.required ? '*' : '')).join(', ') || 'none'}`;
  });
  return [
    '## Live station context (auto-generated each message)',
    `Public URL: ${cfg.publicUrl || '(PUBLIC_URL not set — OAuth/connectors offline)'}`,
    `Station version: ${cfg.version} · MCP_TOKEN ${cfg.mcpToken ? 'set' : 'not set'}`,
    'Installed modules:',
    ...lines,
    '',
    '## Your tools (use them — do not just paste code)',
    'You have REAL tools on this station: `create_module` writes a module to mcps/<id>/ and hot-reloads it live; `reload_modules` re-scans everything. When the user asks you to build an MCP, CREATE it with the tool — the user should not have to copy any code. If the tool reports a load error, fix it and call again with the same id. When it succeeds, tell the user the connector URL and which settings to fill in the UI. You know most public APIs (Gmail, weather, GitHub, home automation, …) well enough to build a module from the name alone; the optional API host/docs the user may attach are hints, not requirements. Only paste code in chat when the user explicitly asks to see it.'
  ].join('\n');
}

/** Per-provider request/response adapters. Internal history is Anthropic-shaped content
 * blocks ({type:'text'|'tool_use'|'tool_result'}); Gemini gets translated per hop. Hops are
 * NON-streamed so tool calls arrive whole; the browser still receives the same SSE events. */
const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    request: (key, model, system, messages) => ({
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: {
        model, max_tokens: 8192, system, tools: ASSISTANT_TOOLS,
        // The API validates content blocks strictly: strip our internal markers (_toolName for
        // Gemini functionResponse naming, _sig for the Gemini 3 thoughtSignature round-trip) and
        // any empty text blocks.
        messages: messages.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content
            .filter((b) => b.type !== 'text' || (b.text && b.text.length))
            .map(({ _toolName, _sig, ...b }) => b)
        }))
      }
    }),
    // → [{type:'text',text} | {type:'tool_use',id,name,input}]
    blocks: (resp) => resp.content || []
  },
  gemini: {
    label: 'Gemini',
    request: (key, model, system, messages) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        tools: [{ functionDeclarations: ASSISTANT_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.input_schema })) }],
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          // Gemini 3 REQUIRES the thoughtSignature it returned with a functionCall (stashed as
          // _sig) to be echoed back on the next turn, or the request 400s "Function call is
          // missing a thought_signature". Re-attach it to the exact part it belongs to.
          parts: (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content).map((b) => {
            const sig = b._sig ? { thoughtSignature: b._sig } : {};
            if (b.type === 'tool_use') return { functionCall: { name: b.name, args: b.input || {} }, ...sig };
            if (b.type === 'tool_result') return { functionResponse: { name: b._toolName || 'tool', response: { result: b.content } } };
            return { text: b.text || '', ...sig };
          })
        })),
        generationConfig: { maxOutputTokens: 8192 }
      }
    }),
    blocks: (resp) => {
      if (resp.error) throw new Error(resp.error.message || 'Gemini error');
      const parts = resp.candidates?.[0]?.content?.parts || [];
      const out = [];
      let n = 0;
      for (const p of parts) {
        const sig = p.thoughtSignature ? { _sig: p.thoughtSignature } : {}; // must round-trip on v3
        if (p.functionCall) out.push({ type: 'tool_use', id: `g_${Date.now()}_${n++}`, name: p.functionCall.name, input: p.functionCall.args || {}, ...sig });
        else if (p.text) out.push({ type: 'text', text: p.text, ...sig });
      }
      return out;
    }
  }
};

/** Focused brief for the per-MCP chat in the code drawer: this module's files, inlined. */
function moduleContext(id) {
  const mod = getModuleById(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  return [
    `## You are working on ONE module: ${mod.manifest?.name || mod.id} (folder \`mcps/${mod.id}/\`)`,
    mod.error ? `It currently FAILS to load: ${mod.error}` : 'It currently loads without error.',
    'The user is looking at these files in the station\'s code editor. When you change one, reply with the COMPLETE new file in a single code fence (they paste/insert it wholesale — partial diffs are useless here). One file per fence, and say which file it is.',
    '',
    '## Current source',
    moduleSource(id)
  ].join('\n');
}

export async function handleChat(req, res) {
  const provider = getProvider();
  const p = PROVIDERS[provider];
  const key = getApiKey(provider);
  if (!key) return res.status(400).json({ error: `No ${p.label} API key configured — add one under ⚙ Station settings → Assistant, or switch provider.` });

  const messages = (Array.isArray(req.body?.messages) ? req.body.messages : [])
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .slice(-40)
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.slice(0, 60_000) }));
  if (!messages.length) return res.status(400).json({ error: 'messages required' });

  const mcpId = typeof req.body?.mcpId === 'string' ? req.body.mcpId : '';
  let system;
  try {
    system = mcpId
      ? `${getState().instructions}\n\n${moduleContext(mcpId)}`
      : `${getState().instructions}\n\n${liveContext()}`;
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  // Agent loop: model → tools → model, up to 6 hops. Client history is plain text turns;
  // tool_use/tool_result blocks live only inside this request (their effects are on disk).
  const internal = messages.map((m) => ({ role: m.role, content: m.content }));
  try {
    for (let hop = 0; hop < 6; hop++) {
      const { url, headers, body } = p.request(key, getModel(provider), system, internal);
      const upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!upstream.ok) {
        const t = await upstream.text();
        log('assistant', `${p.label} error ${upstream.status}: ${t.slice(0, 300)}`);
        send({ error: `${p.label} API ${upstream.status}: ${t.slice(0, 300)}` });
        break;
      }
      const blocks = p.blocks(await upstream.json());

      for (const b of blocks) if (b.type === 'text' && b.text) send({ text: b.text });
      const toolUses = blocks.filter((b) => b.type === 'tool_use');
      if (!toolUses.length) break;

      internal.push({ role: 'assistant', content: blocks });
      const results = [];
      for (const tu of toolUses) {
        send({ tool: { name: tu.name, status: 'running' } });
        const out = await execAssistantTool(tu.name, tu.input || {});
        send({ tool: { name: tu.name, ok: !out.error && out.ok !== false, detail: out.error || out.load_error || out.url || '' } });
        if (out.modulesChanged) send({ modules_changed: true });
        results.push({ type: 'tool_result', tool_use_id: tu.id, _toolName: tu.name, content: JSON.stringify(out).slice(0, 20_000) });
      }
      internal.push({ role: 'user', content: results });
      if (hop === 5) send({ text: '\n\n_(stopped after 6 tool rounds — ask me to continue)_' });
    }
  } catch (e) {
    log('assistant', `Agent loop error: ${e.message}`);
    send({ error: e.message });
  }
  send({ done: true });
  res.end();
}
