import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');

const trimSlash = (s) => String(s || '').replace(/\/+$/, '');

const provider = String(process.env.ASSISTANT_PROVIDER || '').toLowerCase();

export const cfg = {
  version: '2.0.0',
  port: parseInt(process.env.PORT || '8788', 10),
  /** Public https base URL, no trailing slash. Enables OAuth when set. */
  publicUrl: trimSlash(process.env.PUBLIC_URL),
  appPassword: process.env.APP_PASSWORD || '',
  /** Static bearer accepted on every MCP endpoint (Claude Code CLI etc.). */
  mcpToken: process.env.MCP_TOKEN || '',
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  mcpsDir: process.env.MCPS_DIR || path.join(ROOT, 'mcps'),
  cookieSecure: process.env.COOKIE_SECURE === '1',

  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-6-astra',
  openaiBaseUrl: trimSlash(process.env.OPENAI_BASE_URL) || 'https://api.openai.com',

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  /** API origins — override to route the ✦ assistant through a gateway/proxy (or a test mock). */
  anthropicBaseUrl: trimSlash(process.env.ANTHROPIC_BASE_URL) || 'https://api.anthropic.com',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  geminiBaseUrl: trimSlash(process.env.GEMINI_BASE_URL) || 'https://generativelanguage.googleapis.com',
  /** Which backend the ✦ popup talks to when the UI hasn't chosen one: openai | anthropic | gemini. */
  assistantProvider: ['openai', 'anthropic', 'gemini'].includes(provider) ? provider : 'openai',
  /** SSE keep-alive cadence for the ✦ popup stream (ms). Proxies drop idle responses at ~60–100 s. */
  assistantHeartbeatMs: Math.max(250, parseInt(process.env.ASSISTANT_HEARTBEAT_MS || '15000', 10) || 15000)
};
