// Unified LLM provider chokepoint (BYOK).
//
// One place the product talks to any LLM provider. Keys are passed PER CALL
// (vault-fed in the hosted platform) with an env-var fallback for local/CLI use.
// fetch-based — no provider SDKs — so every provider shares one code path.
//
// Providers: anthropic | kimi | openrouter | gemini
//
//   import { callLLM, resolveModel, validateKey } from './engine/llm/provider.mjs';
//   const out = await callLLM({ provider: 'anthropic', model: 'claude-sonnet-4-0',
//                               apiKey, system, prompt });
//   // out = { text, usage:{inputTokens,outputTokens}, model, stopReason }

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const KIMI_DEFAULT_BASE = 'https://api.moonshot.cn/v1';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const PROVIDERS = ['anthropic', 'kimi', 'openrouter', 'gemini'];

const ENV_KEY = {
  anthropic: 'ANTHROPIC_API_KEY',
  kimi: 'KIMI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

// User-facing aliases → { provider, model }. Bare/unknown flags fall through to
// resolveModel's heuristics. Model ids are stable aliases; override per call.
const MODEL_ALIASES = {
  claude: { provider: 'anthropic', model: 'claude-sonnet-4-0' },
  sonnet: { provider: 'anthropic', model: 'claude-sonnet-4-0' },
  opus: { provider: 'anthropic', model: 'claude-opus-4-1' },
  'claude-opus': { provider: 'anthropic', model: 'claude-opus-4-1' },
  haiku: { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
  'claude-haiku': { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
  kimi: { provider: 'kimi', model: 'moonshot-v1-128k' },
  gemini: { provider: 'gemini', model: 'gemini-2.0-flash' },
};

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

/** Map a model flag to { provider, model }. */
export function resolveModel(flag) {
  if (!flag) return { ...MODEL_ALIASES.claude };
  const f = String(flag).trim();
  if (MODEL_ALIASES[f]) return { ...MODEL_ALIASES[f] };
  if (f.startsWith('openrouter:')) return { provider: 'openrouter', model: f.slice('openrouter:'.length) };
  if (f.includes('/')) return { provider: 'openrouter', model: f }; // e.g. "anthropic/claude-sonnet-4"
  return { provider: 'anthropic', model: f }; // bare id → assume an Anthropic model
}

/** Resolve the key for a provider: explicit arg wins, else the env fallback. */
export function resolveKey(provider, apiKey) {
  return apiKey || process.env[ENV_KEY[provider]] || '';
}

// --- request builders (one per wire format) -------------------------------

function buildAnthropic({ model, key, system, messages, maxTokens, temperature }) {
  const body = { model, max_tokens: maxTokens, temperature, messages };
  if (system) body.system = system;
  return {
    url: ANTHROPIC_URL,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    },
  };
}

function buildOpenAICompat({ provider, model, key, system, messages, maxTokens, temperature, json, baseUrl }) {
  const url = provider === 'openrouter'
    ? OPENROUTER_URL
    : `${(baseUrl || process.env.KIMI_BASE_URL || KIMI_DEFAULT_BASE).replace(/\/$/, '')}/chat/completions`;
  const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const body = { model, messages: msgs, temperature, max_tokens: maxTokens };
  if (json) body.response_format = { type: 'json_object' };
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://hireloom.app';
    headers['X-Title'] = 'Hireloom';
  }
  return { url, init: { method: 'POST', headers, body: JSON.stringify(body) } };
}

function buildGemini({ model, key, system, messages, maxTokens, temperature, json }) {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const generationConfig = { temperature, maxOutputTokens: maxTokens };
  if (json) generationConfig.responseMimeType = 'application/json';
  const body = { contents, generationConfig };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  return {
    url: `${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  };
}

function buildRequest(args) {
  if (args.provider === 'anthropic') return buildAnthropic(args);
  if (args.provider === 'gemini') return buildGemini(args);
  return buildOpenAICompat(args); // kimi | openrouter
}

// --- response parsers -----------------------------------------------------

function parseResponse(provider, data) {
  if (provider === 'anthropic') {
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return {
      text,
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
      model: data.model || '',
      stopReason: data.stop_reason || '',
    };
  }
  if (provider === 'gemini') {
    const cand = (data.candidates || [])[0];
    const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
    return {
      text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      model: data.modelVersion || '',
      stopReason: cand?.finishReason || '',
    };
  }
  // openai-compatible (kimi | openrouter)
  const choice = (data.choices || [])[0];
  return {
    text: (choice?.message?.content || '').trim(),
    usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
    model: data.model || '',
    stopReason: choice?.finish_reason || '',
  };
}

// --- transport ------------------------------------------------------------

async function fetchWithRetry(doFetch, url, init, { timeoutMs, retries }) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { ...init, signal: ctrl.signal });
      if (res.ok) return res;
      if (!RETRYABLE.has(res.status) || attempt === retries) {
        const detail = await res.text().catch(() => '');
        throw new Error(`LLM HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
      }
    } catch (err) {
      lastErr = err;
      if (attempt === retries) throw err;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  throw lastErr || new Error('LLM request failed');
}

/**
 * Call any provider through one interface.
 * @param {object} o
 * @param {string} o.provider  anthropic|kimi|openrouter|gemini
 * @param {string} o.model     provider model id
 * @param {string} [o.apiKey]  per-call key (falls back to the provider env var)
 * @param {string} [o.system]  system prompt
 * @param {string} [o.prompt]  single user message (shorthand for messages)
 * @param {Array}  [o.messages] full [{role,content}] history (overrides prompt)
 * @returns {Promise<{text,usage:{inputTokens,outputTokens},model,stopReason}>}
 */
export async function callLLM({
  provider, model, apiKey,
  system = '', prompt, messages,
  maxTokens = 4096, temperature = 0.4, json = false,
  timeoutMs = 120_000, retries = 3, baseUrl, fetchImpl,
} = {}) {
  if (!provider) throw new Error('callLLM: provider is required');
  if (!PROVIDERS.includes(provider)) throw new Error(`callLLM: unknown provider "${provider}" (valid: ${PROVIDERS.join(', ')})`);
  if (!model) throw new Error('callLLM: model is required');
  const key = resolveKey(provider, apiKey);
  if (!key) throw new Error(`callLLM: no API key for ${provider} — pass apiKey or set ${ENV_KEY[provider]}`);
  const userMessages = messages || [{ role: 'user', content: prompt || '' }];
  const { url, init } = buildRequest({ provider, model, key, system, messages: userMessages, maxTokens, temperature, json, baseUrl });
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('callLLM: no fetch available (pass fetchImpl on older runtimes)');
  const res = await fetchWithRetry(doFetch, url, init, { timeoutMs, retries });
  return parseResponse(provider, await res.json());
}

/** Convenience: resolve a model flag and call in one step. */
export async function callModel(flag, opts = {}) {
  const { provider, model } = resolveModel(flag);
  return callLLM({ provider, model, ...opts });
}

/**
 * Cheap liveness/auth check for a BYO key. Sends a 1-token request.
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function validateKey({ provider, apiKey, model, fetchImpl, timeoutMs = 15_000 } = {}) {
  try {
    const resolved = model ? { provider, model } : resolveModel(provider === 'anthropic' ? 'claude' : provider);
    await callLLM({
      provider: provider || resolved.provider,
      model: model || resolved.model,
      apiKey,
      prompt: 'ping',
      maxTokens: 1,
      retries: 0,
      timeoutMs,
      fetchImpl,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
