import { api } from '../api.js';
import { esc, toast, modal } from '../ui.js';

/** Renders one tool's arguments straight from its JSON Schema. */
function args(schema) {
  const props = schema?.properties || {};
  const required = new Set(schema?.required || []);
  const rows = Object.entries(props);
  if (!rows.length) return '<div class="dim" style="font-size:12px">No arguments.</div>';
  return `<table class="args"><tbody>${rows.map(([k, v]) => `
    <tr>
      <td class="mono">${esc(k)}${required.has(k) ? '<span class="req" title="required">*</span>' : ''}</td>
      <td class="dim mono">${esc(v.type || (v.anyOf ? 'any' : '?'))}</td>
      <td>${esc(v.description || '')}</td>
    </tr>`).join('')}</tbody></table>`;
}

/** 🧰 Capabilities: the tools, prompts and house rules this MCP actually exposes. */
export async function openCapabilities(m) {
  let cap;
  try {
    cap = await api(`/mcps/${m.id}/capabilities`);
  } catch (e) {
    return toast(e.message, 'err', 6000);
  }

  const { tools = [], prompts = [], instructions = '' } = cap;
  const dlg = modal({
    title: `🧰 ${m.manifest?.icon || ''} ${cap.name} — capabilities`,
    body: `
      <div class="help" style="margin-bottom:14px">
        Read live from the running module — this is exactly what a connected client sees.
        <b>${tools.length}</b> tool${tools.length === 1 ? '' : 's'} ·
        <b>${prompts.length}</b> prompt${prompts.length === 1 ? '' : 's'} ·
        ${instructions ? `<b>ships house instructions</b> (${instructions.length} chars)` : 'no instructions file'}
      </div>

      <input class="input" id="capFilter" placeholder="Filter tools…" style="margin-bottom:12px">

      <div id="toolList">${tools.map((t) => `
        <details class="tool" data-name="${esc(t.name.toLowerCase())} ${esc((t.description || '').toLowerCase())}">
          <summary><span class="mono">${esc(t.name)}</span>${annotate(t)}</summary>
          <div class="tool-body">
            <p>${esc(t.description || 'No description.')}</p>
            ${args(t.inputSchema)}
          </div>
        </details>`).join('') || '<div class="dim">This module registers no tools.</div>'}</div>

      ${prompts.length ? `<h4 style="margin:18px 0 8px">Prompts</h4>
        ${prompts.map((p) => `
          <details class="tool">
            <summary><span class="mono">/${esc(p.name)}</span></summary>
            <div class="tool-body">
              <p>${esc(p.description || '')}</p>
              ${(p.arguments || []).length
                ? `<table class="args"><tbody>${p.arguments.map((a) => `<tr><td class="mono">${esc(a.name)}${a.required ? '<span class="req">*</span>' : ''}</td><td>${esc(a.description || '')}</td></tr>`).join('')}</tbody></table>`
                : '<div class="dim" style="font-size:12px">No arguments.</div>'}
            </div>
          </details>`).join('')}` : ''}

      ${instructions ? `<h4 style="margin:18px 0 8px">House instructions sent to every client</h4>
        <pre class="logbox" style="white-space:pre-wrap">${esc(instructions)}</pre>` : ''}`,
    foot: `<div class="spacer"></div><button class="btn primary" data-cancel>Done</button>`
  });

  const filter = dlg.querySelector('#capFilter');
  filter.oninput = () => {
    const q = filter.value.trim().toLowerCase();
    for (const el of dlg.querySelectorAll('#toolList .tool')) {
      el.hidden = q && !el.dataset.name.includes(q);
    }
  };
  dlg.querySelector('[data-cancel]').onclick = () => dlg.close();
}

/** Behaviour hints the tool declares — the bit you want to see before letting a stranger's MCP run. */
function annotate(t) {
  const a = t.annotations || {};
  const tags = [];
  if (a.readOnlyHint) tags.push('<span class="tag ok">read-only</span>');
  if (a.destructiveHint) tags.push('<span class="tag danger">destructive</span>');
  if (a.idempotentHint) tags.push('<span class="tag">idempotent</span>');
  if (a.openWorldHint) tags.push('<span class="tag">external</span>');
  return tags.join('');
}
