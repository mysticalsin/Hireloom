import { invokeFn } from './invoke';
import type { ApplyAnswers } from './db';

// Runs the `apply-assist` Edge Function: draft application answers for a role
// (Pro/Studio feature). Human-in-the-loop — the user reviews and submits.
export async function runApplyAssist(roleId: string, provider = 'anthropic'): Promise<{ error?: string; upgrade?: boolean; content?: ApplyAnswers }> {
  const r = await invokeFn<{ content?: ApplyAnswers }>('apply-assist', { roleId, provider });
  if (r.error) {
    if (r.code === 'plan_required') return { error: 'Assisted apply is a Pro feature — upgrade to use it.', upgrade: true };
    return { error: r.error };
  }
  return { content: r.data?.content };
}
