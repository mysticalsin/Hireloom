import { invokeFn } from './invoke';
import type { Tailoring } from './db';

// Runs the `tailor` Edge Function: truthful CV + cover letter for a role, on the
// user's BYO key. Stored server-side; returns the package or an error.
export async function runTailor(roleId: string, provider = 'anthropic'): Promise<{ error?: string; content?: Tailoring }> {
  const r = await invokeFn<{ content?: Tailoring }>('tailor', { roleId, provider });
  if (r.error) return { error: r.code === 'quota_exceeded' ? 'Monthly package limit reached — upgrade to continue.' : r.error };
  return { content: r.data?.content };
}
