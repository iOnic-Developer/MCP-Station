// Registration introspection only: GET capabilities never invokes an upstream tool.
// One scheduler per app context, with account-scoped results held in memory for 60s.
export function renderToolCounts(root, ctx, rows) {
  const state = ctx.toolCounts ||= createScheduler();
  const token = Symbol('tool-count-render');
  root.stationToolCountsRender = token;
  const eligible = new Set(rows.filter(({ m }) => m.manifest && !m.error).map(({ m }) => m.id));
  state.current = { root, token, eligible };
  // Replace queued work, but reuse active jobs across refreshes to preserve the cap.
  state.queue = [];
  for (const [id, job] of state.jobs) if (!job.controller) state.jobs.delete(id);
  for (const { m } of rows) {
    if (!eligible.has(m.id)) continue;
    const cached = state.cache.get(m.id);
    if (cached && Date.now() - cached.at < 60000) state.apply(m.id, cached.count);
    else {
      state.cache.delete(m.id);
      if (!state.jobs.has(m.id)) {
        const job = { id: m.id, epoch: state.epoch };
        state.jobs.set(m.id, job); state.queue.push(job);
      }
    }
  }
  // Deleted accounts must not retain cached metadata indefinitely.
  for (const id of state.cache.keys()) if (!eligible.has(id)) state.cache.delete(id);
  state.pump();
}
function createScheduler() {
  const state = { cache: new Map(), jobs: new Map(), queue: [], active: 0, current: null, epoch: Symbol('session') };
  state.apply = (id, count) => {
    const view = state.current;
    if (!view?.root.isConnected || view.root.stationToolCountsRender !== view.token || !view.eligible.has(id)) return;
    const row = [...view.root.querySelectorAll('[data-id]')].find((el) => el.dataset.id === id);
    const link = row?.querySelector('[data-tool-count]');
    if (!link) return;
    link.querySelector('span').textContent = count === null ? '—' : String(count);
    link.setAttribute('aria-label', count === null ? 'Tool count unknown — view tools' : `${count} registered tools — view tools`);
    link.title = count === null ? 'Registered tool count unavailable. View tools to retry.' : `${count} registered tools for this account — registration introspection, not a connection test. View tools.`;
  };
  state.pump = () => {
    while (state.active < 2 && state.queue.length) {
      const job = state.queue.shift();
      const view = state.current;
      if (job.epoch !== state.epoch || !view?.root.isConnected || view.root.stationToolCountsRender !== view.token) {
        if (state.jobs.get(job.id) === job) state.jobs.delete(job.id);
        continue;
      }
      job.controller = new AbortController(); state.active++;
      const timeout = setTimeout(() => job.controller.abort(), 20000);
      void (async () => {
        try {
          const response = await fetch(`/api/mcps/${encodeURIComponent(job.id)}/capabilities`, {
            headers: { 'x-station-csrf': '1' }, credentials: 'same-origin', cache: 'no-store', signal: job.controller.signal
          });
          if (job.epoch !== state.epoch) return;
          if (response.status === 401) window.dispatchEvent(new Event('station:unauthed'));
          if (!response.ok) throw new Error('Capabilities unavailable');
          const data = await response.json();
          if (!Array.isArray(data.tools)) throw new Error('Invalid capabilities');
          if (job.epoch !== state.epoch) return;
          state.cache.set(job.id, { count: data.tools.length, at: Date.now() });
          state.apply(job.id, data.tools.length);
        } catch {
          if (job.epoch === state.epoch) state.apply(job.id, null);
        } finally {
          clearTimeout(timeout); state.active--;
          if (state.jobs.get(job.id) === job) state.jobs.delete(job.id);
          state.pump();
        }
      })();
    }
  };
  window.addEventListener('station:unauthed', () => {
    state.epoch = Symbol('session'); state.current = null; state.queue = []; state.cache.clear();
    for (const job of state.jobs.values()) job.controller?.abort();
    state.jobs.clear();
  });
  return state;
}
