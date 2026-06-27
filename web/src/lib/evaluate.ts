import { invokeFn } from './invoke';

export interface EvalSummary { company: string; role: string; score: string; archetype: string; legitimacy: string; }

// Runs the `evaluate` Edge Function: input (URL or JD text) → role + report in your
// dashboard, on your BYO key. Returns the parsed summary or an error string.
export async function runEvaluation(input: string, provider: string, model?: string): Promise<{ error?: string; summary?: EvalSummary }> {
  const r = await invokeFn<{ summary?: EvalSummary }>('evaluate', { input, provider, model });
  if (r.error) {
    if (r.code === 'quota_exceeded') return { error: 'Monthly limit reached — upgrade to continue.' };
    if (r.code === 'rate_limited') return { error: "You're going a bit fast — wait a minute and try again." };
    return { error: r.error };
  }
  return { summary: r.data?.summary };
}
