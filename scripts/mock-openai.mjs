#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';

const port = parseInt(process.argv[2] || '8899', 10);
const record = process.argv[3] || '';
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b)); });
const json = (res, status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const sse = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);

function firstUserText(input) {
  for (let i = (input || []).length - 1; i >= 0; i--) {
    const x = input[i];
    if (x?.role === 'user') return typeof x.content === 'string' ? x.content : '';
  }
  return '';
}

function textResponse(res, id, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  sse(res, 'response.created', { response: { id, status: 'in_progress' } });
  for (const delta of chunks) sse(res, 'response.output_text.delta', { item_id: `msg_${id}`, output_index: 0, content_index: 0, delta });
  sse(res, 'response.completed', { response: { id, status: 'completed', incomplete_details: null } });
  res.end();
}

function toolResponse(res, id) {
  const itemId = `fc_${id}`;
  const callId = `call_${id}`;
  const args = JSON.stringify({ path: 'index.js', find: 'ORIGINAL_MARKER', replace: 'OPENAI_MARKER' });
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  sse(res, 'response.created', { response: { id, status: 'in_progress' } });
  sse(res, 'response.output_item.added', { output_index: 0, item: { id: itemId, type: 'function_call', status: 'in_progress', call_id: callId, name: 'edit_module_file', arguments: '' } });
  sse(res, 'response.function_call_arguments.delta', { item_id: itemId, output_index: 0, delta: args.slice(0, 30) });
  sse(res, 'response.function_call_arguments.delta', { item_id: itemId, output_index: 0, delta: args.slice(30) });
  sse(res, 'response.function_call_arguments.done', { item_id: itemId, output_index: 0, arguments: args });
  sse(res, 'response.output_item.done', { output_index: 0, item: { id: itemId, type: 'function_call', status: 'completed', call_id: callId, name: 'edit_module_file', arguments: args } });
  sse(res, 'response.completed', { response: { id, status: 'completed', incomplete_details: null } });
  res.end();
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const raw = await readBody(req);
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: { message: 'bad json' } }); }
  if (record) fs.appendFileSync(record, JSON.stringify({ method: req.method, path: url.pathname, headers: req.headers, body }) + '\n');

  if (req.method !== 'POST' || url.pathname !== '/v1/responses') return json(res, 404, { error: { message: 'not found' } });
  if (req.headers.authorization !== 'Bearer mock-openai-key') return json(res, 401, { error: { message: 'bad bearer' } });
  if (body.model !== 'gpt-6-astra') return json(res, 400, { error: { message: `wrong model ${body.model}` } });

  const id = `resp_${Date.now()}`;
  if (body.previous_response_id) {
    const out = (body.input || []).find((x) => x?.type === 'function_call_output');
    return textResponse(res, id, [out ? 'TOOL_RESULT:ok' : 'TOOL_RESULT:missing']);
  }

  const text = firstUserText(body.input).toLowerCase();
  if (text.includes('edit')) return toolResponse(res, id);
  return textResponse(res, id, ['Hello ', 'from OpenAI mock.']);
}).listen(port, '127.0.0.1', () => console.log(`mock-openai listening on http://127.0.0.1:${port}`));
