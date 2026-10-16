/** Bounded tool-call metadata only. Kept outside station.json and credential exports. */
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './env.js';

export const RETENTION_DAYS = 30;
export const MAX_EVENTS = 5000;
const file = () => path.join(cfg.dataDir, 'usage.json');
let events;
let timer;
const safeName = (v) => typeof v === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(v);
function clean(e) {
  if (!e || !Number.isFinite(Date.parse(e.time)) || !safeName(e.instanceId) || !safeName(e.moduleId)
    || typeof e.tool !== 'string' || !(safeName(e.tool) || e.tool === '(invalid)')
    || !Number.isFinite(e.durationMs) || e.durationMs < 0 || typeof e.ok !== 'boolean') return null;
  return { time: new Date(e.time).toISOString(), instanceId: e.instanceId, moduleId: e.moduleId,
    tool: e.tool, durationMs: Math.round(e.durationMs * 100) / 100, ok: e.ok };
}
function prune(now = Date.now()) {
  events = events.filter((e) => Date.parse(e.time) >= now - RETENTION_DAYS * 86400_000 && Date.parse(e.time) <= now).slice(-MAX_EVENTS);
}
function load() {
  if (events) return;
  try {
    // Refuse oversized/untrusted files rather than reading an unbounded history.
    const parsed = fs.statSync(file()).size <= 4_000_000 ? JSON.parse(fs.readFileSync(file(), 'utf8')) : [];
    events = Array.isArray(parsed) ? parsed.slice(-MAX_EVENTS).map(clean).filter(Boolean) : [];
  } catch { events = []; }
  prune();
}
/** Re-read after startup/restore so the in-memory metadata cannot overwrite restored history. */
export function reloadUsage() {
  clearTimeout(timer);
  events = undefined;
  load();
  persistUsage();
}
export function persistUsage() {
  if (!events) return;
  clearTimeout(timer);
  prune();
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.writeFileSync(file() + '.tmp', JSON.stringify(events));
  fs.renameSync(file() + '.tmp', file());
}
export function recordUsage(event) {
  load();
  const value = clean(event);
  if (!value) return;
  events.push(value);
  prune();
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { persistUsage(); } catch { console.error('usage persist failed'); }
  }, 150);
  timer.unref();
}
export function getUsage({ days = 7, instanceId, nameFor = (id) => id } = {}) {
  days = Number(days);
  if (!Number.isInteger(days) || days < 1 || days > RETENTION_DAYS) throw new Error('days must be an integer from 1 to 30');
  if (instanceId !== undefined && !safeName(instanceId)) throw new Error('Invalid instanceId');
  load();
  prune();
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const rows = events.filter((e) => e.time >= since && (instanceId === undefined || e.instanceId === instanceId));
  const summarize = (items) => {
    const calls = items.length;
    const errors = items.filter((e) => !e.ok).length;
    return { calls, errors, successRate: calls ? (calls - errors) / calls : null,
      averageLatencyMs: calls ? Math.round(items.reduce((n, e) => n + e.durationMs, 0) / calls * 100) / 100 : null };
  };
  const daily = new Map();
  const integrations = new Map();
  for (const e of rows) {
    const date = e.time.slice(0, 10);
    const day = daily.get(date) || { date, calls: 0, errors: 0 };
    day.calls++; if (!e.ok) day.errors++;
    daily.set(date, day);
    const group = integrations.get(e.instanceId) || [];
    group.push(e); integrations.set(e.instanceId, group);
  }
  return { since, days, totals: summarize(rows), daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    integrations: [...integrations].map(([id, items]) => {
      const { calls, errors, averageLatencyMs } = summarize(items);
      return { id, name: nameFor(id), calls, errors, averageLatencyMs };
    }).sort((a, b) => b.calls - a.calls || a.id.localeCompare(b.id)),
    recent: rows.slice(-100).reverse().map((e) => ({ ...e })) };
}
