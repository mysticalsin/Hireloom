import { supabase } from './supabase';

export interface EvalSummary { company: string; role: string; score: string; archetype: string; legitimacy: string; }

// Runs the `evaluate` Edge Function: input (URL or JD text) → role + report in your
// dashboard, on your BYO key. Returns the parsed summary or an error string.
export async function runEvaluation(input: string, provider: string, model?: string): Promise<{ error?: string; summary?: EvalSummary }> {
  if (!supabase) return { error: 'Not configured.' };
  const { data, error } = await supabase.functions.invoke('evaluate', { body: { input, provider, model } });
  if (error) return { error: error.message };
  const d = data as { error?: string; summary?: EvalSummary } | null;
  if (d?.error) return { error: d.error === 'quota_exceeded' ? 'Monthly limit reached — upgrade to continue.' : d.error };
  return { summary: d?.summary };
}
