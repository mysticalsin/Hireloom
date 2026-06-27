// Supabase Edge Function: validate a user's STORED BYO provider key by pinging the
// provider with a cheap, 1-token request. Never returns the key material. Hardened:
// require auth, read the key from Vault (scoped to the caller), origin-pinned CORS,
// sanitized errors.
//
// Deploy: supabase functions deploy validate-key
import { createClient } from 'npm:@supabase/supabase-js@2';
import { preflight, jsonResponse } from '../_shared/http.ts';
import { callProvider, defaultModel, clientLlmMessage, LLM_PROVIDERS } from '../_shared/llm.ts';

// Cheapest model per provider for a throwaway validation ping (falls back to default).
const CHEAP_MODEL: Record<string, string> = {
  anthropic: 'claude-3-5-haiku-latest',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  kimi: 'moonshot-v1-8k',
  openrouter: 'openai/gpt-4o-mini',
};

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405, origin);

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401, origin);

  // Per-user burst cap (cost/abuse control). Fixed window. Fail-open on transient DB errors.
  const { data: allowed, error: rlErr } = await supabase.rpc('check_rate_limit', { p_metric: 'validate-key', p_limit: 10, p_window_seconds: 60 });
  if (rlErr) console.error('[rate_limit] validate-key', rlErr); // fail-open: don't lock out users on a transient DB error
  if (allowed === false) return jsonResponse({ error: 'rate_limited' }, 429, origin);

  const { provider } = await req.json().catch(() => ({}));
  if (!provider || !LLM_PROVIDERS.includes(provider)) return jsonResponse({ error: 'unsupported provider' }, 400, origin);

  const { data: apiKey } = await supabase.rpc('get_provider_key', { p_provider: provider }); // decrypts from Vault, scoped to the caller
  if (!apiKey) return jsonResponse({ error: 'no_key' }, 400, origin);

  // Ping the provider with a cheap model + a 1-word prompt + maxTokens 1: a 200 means
  // the key authenticates. The key NEVER leaves the server — only {ok} comes back.
  try {
    await callProvider(provider, CHEAP_MODEL[provider] || defaultModel(provider), apiKey, '', 'ping', { maxTokens: 1 });
    return jsonResponse({ ok: true }, 200, origin);
  } catch (err) {
    console.error('[validate-key]', err instanceof Error ? err.message : err);
    return jsonResponse({ ok: false, error: clientLlmMessage(err, provider) }, 200, origin);
  }
});
