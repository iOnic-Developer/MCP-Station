/**
 * Gemini MCP — Google Generative Language API (v1beta).
 * Settings: api_key (required), default_model (default gemini-2.5-flash),
 *           default_image_model (default gemini-3.1-flash-image — "Nano Banana 2").
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const CHARACTER_LIMIT = 25000;
const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image'; // latest native Gemini image ("Nano Banana 2")

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

  // Native Gemini image generation: a generateContent call against an image-capable Gemini model
  // (gemini-3.1-flash-image "Nano Banana 2" by default; gemini-3-pro-image "Nano Banana Pro" for
  // higher fidelity). The image returns as an inlineData part. Aspect ratio is set via
  // generationConfig.imageConfig.aspectRatio — verified live against the v1beta API.
  // NOT Imagen: Imagen models use a different :predict endpoint and are a separate model line.
  const generateImageApiCall = async ({ prompt, model, aspect_ratio }) => {
    const { api_key, default_image_model } = getSettings();
    const m = model || default_image_model || DEFAULT_IMAGE_MODEL;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        ...(aspect_ratio ? { imageConfig: { aspectRatio: aspect_ratio } } : {})
      }
    };
    const data = await fetchJson(`${BASE}/models/${encodeURIComponent(m)}:generateContent?key=${api_key}`, {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 120_000 // image generation can take longer
    });
    const cand = data?.candidates?.[0];
    const part = (cand?.content?.parts || []).find((p) => p.inlineData);
    if (part) return { model: m, data: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
    // No image → surface why (safety block, text-only refusal, etc.) instead of a bare null.
    const why = cand?.finishReason && cand.finishReason !== 'STOP' ? cand.finishReason
      : (cand?.content?.parts || []).map((p) => p.text).filter(Boolean).join(' ').slice(0, 200) || 'no image in response';
    return { model: m, data: null, reason: why };
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

  const IMAGE_ARGS = {
    prompt: z.string().min(1).describe('A detailed description of the image to generate'),
    aspect_ratio: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']).default('1:1').describe('Aspect ratio of the image'),
    model: z.string().optional().describe(`Image model id — default ${DEFAULT_IMAGE_MODEL} (Nano Banana 2). Use gemini-3-pro-image (Nano Banana Pro) for higher fidelity.`)
  };

  server.registerTool(
    'gemini_generate_image',
    {
      title: 'Generate image (native)',
      description: `Generate an image from a text prompt with the latest native Gemini image model and return it as an MCP image block (rendered inline by the client).

Args:
  - prompt (string, required): a detailed description of the image.
  - aspect_ratio (optional): '1:1' | '3:4' | '4:3' | '9:16' | '16:9' (default '1:1').
  - model (optional): default ${DEFAULT_IMAGE_MODEL} (Nano Banana 2); gemini-3-pro-image for higher fidelity.
Returns: the image as MCP image content (base64). Errors: "Error: api_key is not configured…" | "Error: HTTP 400/403 …".`,
      inputSchema: IMAGE_ARGS,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ prompt, aspect_ratio, model }) => {
      const missing = needKey(getSettings());
      if (missing) return { content: [{ type: 'text', text: missing }] };
      try {
        const img = await generateImageApiCall({ prompt, model, aspect_ratio });
        log(`generate_image via ${img.model}`);
        if (!img.data) return { content: [{ type: 'text', text: `No image was generated (${img.reason}).` }] };
        return { content: [{ type: 'image', data: img.data, mimeType: img.mimeType }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    'gemini_generate_image_base64',
    {
      title: 'Generate image (base64 data URI)',
      description: `Same as gemini_generate_image but returns a base64 data URI as text — use when the client can't render native MCP image blocks but can show a markdown/HTML data URI. Same args (prompt, aspect_ratio, model).`,
      inputSchema: IMAGE_ARGS,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ prompt, aspect_ratio, model }) => {
      const missing = needKey(getSettings());
      if (missing) return { content: [{ type: 'text', text: missing }] };
      try {
        const img = await generateImageApiCall({ prompt, model, aspect_ratio });
        if (!img.data) return { content: [{ type: 'text', text: `No image was generated (${img.reason}).` }] };
        const dataUri = `data:${img.mimeType};base64,${img.data}`;
        return {
          content: [{ type: 'text', text: `Image generated with ${img.model}.\n\nMarkdown:\n![Generated image](${dataUri})\n\nData URI:\n${dataUri}` }],
          structuredContent: { model: img.model, mimeType: img.mimeType, base64: img.data, dataUri }
        };
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

