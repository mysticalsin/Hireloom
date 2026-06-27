import { invokeFn } from './invoke';
import type { RecruiterScore } from './db';

// Runs the `recruiter-score` Edge Function: scores the user's CV through a hiring-manager
// screening lens for a role, on the user's BYO key. Free-capped (3/mo); Pro unlimited.
// Stored server-side; returns the scorecard or an error.
export async function runRecruiterScore(roleId: string, provider = 'anthropic'): Promise<{ error?: string; content?: RecruiterScore }> {
  const r = await invokeFn<{ content?: RecruiterScore }>('recruiter-score', { roleId, provider });
  if (r.error) return { error: r.code === 'quota_exceeded' ? 'Monthly scorecard limit reached — upgrade to continue.' : r.error };
  return { content: r.data?.content };
}
