/**
 * ✦ assistant backend. Streams model output, executes station tools, then feeds tool results
 * back to the selected provider until the turn is complete.
 */
import { cfg } from './env.js';
import { getState, save } from './state.js';
import { decrypt } from './crypto.js';
import { getModules, isConfigured, getModuleById, moduleSource } from './mcpHost.js';
import { SEED_INSTRUCTIONS } from './seedInstructions.js';
import { ASSISTANT_TOOLS, execAssistantTool } from './assistantTools.js';
import { log } from './log.js';

const MAX_HOPS = 8;
const OUTPUT_CEILING = 64_000;
const OUTPUT_FALLBACK = 16_000;
const OUTPUT_FLOOR = 8_192;
const VALID_PROVIDERS = new Set(['openai', 'anthropic', 'gemini']);

export function ensureInstructions() {
  const st = getState();
  if (!st.instructions || !st.instructions.trim()) {
    st.instructions = SEED_INSTRUCTIONS;
    save();
  }
}

export function resetInstructions() {
  const st = getState();
  st.instructions = SEED_INSTRUCTIONS;
  save();
  return st.instructions;
}

export function getProvider() {
  const stored = getState().global.provider;
  return VALID_PROVIDERS.has(stored) ? stored : cfg.assistantProvider;
}

export function getApiKey(provider = getProvider()) {
  const st = getState().global;
  if (provider === 'openai') return cfg.openaiApiKey || decrypt(st.openaiApiKey || '');
  if (provider === 'gemini') return cfg.geminiApiKey || decrypt(st.geminiApiKey || '');
  return cfg.anthropicApiKey || decrypt(st.anthropicApiKey || '');
}

export function getModel(provider = getProvider()) {
  const st = getState().global;
  if (provider === 'openai') return st.openaiModel || cfg.openaiModel;
  if (provider === 'gemini') return st.geminiModel || cfg.geminiModel;
  return st.anthropicModel || cfg.anthropicModel;
}

const TOOL_BRIEF =
  'You have REAL tools on this station. `create_module` writes a NEW module to mcps/<id>/ and hot-reloads it live. ' +
  'For a module that already exists: `read_module_file` shows a file (or a line range), `edit_module_file` makes a targeted ' +
  'find/replace change, `write_module_file` replaces or creates one file — each write hot-reloads the module and reports ' +
  'whether it still loads; `reload_modules` re-scans everything. All of them take the module `id` from the list above. ' +
  'When the user asks you to build or change an MCP, DO IT with the tools — the user should not have to copy any code. ' +
  'Never re-send an existing module through `create_module`, and never reproduce a large file to change a few lines: use `edit_module_file`. ' +
  'If a tool reports a load error, fix it and call again. When a module is created, tell the user the connector URL and which settings to fill in the UI. ' +
  'You know most public APIs well enough to build a module from the name alone; optional API docs are hints, not requirements. ' +
  '`fetch_url` reads any public page or spec: when building from documentation, fetch the reference index, then EVERY endpoint page it links to (and the OpenAPI/Swagger spec if there is one), write the full endpoint inventory (METHOD /path) before coding, give every endpoint a tool, and reconcile inventory vs tools before you finish. ' +
  'Only paste code in chat when the user explicitly asks to see it.';

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
    TOOL_BRIEF
  ].join('\n');
}

function moduleContext(id) {
  const mod = getModuleById(id);
  if (!mod) throw new Error(`Unknown MCP '${id}'`);
  return [
    `## You are working on ONE module: ${mod.manifest?.name || mod.id} (id \`${mod.id}\`, folder \`mcps/${mod.id}/\`)`,
    mod.error ? `It currently FAILS to load: ${mod.error}` : 'It currently loads without error.',
    "The user has this module open in the station's code editor beside this chat. Its files are inlined below — that is the CURRENT text on disk.",
    '',
    '### How to change it (this overrides any earlier instruction to reply with complete files)',
    '- Apply changes with your tools; do not paste code for the user to copy. `edit_module_file` for a targeted change; `write_module_file` for a new file or a genuine whole-file rewrite of a small file. `read_module_file` for any truncated region or to re-check after an edit. `id` defaults to this module; you cannot touch other modules from here.',
    '- Every write hot-reloads the module and reports whether it loaded. If it reports a load error, fix it with another edit until it loads.',
    '- Never rewrite a large file to change a few lines, and never send this module through `create_module`.',
    '- Show code in chat only when asked to see it.',
    '- Finish with one or two lines saying what changed and why.',
    '',
    '## Current source',
    moduleSource(id)
  ].join('\n');
}

const stripInternal = (b) => Object.fromEntries(Object.entries(b).filter(([k]) => !k.startsWith('_')));

function openaiTools() {
  return ASSISTANT_TOOLS.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
    strict: false
  }));
}

function openaiInitialInput(messages) {
  return messages.map((m) => ({ role: m.role, content: String(m.content || '') }));
}

function openaiToolOutputs(messages) {
  const last = messages[messages.length - 1];
  const blocks = Array.isArray(last?.content) ? last.content : [];
  return blocks.filter((b) => b.type === 'tool_result').map((b) => ({
    type: 'function_call_output',
    call_id: b.tool_use_id,
    output: b.content
  }));
}

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    outputCap: OUTPUT_CEILING,
    request: (key, model, system, messages, maxTokens, state) => ({
      url: `${cfg.openaiBaseUrl}/v1/responses`,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: {
        model,
        instructions: system,
        input: state.previousResponseId ? openaiToolOutputs(messages) : openaiInitialInput(messages),
        ...(state.previousResponseId ? { previous_response_id: state.previousResponseId } : {}),
        tools: openaiTools(),
        tool_choice: 'auto',
        parallel_tool_calls: true,
        reasoning: { effort: 'medium' },
        max_output_tokens: maxTokens,
        stream: true,
        store: true
      }
    }),
    lowerCap: (status, text, cur) => {
      if (status === 400 && /max_output_tokens|max output tokens/i.test(text) && cur > OUTPUT_FLOOR) return Math.max(OUTPUT_FLOOR, Math.floor(cur / 2));
      if (status === 429 && /output tokens|rate limit/i.test(text) && cur > OUTPUT_FLOOR) return Math.max(OUTPUT_FLOOR, Math.floor(cur / 2));
      return 0;
    },
    read: async (body, onText, state) => {
      const calls = new Map();
      let text = '';
      let stopReason = null;
      let responseId = '';
      for await (const { event, data } of sseEvents(body)) {
        let ev;
        try { ev = JSON.parse(data); } catch { continue; }
        const type = ev.type || event;
        if (type === 'response.created') responseId = ev.response?.id || responseId;
        else if (type === 'response.output_text.delta') {
          const delta = ev.delta || '';
          text += delta;
          if (delta) onText(delta);
        } else if (type === 'response.output_item.added' && ev.item?.type === 'function_call') {
          calls.set(ev.item.id, { type: 'tool_use', id: ev.item.call_id, name: ev.item.name, input: {}, _json: ev.item.arguments || '' });
        } else if (type === 'response.function_call_arguments.delta') {
          const c = calls.get(ev.item_id);
          if (c) c._json = (c._json || '') + (ev.delta || '');
        } else if (type === 'response.function_call_arguments.done') {
          const c = calls.get(ev.item_id);
          if (c) c._json = ev.arguments || c._json || '';
        } else if (type === 'response.output_item.done' && ev.item?.type === 'function_call') {
          const c = calls.get(ev.item.id) || { type: 'tool_use' };
          c.id = ev.item.call_id || c.id;
          c.name = ev.item.name || c.name;
          c._json = ev.item.arguments || c._json || '';
          calls.set(ev.item.id, c);
        } else if (type === 'response.completed') {
          responseId = ev.response?.id || responseId;
          stopReason = ev.response?.incomplete_details?.reason === 'max_output_tokens' ? 'max_tokens' : 'end_turn';
        } else if (type === 'response.incomplete') {
          responseId = ev.response?.id || responseId;
          stopReason = ev.response?.incomplete_details?.reason === 'max_output_tokens' ? 'max_tokens' : (ev.response?.incomplete_details?.reason || 'incomplete');
        } else if (type === 'response.failed') {
          throw new Error(ev.response?.error?.message || 'OpenAI response failed');
        } else if (type === 'error' || type === 'response.error') {
          throw new Error(ev.message || ev.error?.message || 'OpenAI stream error');
        }
      }
      if (responseId) state.previousResponseId = responseId;
      const toolBlocks = [...calls.values()].map((c) => {
        try { c.input = c._json ? JSON.parse(c._json) : {}; }
        catch { c._incomplete = true; }
        delete c._json;
        return c;
      });
      const blocks = [...(text ? [{ type: 'text', text }] : []), ...toolBlocks];
      if (toolBlocks.length && stopReason === 'end_turn') stopReason = 'tool_use';
      return { blocks, stopReason };
    }
  },

  anthropic: {
    label: 'Anthropic',
    request: (key, model, system, messages, maxTokens) => ({
      url: `${cfg.anthropicBaseUrl}/v1/messages`,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: {
        model,
        max_tokens: maxTokens,
        stream: true,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: ASSISTANT_TOOLS,
        messages: messages.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content
            .filter((b) => b.type !== 'text' || (b.text && b.text.length))
            .map(stripInternal)
        }))
      }
    }),
    capRequest: (key, model) => ({
      url: `${cfg.anthropicBaseUrl}/v1/models/${encodeURIComponent(model)}`,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      pick: (j) => Number(j.max_tokens) || 0
    }),
    lowerCap: (status, text, cur) => {
      if (status === 400 && /max_tokens/i.test(text)) {
        const m = text.match(/>\s*(\d[\d,]*)/);
        const n = m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
        return n && n < cur ? n : cur > OUTPUT_FLOOR ? OUTPUT_FLOOR : 0;
      }
      if (status === 429 && /output tokens/i.test(text) && cur > OUTPUT_FLOOR) return Math.max(OUTPUT_FLOOR, Math.floor(cur / 2));
      return 0;
    },
    read: async (body, onText) => {
      const blocks = [];
      let stopReason = null;
      for await (const { event, data } of sseEvents(body)) {
        let ev;
        try { ev = JSON.parse(data); } catch { continue; }
        const type = ev.type || event;
        if (type === 'content_block_start') {
          const b = { ...ev.content_block, _json: '' };
          if (b.type === 'tool_use') b.input = b.input || {};
          blocks[ev.index] = b;
        } else if (type === 'content_block_delta') {
          const b = blocks[ev.index];
          const d = ev.delta || {};
          if (!b) continue;
          if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; if (d.text) onText(d.text); }
          else if (d.type === 'input_json_delta') b._json += d.partial_json || '';
          else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + (d.thinking || '');
          else if (d.type === 'signature_delta') b.signature = d.signature;
        } else if (type === 'content_block_stop') {
          const b = blocks[ev.index];
          if (!b) continue;
          if (b.type === 'tool_use') {
            try { b.input = b._json.trim() ? JSON.parse(b._json) : b.input; }
            catch { b._incomplete = true; }
          }
          b._done = true;
        } else if (type === 'message_delta') {
          if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
        } else if (type === 'error') throw new Error(ev.error?.message || 'Anthropic stream error');
      }
      return {
        stopReason,
        blocks: blocks.filter(Boolean).map((b) => {
          if (b.type === 'tool_use' && !b._done) b._incomplete = true;
          delete b._json; delete b._done;
          return b;
        })
      };
    }
  },

  gemini: {
    label: 'Gemini',
    request: (key, model, system, messages, maxTokens) => ({
      url: `${cfg.geminiBaseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        tools: [{ functionDeclarations: ASSISTANT_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.input_schema })) }],
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content)
            .filter((b) => ['text', 'tool_use', 'tool_result'].includes(b.type))
            .map((b) => {
              const sig = b._sig ? { thoughtSignature: b._sig } : {};
              if (b.type === 'tool_use') return { functionCall: { name: b.name, args: b.input || {} }, ...sig };
              if (b.type === 'tool_result') return { functionResponse: { name: b._toolName || 'tool', response: { result: b.content } } };
              return { text: b.text || '', ...sig };
            })
        })),
        generationConfig: { maxOutputTokens: maxTokens }
      }
    }),
    capRequest: (key, model) => ({
      url: `${cfg.geminiBaseUrl}/v1beta/models/${encodeURIComponent(model)}`,
      headers: { 'x-goog-api-key': key },
      pick: (j) => Number(j.outputTokenLimit) || 0
    }),
    lowerCap: (status, text, cur) => (status === 400 && /max_?output_?tokens/i.test(text) && cur > OUTPUT_FLOOR ? OUTPUT_FLOOR : 0),
    read: async (body, onText) => {
      const blocks = [];
      let finish = null;
      let n = 0;
      for await (const { data } of sseEvents(body)) {
        let ev;
        try { ev = JSON.parse(data); } catch { continue; }
        if (ev.error) throw new Error(ev.error.message || 'Gemini error');
        if (ev.promptFeedback?.blockReason) throw new Error(`Gemini blocked the request: ${ev.promptFeedback.blockReason}`);
        const cand = ev.candidates?.[0];
        for (const p of cand?.content?.parts || []) {
          const sig = p.thoughtSignature ? { _sig: p.thoughtSignature } : {};
          if (p.functionCall) {
            blocks.push({ type: 'tool_use', id: `g_${Date.now()}_${n++}`, name: p.functionCall.name, input: p.functionCall.args || {}, ...sig });
          } else if (typeof p.text === 'string' && !p.thought) {
            const last = blocks[blocks.length - 1];
            if (last?.type === 'text') { last.text += p.text; if (sig._sig) last._sig = sig._sig; }
            else blocks.push({ type: 'text', text: p.text, ...sig });
            if (p.text) onText(p.text);
          }
        }
        if (cand?.finishReason) finish = cand.finishReason;
      }
      const stopReason = finish === 'MAX_TOKENS' ? 'max_tokens' : finish === 'STOP' || !finish ? 'end_turn' : finish;
      return { blocks, stopReason };
    }
  }
};

async function* sseEvents(body) {
  const dec = new TextDecoder();
  let buf = '';
  let event = '';
  let data = [];
  const flush = () => { const rec = data.length ? { event, data: data.join('\n') } : null; event = ''; data = []; return rec; };
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line === '') { const rec = flush(); if (rec) yield rec; continue; }
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  const rec = flush();
  if (rec) yield rec;
}

const capCache = new Map();
async function outputCap(provider, key, model, signal) {
  const p = PROVIDERS[provider];
  if (p.outputCap) return Math.min(p.outputCap, OUTPUT_CEILING);
  const k = `${provider}:${model}`;
  if (capCache.has(k)) return capCache.get(k);
  try {
    const { url, headers, pick } = p.capRequest(key, model);
    const r = await fetch(url, { headers, signal });
    if (r.ok) {
      const n = pick(await r.json());
      if (n) {
        const cap = Math.min(n, OUTPUT_CEILING);
        capCache.set(k, cap);
        log('assistant', `${model}: output cap ${n.toLocaleString()} tokens → asking for ${cap.toLocaleString()}`);
        return cap;
      }
    }
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  return OUTPUT_FALLBACK;
}

function toolDetail(name, out) {
  if (out.error) return out.error;
  if (out.load_error) return `${out.path ? out.path + ' — ' : ''}LOAD ERROR: ${out.load_error}`;
  if (name === 'read_module_file') return `${out.path} lines ${out.start_line}-${out.end_line} of ${out.total_lines}`;
  if (name === 'edit_module_file') return `${out.path} line ${out.line}${out.replaced > 1 ? ` (${out.replaced} places)` : ''} — module reloaded OK`;
  if (name === 'write_module_file') return `${out.path} ${out.created ? 'created' : 'rewritten'} (${out.total_lines} lines) — module reloaded OK`;
  if (name === 'reload_modules') return `${(out.modules || []).length} module(s) rescanned`;
  return out.url || '';
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
    system = mcpId ? `${getState().instructions}\n\n${moduleContext(mcpId)}` : `${getState().instructions}\n\n${liveContext()}`;
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const model = getModel(provider);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (obj) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };

  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': hb\n\n'); }, cfg.assistantHeartbeatMs);
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });

  const internal = messages.map((m) => ({ role: m.role, content: m.content }));
  const providerState = {};
  try {
    let maxTokens = await outputCap(provider, key, model, ctrl.signal);
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      let upstream = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const { url, headers, body } = p.request(key, model, system, internal, maxTokens, providerState);
        upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
        if (upstream.ok) break;
        const t = await upstream.text();
        const lower = p.lowerCap(upstream.status, t, maxTokens);
        if (lower && attempt < 3) {
          log('assistant', `${p.label} ${upstream.status} at output cap ${maxTokens} — retrying at ${lower}: ${t.slice(0, 160)}`);
          maxTokens = lower;
          capCache.set(`${provider}:${model}`, lower);
          upstream = null;
          continue;
        }
        log('assistant', `${p.label} error ${upstream.status}: ${t.slice(0, 300)}`);
        send({ error: `${p.label} API ${upstream.status}: ${t.slice(0, 300)}` });
        upstream = null;
        break;
      }
      if (!upstream) break;

      const { blocks, stopReason } = await p.read(upstream.body, (text) => send({ text }), providerState);
      const toolUses = blocks.filter((b) => b.type === 'tool_use');
      const broken = toolUses.find((b) => b._incomplete);

      if (stopReason === 'max_tokens') {
        log('assistant', `${p.label} reply hit the ${maxTokens}-token output cap${broken ? ` inside a ${broken.name} call` : ''}`);
        send({
          notice: broken
            ? `Reply cut off: the ${maxTokens.toLocaleString()}-token output limit was reached in the middle of its ${broken.name} call, so nothing was changed. Ask for it as a smaller edit or in parts.`
            : `Reply cut off at the model's ${maxTokens.toLocaleString()}-token output limit. For a big file, ask me to apply a targeted edit instead of writing the whole file out.`
        });
        break;
      }
      if (broken) { send({ notice: `The model's ${broken.name} call arrived incomplete — nothing was changed. Try again.` }); break; }
      if (!toolUses.length) {
        if (stopReason && !['end_turn', 'stop_sequence', 'tool_use'].includes(stopReason)) send({ notice: `${p.label} stopped early: ${stopReason}` });
        break;
      }

      internal.push({ role: 'assistant', content: blocks });
      const results = [];
      for (const tu of toolUses) {
        send({ tool: { name: tu.name, status: 'running' } });
        const out = await execAssistantTool(tu.name, tu.input || {}, { scopeId: mcpId });
        send({ tool: { name: tu.name, ok: !out.error && out.ok !== false, detail: toolDetail(tu.name, out) } });
        if (out.fileChanged) send({ file_changed: out.fileChanged });
        if (out.modulesChanged) send({ modules_changed: true });
        results.push({
          type: 'tool_result', tool_use_id: tu.id, _toolName: tu.name,
          content: JSON.stringify(out).slice(0, 20_000),
          ...(out.error ? { is_error: true } : {})
        });
      }
      internal.push({ role: 'user', content: results });
      if (hop === MAX_HOPS - 1) send({ notice: `Stopped after ${MAX_HOPS} tool rounds — say "continue" to carry on.` });
    }
  } catch (e) {
    if (ctrl.signal.aborted) log('assistant', 'Browser went away mid-turn — upstream request aborted');
    else { log('assistant', `Agent loop error: ${e.message}`); send({ error: e.message }); }
  } finally {
    clearInterval(heartbeat);
    send({ done: true });
    if (!res.writableEnded) res.end();
  }
}
