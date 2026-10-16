import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const password = 'station-browser-fixture-only';
export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function startServer() {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'station-test-'));
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  await mkdir(path.join(temp, 'modules'));
  // Deliberately no real modules or inherited provider credentials. Provider origins
  // also point at this fixture, so an accidental assistant call cannot go upstream.
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: path.join(temp, 'data'),
      MCPS_DIR: path.join(temp, 'modules'), APP_PASSWORD: password, PUBLIC_URL: base,
      COOKIE_SECURE: '0', MCP_TOKEN: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '',
      GEMINI_API_KEY: '', OPENAI_BASE_URL: base, ANTHROPIC_BASE_URL: base, GEMINI_BASE_URL: base },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs = (logs + chunk).slice(-12000); });
  child.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-12000); });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit'); child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      try { await exit; } finally { clearTimeout(timer); }
    }
    await rm(temp, { recursive: true, force: true });
  };
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Fixture exited: ${logs}`);
      try { if ((await fetch(`${base}/healthz`)).ok) return { base, stop }; } catch {}
      await pause(100);
    }
    throw new Error(`Fixture readiness timeout: ${logs}`);
  } catch (error) { await stop(); throw error; }
}
