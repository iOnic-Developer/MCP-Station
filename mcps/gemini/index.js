/**
 * Gemini MCP — Google Generative Language API (v1beta).
 * Settings: api_key (required), default_model (default gemini-2.5-flash).
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const CHARACTER_LIMIT = 25000;

function needKey(settings) {
  if (!settings.api_key) {
    return 'Error: api_key is not configured. Open MCP Station → Gemini → Settings and paste a key from aistudio.google.com/apikey.';
  }
  return null;
}

function extractText(data) {
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text && cand?.finishReason && cand.finishReason !== 'STOP') {
    return `[No text returned — finishReason: ${cand.finishReason}${cand.finishReason === 'SAFETY' ? ' (blocked by safety filters)' : ''}]`;
  }
  return text || '[Empty response]';
}

function truncate(text) {
  if (text.length <= CHARACTER_LIMIT) return text;
  return text.slice(0, CHARACTER_LIMIT) + `\n\n[Truncated at ${CHARACTER_LIMIT} chars — ask for a shorter response or lower max_output_tokens]`;
}

export function register({ server, z, getSettings, log, fetchJson }) {
  const generate = async ({ model, contents, system, temperature, max_output_tokens }) => {
    const { api_key, default_model } = getSettings();
    const m = model || default_model || 'gemini-2.5-flash';
    const body = {
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: {
        ...(temperature != null ? { temperature } : {}),
        ...(max_output_tokens != null ? { maxOutputTokens: max_output_tokens } : {})
      }
    };
    const data = await fetchJson(`${BASE}/models/${encodeURIComponent(m)}:generateContent?key=${api_key}`, {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 120_000
    });
    return { model: m, data };
  };

  const generateImageApiCall = async ({ prompt, quality, response_format }) => {
    const { api_key } = getSettings();
    const body = {
      prompt: { text: prompt },
      generationConfig: {
        ...(quality !== 'standard' ? { quality } : {}),
        ...(response_format !== 'url' ? { responseFormat: response_format } : {})
      }
    };
    // The image generation endpoint is different from content generation, but uses the same BASE and API key.
    const data = await fetchJson(`${BASE}/images:generate?key=${api_key}`, {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 120_000 // Image generation can take longer
    });
    return data;
  };

  server.registerTool(
    'gemini_generate_text',
    {
      title: 'Generate text',
      description: `Single-shot text generation with a Gemini model.

Args:
  - prompt (string, required)
  - model (string, optional): defaults to the default_model setting (gemini-2.5-flash). Use gemini_list_models to see options.
  - system (string, optional): system instruction.
  - temperature (0-2, optional)
  - max_output_tokens (1-65536, optional)
Returns: the generated text (+ usage metadata in structured content).
Errors: "Error: api_key is not configured…" | "Error: HTTP 400/403 …" (bad key or model name).`,
      inputSchema: {
        prompt: z.string().min(1).describe('The prompt to send'),
        model: z.string().optional().describe('Model id, e.g. gemini-2.5-pro; omit for default'),
        system: z.string().optional().describe('Optional system instruction'),
        temperature: z.number().min(0).max(2).optional().describe('Sampling temperature'),
        max_output_tokens: z.number().int().min(1).max(65536).optional().describe('Output token cap')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ prompt, model, system, temperature, max_output_tokens }) => {
      const missing = needKey(getSettings());
      if (missing) return { content: [{ type: 'text', text: missing }] };
      try {
        const { model: used, data } = await generate({ model, system, temperature, max_output_tokens, contents: [{ role: 'user', parts: [{ text: prompt }] }] });
        log(`generate_text via ${used}`);
        return {
          content: [{ type: 'text', text: truncate(extractText(data)) }],
          structuredContent: { model: used, usage: data.usageMetadata || null }
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    'gemini_chat',
    {
      title: 'Multi-turn chat',
      description: `Multi-turn conversation with a Gemini model. Pass the whole history each call.

Args:
  - messages (array, required): [{ role: 'user' | 'model', text: string }, …] — must end with a 'user' message.
  - model, system, temperature, max_output_tokens: as in gemini_generate_text.
Returns: the model's reply text.`,
      inputSchema: {
        messages: z.array(z.object({
          role: z.enum(['user', 'model']).describe("'user' or 'model'"),
          text: z.string().min(1).describe('Message text')
        })).min(1).describe('Conversation history, oldest first, ending with a user message'),
        model: z.string().optional().describe('Model id; omit for default'),
        system: z.string().optional().describe('Optional system instruction'),
        temperature: z.number().min(0).max(2).optional(),
        max_output_tokens: z.number().int().min(1).max(65536).optional()
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ messages, model, system, temperature, max_output_tokens }) => {
      const missing = needKey(getSettings());
      if (missing) return { content: [{ type: 'text', text: missing }] };
      if (messages[messages.length - 1].role !== 'user') {
        return { content: [{ type: 'text', text: "Error: the last message must have role 'user'." }] };
      }
      try {
        const contents = messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
        const { model: used, data } = await generate({ model, system, temperature, max_output_tokens, contents });
        return {
          content: [{ type: 'text', text: truncate(extractText(data)) }],
          structuredContent: { model: used, usage: data.usageMetadata || null }
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    'gemini_list_models',
    {
      title: 'List models',
      description: `List Gemini models available to the configured API key, with token limits and supported methods.

Args: page_size (1-100, default 50).
Returns: model names (use the part after 'models/' as the model arg elsewhere), display names, input/output token limits.`,
      inputSchema: {
        page_size: z.number().int().min(1).max(100).default(50).describe('How many models to list')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ page_size }) => {
      const settings = getSettings();
      const missing = needKey(settings);
      if (missing) return { content: [{ type: 'text', text: missing }] };
      try {
        const data = await fetchJson(`${BASE}/models?pageSize=${page_size}&key=${settings.api_key}`);
        const models = (data.models || []).map((m) => ({
          id: (m.name || '').replace(/^models\//, ''),
          displayName: m.displayName,
          inputTokenLimit: m.inputTokenLimit,
          outputTokenLimit: m.outputTokenLimit,
          methods: m.supportedGenerationMethods || []
        }));
        const text = models.map((m) => `- ${m.id} (${m.displayName}) · in ${m.inputTokenLimit} / out ${m.outputTokenLimit} · ${m.methods.join(', ')}`).join('\n') || 'No models returned.';
        return { content: [{ type: 'text', text: truncate(text) }], structuredContent: { count: models.length, models } };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    'gemini_embed_text',
    {
      title: 'Embed text',
      description: `Create an embedding vector for a piece of text (semantic search, similarity, clustering).

Args:
  - text (string, required, ≤ 10000 chars)
  - model (string, default 'text-embedding-004')
Returns: vector dimensionality + the values (structured content carries the full vector).`,
      inputSchema: {
        text: z.string().min(1).max(10000).describe('Text to embed'),
        model: z.string().default('text-embedding-004').describe('Embedding model id')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ text, model }) => {
      const settings = getSettings();
      const missing = needKey(settings);
      if (missing) return { content: [{ type: 'text', text: missing }] };
      try {
        const data = await fetchJson(`${BASE}/models/${encodeURIComponent(model)}:embedContent?key=${settings.api_key}`, {
          method: 'POST',
          body: JSON.stringify({ content: { parts: [{ text }] } })
        });
        const values = data.embedding?.values || [];
        return {
          content: [{ type: 'text', text: `Embedded with ${model}: ${values.length} dimensions. First 8: [${values.slice(0, 8).map((v) => v.toFixed(5)).join(', ')} …]` }],
          structuredContent: { model, dimensions: values.length, values }
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    'gemini_generate_image',
    {
      title: 'Generate image',
      description: `Generate an image from a text prompt using Gemini.

Args:
  - prompt (string, required): A detailed description of the image to generate.
  - quality ('standard' | 'hd', optional): Image quality. Default 'standard'.
  - response_format ('url' | 'b64_json', optional): Format for the generated image. Default 'url'.
    URLs are temporary and expire. Base64 data can be very large and will be truncated in text content.
Returns:
  - If response_format is 'url': A list of URLs to the generated images.
  - If response_format is 'b64_json': Base64 encoded image data (potentially truncated in text content, full data in structuredContent).
Errors: "Error: api_key is not configured…" | "Error: HTTP 400/403 …" (bad key or permissions).`,
      inputSchema: {
        prompt: z.string().min(1).describe('The text prompt for the image generation'),
        quality: z.enum(['standard', 'hd']).default('standard').describe('Image quality: "standard" or "hd"'),
        response_format: z.enum(['url', 'b64_json']).default('url').describe('Output format: "url" or "b64_json"')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ prompt, quality, response_format }) => {
      const missing = needKey(getSettings());
      if (missing) return { content: [{ type: 'text', text: missing }] };
      try {
        const data = await generateImageApiCall({ prompt, quality, response_format });
        const images = data?.images || [];

        if (images.length === 0) {
          return { content: [{ type: 'text', text: 'No images generated.' }] };
        }

        if (response_format === 'url') {
          const urls = images.map(img => img.url).filter(Boolean);
          if (urls.length > 0) {
            const text = `Generated images:\n${urls.map(url => `- ${url}`).join('\n')}`;
            return { content: [{ type: 'text', text: truncate(text) }], structuredContent: { images: urls } };
          } else {
            return { content: [{ type: 'text', text: 'No image URLs found in the response.' }] };
          }
        } else { // b64_json
          const base64Data = images.map(img => img.base64_data).filter(Boolean);
          if (base64Data.length > 0) {
            const firstB64 = base64Data[0];
            const text = `Generated image (base64, truncated to first ${CHARACTER_LIMIT} chars):\n${truncate(firstB64)}` + (base64Data.length > 1 ? `\n\nAnd ${base64Data.length - 1} more images (structuredContent has all base64 data).` : '');
            return { content: [{ type: 'text', text: text }], structuredContent: { images: base64Data } };
          } else {
            return { content: [{ type: 'text', text: 'No base64 image data found in the response.' }] };
          }
        }
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );
}

export async function test(settings, { fetchJson }) {
  if (!settings.api_key) return { ok: false, message: 'api_key not set — get one at aistudio.google.com/apikey.' };
  const data = await fetchJson(`${BASE}/models?pageSize=1&key=${settings.api_key}`);
  const n = (data.models || []).length;
  return { ok: true, message: `API key valid — models endpoint reachable (${n ? 'models listed' : 'no models visible'}). Default model: ${settings.default_model || 'gemini-2.5-flash'}.` };
}

