#!/usr/bin/env node
/**
 * Mock of the two LLM APIs the ✦ assistant talks to (Anthropic Messages + Gemini
 * generateContent), speaking their STREAMING wire shapes, for scripts/smoke-assistant.sh.
 *
 *   node scripts/mock-llm.mjs <port> [record-file]
 *
 * The scenario is chosen by the last user message's text (see scenario()). Every request body
 * is appended to the record file as one JSON line so the test can assert on what the station
 * sent (stream flag, max_tokens, cache_control, echoed thinking blocks, …).
 */
import http from 'node:http';
import fs from 'node:fs';

const port = parseInt(process.argv[2] || '8898', 10);
const record = process.argv[3] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b)); });

/* ── What the station said ─────────────────────────────────────────── */
function lastUserText(body, kind) {
  const msgs = kind === 'anthropic' ? body.messages || [] : body.contents || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    const parts = kind === 'anthropic' ? m.content : m.parts || [];
    const t = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n');
    if (t) return t;
  }
  return '';
}
function toolResults(body, kind) {
  const msgs = kind === 'anthropic' ? body.messages || [] : body.contents || [];
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'user' || typeof last.content === 'string') return [];
  const parts = kind === 'anthropic' ? last.content : last.parts || [];
  return parts
    .map((p) => (p.type === 'tool_result' ? p.content : p.functionResponse ? p.functionResponse.response?.result : null))
    .filter(Boolean)
    .map((c) => { try { return JSON.parse(c); } catch { return { raw: c }; } });
}
const thinkingEchoed = (body) =>
  (body.messages || []).some((m) => m.role === 'assistant' && Array.isArray(m.content)
    && m.content.some((b) => b.type === 'thinking' && b.signature === 'sig_mock'));

/* ── Scenarios ─────────────────────────────────────────────────────── */
const EDIT = { name: 'edit_module_file', input: { path: 'index.js', find: 'ORIGINAL_MARKER', replace: 'REPLACED_MARKER' } };
function scenario(text, results, body, kind) {
  const t = text.toLowerCase();
  if (results.length) {
    const r = results[0];
    if (t.includes('read')) return { text: [`READ_RESULT:${String(r.content || '').split('\n')[0]}`] };
    if (t.includes('fetch')) return { text: [`FETCH_RESULT:${String(r.content || r.error || '').replace(/\s+/g, ' ').slice(0, 160)}`] };
    if (t.includes('thinkedit')) return { text: [`THINKING_ECHOED:${thinkingEchoed(body) ? 'yes' : 'no'}`] };
    return { text: [`TOOL_RESULT:${r.error ? 'error:' + r.error : r.load_error ? 'load_error' : 'ok'}`] };
  }
  if (t.includes('fetch')) return { tools: [{ name: 'fetch_url', input: { url: `http://127.0.0.1:${port}/docs` } }] };
  if (t.includes('cutoff')) return { text: ['This reply will be ', 'cut off'], stop: 'max_tokens' };
  if (t.includes('toolcut')) return { tools: [EDIT], cutTool: true, stop: 'max_tokens' };
  if (t.includes('slow')) return { text: ['slow reply'], delayMs: 1500 };
  if (t.includes('thinkedit')) return { thinking: 'Let me edit that.', tools: [EDIT] };
  if (t.includes('badtool')) return { tools: [{ name: 'edit_module_file', input: { path: 'index.js', find: 'NOPE_NOT_THERE', replace: 'x' } }] };
  if (t.includes('scope')) return { tools: [{ name: 'edit_module_file', input: { id: 'gemini', path: 'index.js', find: 'a', replace: 'b' } }] };
  if (t.includes('dotfile')) return { tools: [{ name: 'write_module_file', input: { path: '.config.json', content: '{}' } }] };
  if (t.includes('write')) return { tools: [{ name: 'write_module_file', input: { path: 'about.md', content: '# Smoke\n\nWritten by the mock.\n' } }] };
  if (t.includes('read')) return { tools: [{ name: 'read_module_file', input: { path: 'index.js', start_line: 1, end_line: 2 } }] };
  if (t.includes('break')) return { tools: [{ name: 'edit_module_file', input: { path: 'index.js', find: 'export function register', replace: 'export function register(' } }] };
  if (t.includes('edit')) return { text: ['Editing now. '], tools: [EDIT] };
  if (t.includes('toobig') || t.includes('ratelimit')) return { text: ['small ok'] };
  return { text: ['Hello ', 'from the mock.'] };
}

/* ── Wire shapes ───────────────────────────────────────────────────── */
function sseHead(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
}
async function anthropicTurn(res, s) {
  if (s.delayMs) await sleep(s.delayMs);
  sseHead(res);
  const w = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  w('message_start', { type: 'message_start', message: { id: 'msg_mock', type: 'message', role: 'assistant', model: 'mock', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
  let i = 0;
  if (s.thinking) {
    w('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'thinking', thinking: '' } });
    w('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'thinking_delta', thinking: s.thinking } });
    w('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'signature_delta', signature: 'sig_mock' } });
    w('content_block_stop', { type: 'content_block_stop', index: i++ });
  }
  if (s.text?.length) {
    w('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } });
    for (const chunk of s.text) {
      w('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: chunk } });
      await sleep(30);
    }
    w('content_block_stop', { type: 'content_block_stop', index: i++ });
  }
  for (const t of s.tools || []) {
    w('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: `toolu_${i}`, name: t.name, input: {} } });
    const json = JSON.stringify(t.input);
    if (s.cutTool) {
      w('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: json.slice(0, 25) } });
    } else {
      const mid = Math.floor(json.length / 2);
      w('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: json.slice(0, mid) } });
      w('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: json.slice(mid) } });
    }
    w('content_block_stop', { type: 'content_block_stop', index: i++ });
  }
  w('ping', { type: 'ping' });
  w('message_delta', { type: 'message_delta', delta: { stop_reason: s.stop || (s.tools?.length ? 'tool_use' : 'end_turn'), stop_sequence: null }, usage: { output_tokens: 10 } });
  w('message_stop', { type: 'message_stop' });
  res.end();
}
async function geminiTurn(res, s) {
  if (s.delayMs) await sleep(s.delayMs);
  sseHead(res);
  const w = (data) => res.write(`data: ${JSON.stringify(data)}\r\n\r\n`);
  for (const chunk of s.text || []) {
    w({ candidates: [{ content: { parts: [{ text: chunk }], role: 'model' }, index: 0 }] });
    await sleep(30);
  }
  for (const t of s.tools || []) {
    w({ candidates: [{ content: { parts: [{ functionCall: { name: t.name, args: t.input }, thoughtSignature: 'gsig_mock' }], role: 'model' }, index: 0 }] });
  }
  const finish = s.stop === 'max_tokens' ? 'MAX_TOKENS' : 'STOP';
  w({ candidates: [{ content: { parts: [{ text: '' }], role: 'model' }, finishReason: finish, index: 0 }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } });
  res.end();
}
const json = (res, status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

/* ── Server ────────────────────────────────────────────────────────── */
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const raw = await readBody(req);
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* keep {} */ }
  const kind = url.pathname.startsWith('/v1beta/') ? 'gemini' : 'anthropic';
  if (record) fs.appendFileSync(record, JSON.stringify({ kind, method: req.method, path: url.pathname, body }) + '\n');

  // A fake API reference for the fetch_url scenario.
  if (req.method === 'GET' && url.pathname === '/docs') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end('<html><head><title>Mock API</title><style>.x{}</style></head><body><h1>Mock API</h1><ul><li><a href="/docs/users">Users</a></li><li><a href="/docs/orders">Orders</a></li></ul><p>GET /v1/users &amp; friends</p><script>hidden()</script></body></html>');
  }

  // Model info — the output cap the station asks the provider for.
  if (req.method === 'GET' && url.pathname.startsWith('/v1/models/')) {
    return json(res, 200, { id: decodeURIComponent(url.pathname.slice(11)), type: 'model', max_tokens: 32000, max_input_tokens: 200000 });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/v1beta/models/')) {
    return json(res, 200, { name: url.pathname.slice(8), outputTokenLimit: 65536, inputTokenLimit: 1048576 });
  }

  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    if (req.headers['x-api-key'] !== 'mock-key') return json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    const text = lastUserText(body, 'anthropic');
    const t = text.toLowerCase();
    if (t.includes('fail')) return json(res, 500, { type: 'error', error: { type: 'api_error', message: 'mock upstream failure' } });
    if (t.includes('toobig') && body.max_tokens > 8192) {
      return json(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: `max_tokens: ${body.max_tokens} > 8192, which is the maximum allowed number of output tokens for ${body.model}` } });
    }
    if (t.includes('ratelimit') && body.max_tokens > 8192) {
      return json(res, 429, { type: 'error', error: { type: 'rate_limit_error', message: 'This request would exceed the rate limit for your organization of 8,000 output tokens per minute.' } });
    }
    return anthropicTurn(res, scenario(text, toolResults(body, 'anthropic'), body, 'anthropic'));
  }
  if (req.method === 'POST' && url.pathname.endsWith(':streamGenerateContent')) {
    if (req.headers['x-goog-api-key'] !== 'mock-key') return json(res, 400, { error: { code: 400, message: 'API key not valid', status: 'INVALID_ARGUMENT' } });
    const text = lastUserText(body, 'gemini');
    if (text.toLowerCase().includes('fail')) return json(res, 503, { error: { code: 503, message: 'mock gemini overloaded', status: 'UNAVAILABLE' } });
    return geminiTurn(res, scenario(text, toolResults(body, 'gemini'), body, 'gemini'));
  }
  json(res, 404, { error: `mock: no route for ${req.method} ${url.pathname}` });
}).listen(port, '127.0.0.1', () => console.log(`mock-llm listening on http://127.0.0.1:${port}`));
