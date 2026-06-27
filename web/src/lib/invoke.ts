import { supabase } from './supabase';

// Invoke a Supabase Edge Function and surface its JSON error body. supabase-js
// throws a generic error on non-2xx (the body is hidden in error.context), so we
// parse it to recover { error } / a machine code like 'quota_exceeded'.
export async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<{ error?: string; code?: string; data?: T }> {
  if (!supabase) return { error: 'Not configured.' };
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let parsed: { error?: string } | null = null;
    try { parsed = await (error as { context?: Response }).context?.json?.() ?? null; } catch { /* no body */ }
    const code = parsed?.error;
    // A 429 is generic across every function — surface a friendly "slow down" centrally.
    const friendly = code === 'rate_limited' ? "You're going a bit fast — wait a minute and try again." : null;
    return { error: friendly || parsed?.error || error.message, code };
  }
  const d = data as { error?: string } | null;
  if (d?.error) return { error: d.error, code: d.error };
  return { data: data as T };
}
