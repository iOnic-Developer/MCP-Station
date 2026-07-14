import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');

export const cfg = {
  version: '1.3.1',
  port: parseInt(process.env.PORT || '8788', 10),
  /** Public https base URL, no trailing slash. Enables OAuth when set. */
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  appPassword: process.env.APP_PASSWORD || '',
  /** Static bearer accepted on every MCP endpoint (Claude Code CLI etc.). */
  mcpToken: process.env.MCP_TOKEN || '',
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  mcpsDir: process.env.MCPS_DIR || path.join(ROOT, 'mcps'),
  cookieSecure: process.env.COOKIE_SECURE === '1',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  /** Which backend the ✦ popup talks to when the UI hasn't chosen one: anthropic | gemini */
  assistantProvider: process.env.ASSISTANT_PROVIDER === 'gemini' ? 'gemini' : 'anthropic'
};
