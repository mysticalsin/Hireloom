/**
 * apps/web/lib/llm-probe.mjs — "is this API key actually working?" probe.
 *
 * The seed of the A2 LLM transport: a cheap, token-free GET to each provider's
 * model-list endpoint that validates the key and reads the provider's real
 * response, so "Run diagnostics" can tell the user *what's wrong with their API
 * and how to fix it* in plain English — not a stack trace.
 *
 * fetchImpl is injectable so this is unit-testable without network.
 */

// provider → how to reach its model-list endpoint (token-free, validates auth).
export function probeEndpoint(provider, key, baseUrl) {
  switch (provider) {
    case 'anthropic': return { url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } };
    case 'openai':    return { url: 'https://api.openai.com/v1/models', headers: { Authorization: 'Bearer ' + key } };
    case 'nim':       return { url: (baseUrl || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '') + '/models', headers: { Authorization: 'Bearer ' + key } };
    case 'gemini':    return { url: 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key), headers: {} };
    default:          return null;
  }
}

// Map an HTTP status (or network failure) → a plain-English verdict.
export function classifyProbe(status) {
  if (status === 200) return { status: 'ok', message: 'Key valid — the provider responded.' };
  if (status === 401 || status === 403) return { status: 'invalid', message: 'Key rejected — double-check it in Settings → API Keys.' };
  if (status === 429) return { status: 'ratelimited', message: 'Rate-limited right now — the key is valid but throttled. Wait, or upgrade your tier.' };
  if (status === 404) return { status: 'error', message: 'Endpoint not found — check the base URL / model.' };
  return { status: 'error', message: 'Provider returned HTTP ' + status + '.' };
}

export async function probeProvider(provider, key, opts = {}) {
  const { fetchImpl = globalThis.fetch, timeoutMs = 7000, baseUrl } = opts;
  if (!key) return { status: 'unset', message: 'No key configured for this provider.' };
  const ep = probeEndpoint(provider, key, baseUrl);
  if (!ep) return { status: 'unknown', message: 'Unknown provider.' };
  if (typeof fetchImpl !== 'function') return { status: 'error', message: 'No fetch available in this runtime.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(ep.url, { method: 'GET', headers: ep.headers, signal: ctrl.signal });
    return classifyProbe(res.status);
  } catch (e) {
    if (e && e.name === 'AbortError') return { status: 'unreachable', message: 'Timed out reaching the provider — check your connection.' };
    return { status: 'unreachable', message: 'Could not reach the provider (' + (e && (e.code || e.message) || 'network error') + ').' };
  } finally {
    clearTimeout(timer);
  }
}
