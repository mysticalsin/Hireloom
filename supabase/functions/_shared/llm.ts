// Centralized BYOK provider call for edge functions. Mirrors engine/llm/provider.mjs.
// The key ALWAYS travels in a header, never the URL query string (URLs leak to logs).
// Native providers: anthropic | openai | kimi | openrouter | gemini.

// deno-lint-ignore no-explicit-any
type Any = any;

const KIMI_DEFAULT_BASE = 'https://api.moonshot.cn/v1';
const OPENAI_BASE = 'https://api.openai.com/v1';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const LLM_PROVIDERS = ['anthropic', 'openai', 'kimi', 'openrouter', 'gemini'];
const MODEL_RE = /^[A-Za-z0-9._:\/-]+$/; // reject control chars / path traversal in user-supplied model

export function defaultModel(provider: string): string {
  switch (provider) {
    case 'anthropic': return 'claude-sonnet-4-0';
    case 'openai': return 'gpt-4o';
    case 'gemini': return 'gemini-2.0-flash';
    case 'openrouter': return 'anthropic/claude-sonnet-4';
    default: return 'moonshot-v1-128k'; // kimi
  }
}

export interface LlmOpts { json?: boolean; maxTokens?: number; timeoutMs?: number }

// Thrown errors are intentionally terse codes — the caller logs + maps them, so no
// provider response body ever reaches the client.
export class ProviderError extends Error {
  constructor(public provider: string, public status: number) {
    super(`provider_error:${provider}:${status}`);
  }
}

async function drain(r: Response) { try { await r.body?.cancel(); } catch { /* ignore */ } }

export async function callProvider(
  provider: string,
  model: string,
  apiKey: string,
  system: string,
  prompt: string,
  opts: LlmOpts = {},
): Promise<string> {
  if (!LLM_PROVIDERS.includes(provider)) throw new Error(`unsupported_provider:${provider}`);
  if (!model || !MODEL_RE.test(model)) throw new Error('invalid_model');
  const maxTokens = opts.maxTokens ?? 4096;
  const wantJson = opts.json ?? false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 110_000);
  try {
    if (provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!r.ok) { const s = r.status; await drain(r); throw new ProviderError('anthropic', s); }
      const j = await r.json();
      return (j.content || []).filter((b: Any) => b.type === 'text').map((b: Any) => b.text).join('');
    }
    if (provider === 'gemini') {
      const generationConfig: Any = { maxOutputTokens: maxTokens };
      if (wantJson) generationConfig.responseMimeType = 'application/json';
      const r = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, // key in header, not URL
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig,
        }),
      });
      if (!r.ok) { const s = r.status; await drain(r); throw new ProviderError('gemini', s); }
      const j = await r.json();
      return (j.candidates?.[0]?.content?.parts || []).map((p: Any) => p.text || '').join('');
    }
    // openai-compatible: openai | openrouter | kimi
    const base = provider === 'openai' ? OPENAI_BASE
      : provider === 'openrouter' ? OPENROUTER_BASE
      : (Deno.env.get('KIMI_BASE_URL') || KIMI_DEFAULT_BASE);
    const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
    if (provider === 'openrouter') { headers['HTTP-Referer'] = 'https://hireloom.app'; headers['X-Title'] = 'Hireloom'; }
    const body: Any = { model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] };
    if (wantJson) body.response_format = { type: 'json_object' };
    const r = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, { method: 'POST', signal: ctrl.signal, headers, body: JSON.stringify(body) });
    if (!r.ok) { const s = r.status; await drain(r); throw new ProviderError(provider, s); }
    const j = await r.json();
    return j.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

// Map a thrown error to a SAFE, user-actionable client message (no provider internals).
export function clientLlmMessage(err: unknown, provider: string): string {
  if (err instanceof ProviderError) {
    if (err.status === 401 || err.status === 403) return `Your ${provider} API key was rejected. Check it in Settings.`;
    if (err.status === 429) return `Your ${provider} account is rate-limited. Try again shortly.`;
    return `The ${provider} request failed. Try again.`;
  }
  if (err instanceof Error && err.name === 'AbortError') return 'The AI request timed out. Try again.';
  return 'Could not complete the AI request.';
}
