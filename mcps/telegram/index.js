/**
 * Telegram MCP — talks to the Telegram Bot API (https://core.telegram.org/bots/api).
 * Settings: bot_token (required), default_chat_id (optional fallback).
 */
const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

function needToken(settings) {
  if (!settings.bot_token) {
    return 'Error: bot_token is not configured. Open MCP Station → Telegram → Settings and paste the token from @BotFather.';
  }
  return null;
}

function resolveChat(settings, chat_id) {
  const id = chat_id || settings.default_chat_id;
  if (!id) {
    return { error: 'Error: no chat_id given and default_chat_id is not set. Pass chat_id, or set a default in MCP Station → Telegram → Settings (find yours via telegram_get_updates after messaging the bot).' };
  }
  return { id };
}

function summarizeUpdate(u) {
  const m = u.message || u.edited_message || u.channel_post || null;
  if (!m) return { update_id: u.update_id, type: Object.keys(u).filter((k) => k !== 'update_id')[0] || 'unknown' };
  return {
    update_id: u.update_id,
    message_id: m.message_id,
    date: m.date ? new Date(m.date * 1000).toISOString() : null,
    chat: { id: m.chat?.id, type: m.chat?.type, title: m.chat?.title || [m.chat?.first_name, m.chat?.last_name].filter(Boolean).join(' ') || m.chat?.username },
    from: m.from ? { id: m.from.id, name: [m.from.first_name, m.from.last_name].filter(Boolean).join(' '), username: m.from.username, is_bot: m.from.is_bot } : null,
    text: m.text || m.caption || `[${['photo', 'video', 'document', 'voice', 'sticker', 'audio'].find((k) => m[k]) || 'non-text content'}]`
  };
}

export function register({ server, z, getSettings, log, fetchJson }) {
  const call = async (method, payload) => {
    const { bot_token } = getSettings();
    const data = await fetchJson(API(bot_token, method), { method: 'POST', body: JSON.stringify(payload || {}) });
    if (!data.ok) throw new Error(`Telegram API: ${data.description || 'unknown error'}`);
    return data.result;
  };

  server.registerTool(
    'telegram_get_me',
    {
      title: 'Verify bot',
      description: `Check the configured bot token by fetching the bot's own profile.

Args: none.
Returns: bot id, name and @username.
Use when: verifying setup, or when other calls fail with auth errors.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async () => {
      const missing = needToken(getSettings());
      if (missing) return { content: [{ type: 'text', text: missing }] };
      try {
        const me = await call('getMe');
        return {
          content: [{ type: 'text', text: `Bot OK: ${me.first_name} (@${me.username}), id ${me.id}` }],
          structuredContent: me
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message} — check bot_token in Settings.` }] };
      }
    }
  );

  server.registerTool(
    'telegram_send_message',
    {
      title: 'Send message',
      description: `Send a text message from the bot to a chat.

Args:
  - text (string, required): message body. With parse_mode='Markdown', *bold*, _italic_, \`code\` work.
  - chat_id (string, optional): target chat/user/group id. Falls back to the default_chat_id setting.
  - parse_mode ('Markdown' | 'HTML' | 'none', default 'none')
  - disable_notification (boolean, default false): send silently.
Returns: sent message id + chat id.
Errors: "Error: no chat_id …" if neither chat_id nor default is set; "Error: Telegram API: chat not found" for bad ids (the user must have messaged the bot first).`,
      inputSchema: {
        text: z.string().min(1).max(4096).describe('Message text (Telegram limit: 4096 chars)'),
        chat_id: z.string().optional().describe('Chat id; omit to use default_chat_id from settings'),
        parse_mode: z.enum(['Markdown', 'HTML', 'none']).default('none').describe('Text formatting mode'),
        disable_notification: z.boolean().default(false).describe('Deliver silently')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ text, chat_id, parse_mode, disable_notification }) => {
      const settings = getSettings();
      const missing = needToken(settings);
      if (missing) return { content: [{ type: 'text', text: missing }] };
      const chat = resolveChat(settings, chat_id);
      if (chat.error) return { content: [{ type: 'text', text: chat.error }] };
      try {
        const payload = { chat_id: chat.id, text, disable_notification };
        if (parse_mode !== 'none') payload.parse_mode = parse_mode;
        const m = await call('sendMessage', payload);
        log(`sent message ${m.message_id} to chat ${chat.id}`);
        return {
          content: [{ type: 'text', text: `Sent (message_id ${m.message_id}) to chat ${chat.id}.` }],
          structuredContent: { message_id: m.message_id, chat_id: m.chat?.id }
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    'telegram_send_photo',
    {
      title: 'Send photo',
      description: `Send a photo (by public URL) from the bot to a chat.

Args:
  - photo_url (string, required): publicly reachable image URL (jpg/png/gif ≤ 5 MB via URL).
  - caption (string, optional, ≤ 1024 chars)
  - chat_id (string, optional): falls back to default_chat_id.
Returns: sent message id.`,
      inputSchema: {
        photo_url: z.string().url().describe('Public image URL'),
        caption: z.string().max(1024).optional().describe('Optional caption'),
        chat_id: z.string().optional().describe('Chat id; omit to use default_chat_id')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ photo_url, caption, chat_id }) => {
      const settings = getSettings();
      const missing = needToken(settings);
      if (missing) return { content: [{ type: 'text', text: missing }] };
      const chat = resolveChat(settings, chat_id);
      if (chat.error) return { content: [{ type: 'text', text: chat.error }] };
      try {
        const m = await call('sendPhoto', { chat_id: chat.id, photo: photo_url, ...(caption ? { caption } : {}) });
        return {
          content: [{ type: 'text', text: `Photo sent (message_id ${m.message_id}) to chat ${chat.id}.` }],
          structuredContent: { message_id: m.message_id, chat_id: m.chat?.id }
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message} — Telegram must be able to fetch the URL publicly.` }] };
      }
    }
  );

  server.registerTool(
    'telegram_get_updates',
    {
      title: 'Read recent messages',
      description: `Fetch recent updates (incoming messages) the bot has received. Also the way to discover chat IDs: message the bot, then call this.

Args:
  - limit (1-100, default 20)
  - offset (number, optional): update_id to start after (use last update_id + 1 to page).
Returns: list of { update_id, message_id, date, chat{id,type,title}, from{name,username}, text }.
Note: does NOT consume updates for a webhook-configured bot — if empty but messages were sent, the bot may have a webhook set (disable it) or updates are older than 24 h.`,
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20).describe('Max updates to return'),
        offset: z.number().int().optional().describe('Return updates with update_id greater than this')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ limit, offset }) => {
      const missing = needToken(getSettings());
      if (missing) return { content: [{ type: 'text', text: missing }] };
      try {
        const updates = await call('getUpdates', { limit, ...(offset != null ? { offset } : {}), timeout: 0 });
        const items = updates.map(summarizeUpdate);
        const text = items.length
          ? items.map((i) => `#${i.update_id} · ${i.date || '?'} · chat ${i.chat?.id} (${i.chat?.title || i.chat?.type}) · ${i.from?.name || '?'}${i.from?.username ? ` @${i.from.username}` : ''}: ${i.text}`).join('\n')
          : 'No pending updates. If you expected messages: make sure someone has messaged the bot recently, and that no webhook is set on it.';
        return { content: [{ type: 'text', text: text.slice(0, 25000) }], structuredContent: { count: items.length, updates: items } };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    'telegram_get_chat',
    {
      title: 'Get chat info',
      description: `Fetch details about a chat (user, group or channel) by id.

Args: chat_id (string, optional — falls back to default_chat_id).
Returns: id, type, title/name, username, description if present.`,
      inputSchema: {
        chat_id: z.string().optional().describe('Chat id; omit to use default_chat_id')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ chat_id }) => {
      const settings = getSettings();
      const missing = needToken(settings);
      if (missing) return { content: [{ type: 'text', text: missing }] };
      const chat = resolveChat(settings, chat_id);
      if (chat.error) return { content: [{ type: 'text', text: chat.error }] };
      try {
        const c = await call('getChat', { chat_id: chat.id });
        const name = c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id);
        return {
          content: [{ type: 'text', text: `Chat ${c.id} (${c.type}): ${name}${c.username ? ` @${c.username}` : ''}${c.description ? `\n${c.description}` : ''}` }],
          structuredContent: c
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );
}

export async function test(settings, { fetchJson }) {
  if (!settings.bot_token) return { ok: false, message: 'bot_token not set — paste the token from @BotFather in Settings.' };
  const data = await fetchJson(API(settings.bot_token, 'getMe'), { method: 'POST', body: '{}' });
  if (!data.ok) return { ok: false, message: `Telegram rejected the token: ${data.description || 'unknown error'}` };
  return { ok: true, message: `Connected as ${data.result.first_name} (@${data.result.username})${settings.default_chat_id ? `, default chat ${settings.default_chat_id}` : ' — tip: set default_chat_id so tools can omit chat_id'}` };
}
