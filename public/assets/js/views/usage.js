import { api } from '../api.js';
import { esc } from '../ui.js';
export function renderUsage(root, instanceId) {
  root.innerHTML = `<section class="panel usage-panel"><div class="section-heading"><h2>${instanceId ? 'Account activity' : 'Usage across your station'}</h2><label class="usage-range">Period <select class="input" data-days><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label></div><div data-usage-body></div></section>`;
  const body = root.querySelector('[data-usage-body]'), range = root.querySelector('[data-days]'); let generation = 0;
  async function load() {
    const version = ++generation;
    body.innerHTML = '<p role="status">Loading recorded activity…</p>';
    try {
      const query = new URLSearchParams({ days: range.value }); if (instanceId) query.set('instanceId', instanceId);
      const data = await api(`/usage?${query}`);
      if (version !== generation || !root.isConnected) return;
      const t = data.totals, daily = data.daily || [];
      const stats = [['Tool calls', t.calls], ['Errors', t.errors], ['Success rate', t.successRate === null ? 'No calls yet' : `${(t.successRate * 100).toFixed(1)}%`], ['Average response', t.averageLatencyMs === null ? 'No calls yet' : `${Math.round(t.averageLatencyMs)} ms`]];
      const max = Math.max(1, ...daily.map((d) => d.calls));
      const chart = daily.length ? `<svg class="usage-chart" viewBox="0 0 720 210" role="img" aria-label="Daily tool calls and errors. Exact UTC dates and counts follow in the data table."><line x1="40" y1="175" x2="700" y2="175" class="chart-axis"/><text x="4" y="22">${max}</text><text x="20" y="179">0</text>${daily.map((d,i) => {
        const width = 650 / daily.length, x = 45 + i * width, h = d.calls / max * 150, eh = d.errors / max * 150;
        return `<g><title>${esc(d.date)}: ${d.calls} calls, ${d.errors} errors</title><rect class="chart-calls" x="${x}" y="${175-h}" width="${Math.max(2,width*.65)}" height="${h}"/><rect class="chart-errors" x="${x}" y="${175-eh}" width="${Math.max(2,width*.25)}" height="${eh}"/></g>`;
      }).join('')}<text x="40" y="202">${esc(daily[0].date)}</text><text x="700" y="202" text-anchor="end">${esc(daily.at(-1).date)}</text></svg><p class="help">Wide bars: calls · Narrow bars: errors. Only dates with observed calls are plotted; dates use UTC.</p><details class="usage-data"><summary>Daily counts — accessible data table</summary><div class="table-scroll"><table class="args"><caption>Recorded daily tool activity (UTC)</caption><thead><tr><th scope="col">Date</th><th scope="col">Calls</th><th scope="col">Errors</th></tr></thead><tbody>${daily.map((d) => `<tr><th scope="row">${esc(d.date)}</th><td>${d.calls}</td><td>${d.errors}</td></tr>`).join('')}</tbody></table></div></details>` : '<div class="empty-state compact"><h3>No recorded tool calls in this period</h3><p>Use a connected client to run a tool. Setup tests, authorization and tool listings do not count as usage.</p></div>';
      body.innerHTML = `<div class="stats-grid" aria-label="Recorded usage">${stats.map(([label,value]) => `<article class="stat"><span>${label}</span><strong>${esc(value)}</strong></article>`).join('')}</div><p class="metric-note">Rolling window since ${esc(new Date(data.since).toLocaleString())}. Bounded operational history: up to 30 days or 5,000 events; not a billing ledger.</p>${chart}${data.integrations?.length && !instanceId ? `<h3>Calls by account</h3><div class="table-scroll"><table class="args"><thead><tr><th scope="col">Account</th><th scope="col">Calls</th><th scope="col">Errors</th></tr></thead><tbody>${data.integrations.map((m) => `<tr><th scope="row">${esc(m.name)}</th><td>${m.calls}</td><td>${m.errors}</td></tr>`).join('')}</tbody></table></div>` : ''}${instanceId && data.recent?.length ? `<h3>Recent tool calls</h3><div class="table-scroll"><table class="args"><thead><tr><th scope="col">Time</th><th scope="col">Tool</th><th scope="col">Result</th><th scope="col">Duration</th></tr></thead><tbody>${data.recent.map((r) => `<tr><td>${esc(new Date(r.time).toLocaleString())}</td><td>${esc(r.tool)}</td><td>${r.ok ? 'Succeeded' : 'Failed'}</td><td>${r.durationMs} ms</td></tr>`).join('')}</tbody></table></div>` : ''}`;
    } catch (e) {
      if (version !== generation || !root.isConnected) return;
      body.innerHTML = `<p class="error-text" role="alert">Usage could not be loaded: ${esc(e.message)}. No summary is available.</p><button class="btn" data-retry-usage>Try again</button>`;
      body.querySelector('[data-retry-usage]').onclick = load;
    }
  }
  range.onchange = load; void load();
}
