// Supabase Edge Function: keyless "try a sample score" demo. Lets a signed-in user who
// has NOT added a BYO key yet feel ONE real A-G evaluation before the BYOK wall, run on
// the OPERATOR's key (never the user's). Operator-opt-in (DEMO_API_KEY) + hard-capped:
// one per user (profiles.demo_used) + a per-user burst rate limit. The feature is OFF
// (UI hides the button) and costs nothing unless the operator funds it via DEMO_API_KEY.
//
// Deploy: supabase functions deploy demo-eval
import { createClient } from 'npm:@supabase/supabase-js@2';
import { preflight, jsonResponse, errorResponse } from '../_shared/http.ts';
import { callProvider, defaultModel, clientLlmMessage, LLM_PROVIDERS } from '../_shared/llm.ts';

const SUMMARY_RE = /---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/;

// Same A-G prompt as evaluate/index.ts (kept self-contained per the per-function idiom).
const SYSTEM = (cv: string) => `You are Hireloom, an AI job-search assistant. Evaluate the job below against the candidate's CV with a structured A-G analysis (role summary, CV match, level & strategy, comp & demand [estimate from training data], personalization plan, interview plan, posting legitimacy). Be honest; never invent experience.

CANDIDATE CV:
${cv || '(no CV provided — note this in the analysis)'}

End with EXACTLY:
---SCORE_SUMMARY---
COMPANY: <name or Unknown>
ROLE: <title>
SCORE: <0-5 decimal>
ARCHETYPE: <detected>
LEGITIMACY: <High Confidence | Proceed with Caution | Suspicious>
---END_SUMMARY---`;

function parseSummary(text: string) {
  const out = { company: 'Unknown', role: 'Unknown', score: '', archetype: '', legitimacy: '' };
  const m = text.match(SUMMARY_RE); if (!m) return out;
  const pick = (k: string) => m[1].match(new RegExp(`${k}:\\s*(.+)`))?.[1].trim();
  return { company: pick('COMPANY') || out.company, role: pick('ROLE') || out.role, score: pick('SCORE') || '', archetype: pick('ARCHETYPE') || '', legitimacy: pick('LEGITIMACY') || '' };
}

// A short, neutral CV used only when the signed-in user has not saved one yet — so the
// demo still produces a coherent A-G report. It does not represent a real person.
const SAMPLE_CV = `# Alex Carter
Product manager, 6 years, B2B SaaS.

## Experience
### Senior Product Manager — Northwind Software (2021–present)
- Owned the billing + onboarding surface for a 40k-seat B2B platform.
- Shipped a usage-based pricing migration; cut involuntary churn 18%.
- Led a 3-squad discovery program; defined the roadmap with eng + design.

### Product Manager — Mapleworks (2018–2021)
- Took an internal analytics tool to a paid external product (first $1M ARR).
- Ran weekly experiments; lifted activation 22% over four quarters.

## Skills
Discovery, roadmapping, pricing, SQL, experimentation, stakeholder management.`;

// A realistic, hardcoded JD so the demo is one fixed, predictable evaluation.
const SAMPLE_JD = `Senior Product Manager, B2B SaaS — Atlas Cloud (Remote, US/EU)

About the role:
We're hiring a Senior Product Manager to own our core workspace platform — the surface our 50,000+ business customers use every day. You'll set strategy, run discovery, and ship outcomes with a dedicated squad of engineers and designers.

Responsibilities:
- Own the product roadmap for the workspace platform end to end.
- Lead continuous discovery with customers and translate insight into a prioritized backlog.
- Partner with engineering and design to ship and measure outcomes, not output.
- Define and track success metrics (activation, retention, expansion).
- Drive pricing and packaging experiments with the growth team.

Requirements:
- 5+ years in product management, including B2B SaaS at scale.
- A track record of shipping platform or core-workflow products.
- Strong analytical skills; comfortable with SQL and experimentation.
- Excellent written communication and stakeholder management.

Compensation: $180,000-$220,000 base + equity + benefits.`;

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405, origin);

  // Operator-opt-in: with no operator-funded key the feature is OFF. The UI hides the
  // button on this response — nothing is spent and no user state changes. NEVER returned.
  const demoKey = Deno.env.get('DEMO_API_KEY');
  if (!demoKey) return jsonResponse({ disabled: true }, 200, origin);

  const provider = Deno.env.get('DEMO_PROVIDER') || 'anthropic';
  if (!LLM_PROVIDERS.includes(provider)) return jsonResponse({ error: 'unsupported provider' }, 400, origin);
  const model = Deno.env.get('DEMO_MODEL') || defaultModel(provider);

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  // Service-role client to set profiles.demo_used so the one-per-user flag can't be
  // bypassed by a client that withholds the write. Scoped to the verified user.id below.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401, origin);

  // Per-user burst cap (cost/abuse control). Fixed window. Fail-open like the others.
  const { data: allowed, error: rlErr } = await supabase.rpc('check_rate_limit', { p_metric: 'demo-eval', p_limit: 3, p_window_seconds: 60 });
  if (rlErr) console.error('[rate_limit] demo-eval', rlErr); // fail-open: don't lock out on a transient DB error
  if (allowed === false) return jsonResponse({ error: 'rate_limited' }, 429, origin);

  // One free sample per user, ever. Read the caller-scoped flag (RLS) + reuse their CV if any.
  const { data: profile } = await supabase.from('profiles').select('cv_md, demo_used').maybeSingle();
  if (profile?.demo_used === true) return jsonResponse({ error: 'demo_used' }, 403, origin);

  try {
    // Operator key only — the user's BYO key is NEVER used for the demo. JD is fixed.
    const text = await callProvider(provider, model, demoKey, SYSTEM(profile?.cv_md || SAMPLE_CV), `\n\nJOB DESCRIPTION TO EVALUATE:\n\n${SAMPLE_JD}`);
    const summary = parseSummary(text);
    // Burn the one-per-user slot via the service role so it survives RLS + can't be skipped.
    const { error: flagErr } = await admin.from('profiles').update({ demo_used: true, updated_at: new Date().toISOString() }).eq('id', user.id);
    if (flagErr) console.error('[demo-eval] set demo_used', flagErr); // non-fatal: a completed result still returns
    // No monthly quota is consumed — this runs on the operator's key, not the user's.
    return jsonResponse({ ok: true, summary, markdown: text.replace(SUMMARY_RE, '').trim() }, 200, origin);
  } catch (err) {
    return errorResponse(502, clientLlmMessage(err, provider), err, origin);
  }
});
