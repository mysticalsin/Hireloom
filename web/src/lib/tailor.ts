import { supabase } from './supabase';
import type { Tailoring } from './db';

// Runs the `tailor` Edge Function: truthful CV + cover letter for a role, on the
// user's BYO key. Stored server-side; returns the package or an error.
export async function runTailor(roleId: string, provider = 'anthropic'): Promise<{ error?: string; content?: Tailoring }> {
  if (!supabase) return { error: 'Not configured.' };
  const { data, error } = await supabase.functions.invoke('tailor', { body: { roleId, provider } });
  if (error) return { error: error.message };
  const d = data as { error?: string; content?: Tailoring } | null;
  if (d?.error) return { error: d.error === 'quota_exceeded' ? 'Monthly package limit reached — upgrade to continue.' : d.error };
  return { content: d?.content };
}
