/** In-memory ring buffer of recent log lines, surfaced at /api/logs for the UI debug panel. */
const RING = [];
const MAX = 500;

export function log(scope, msg) {
  const line = { t: new Date().toISOString(), scope, msg: String(msg) };
  RING.push(line);
  if (RING.length > MAX) RING.shift();
  console.log(`[${line.t}] [${scope}] ${line.msg}`);
}

export const getLogs = () => RING.slice();
