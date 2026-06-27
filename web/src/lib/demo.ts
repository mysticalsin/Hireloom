import { invokeFn } from './invoke';
import type { EvalSummary } from './evaluate';

interface DemoResult { disabled?: boolean; ok?: boolean; summary?: EvalSummary; markdown?: string; }

// Runs the `demo-eval` Edge Function: ONE sample A-G evaluation on the operator's key,
// for a signed-in user who has no BYO key yet. Returns the report markdown, a {disabled}
// flag when the operator hasn't funded the demo (UI hides the button), or a friendly error.
export async function runDemoEval(): Promise<{ disabled?: boolean; ok?: boolean; summary?: EvalSummary; markdown?: string; error?: string }> {
  const r = await invokeFn<DemoResult>('demo-eval', {});
  if (r.error) {
    if (r.code === 'rate_limited') return { error: "You're going a bit fast — wait a minute and try again." };
    if (r.code === 'demo_used') return { error: 'You’ve already used your free sample score. Add your key to score real roles.' };
    return { error: r.error };
  }
  return { disabled: r.data?.disabled, ok: r.data?.ok, summary: r.data?.summary, markdown: r.data?.markdown };
}
