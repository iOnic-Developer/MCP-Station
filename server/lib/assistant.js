/**
 * The Claude popup backend: streams Anthropic Messages API responses over SSE,
 * with retained instructions (state.instructions) + live station context as
 * the system prompt.
 */
import { cfg } from './env.js';
import { getState, save } from './state.js';
import { decrypt } from './crypto.js';
import { getModules, isConfigured } from './mcpHost.js';
import { SEED_INSTRUCTIONS } from './seedInstructions.js';
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
    ...lines
  ].join('\n');
}

/** Per-provider request shape + SSE delta extraction; the stream loop below is shared. */
const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    request: (key, model, system, messages) => ({
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: { model, max_tokens: 8192, system, messages, stream: true }
    }),
    text: (ev) => (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' ? ev.delta.text : ''),
    error: (ev) => (ev.type === 'error' ? ev.error?.message || 'stream error' : '')
  },
  gemini: {
    label: 'Gemini',
    request: (key, model, system, messages) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: 8192 }
      }
    }),
    text: (ev) => (ev.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''),
    error: (ev) => ev.error?.message || ''
  }
};

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

  const system = `${getState().instructions}\n\n${liveContext()}`;
  const { url, headers, body } = p.request(key, getModel(provider), system, messages);

  let upstream;
  try {
    upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) {
    return res.status(502).json({ error: `Could not reach the ${p.label} API: ${e.message}` });
  }

  if (!upstream.ok) {
    const t = await upstream.text();
    log('assistant', `${p.label} error ${upstream.status}: ${t.slice(0, 300)}`);
    return res.status(502).json({ error: `${p.label} API ${upstream.status}`, detail: t.slice(0, 500) });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let ev;
        try { ev = JSON.parse(line.slice(6)); } catch { continue; }
        const text = p.text(ev);
        const err = p.error(ev);
        if (text) send({ text });
        if (err) send({ error: err });
      }
    }
  } catch (e) {
    log('assistant', `Stream aborted: ${e.message}`);
  }
  send({ done: true });
  res.end();
}
