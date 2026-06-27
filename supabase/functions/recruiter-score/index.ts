// Supabase Edge Function: score the user's CV through a hiring-manager / recruiter
// SCREENING lens for ONE role — the inverse of evaluate (which scores the role for the
// user). Honest + anti-bias, on the user's BYO key. Free-capped 3/mo (like packages);
// Pro/Studio unlimited. Hardened (docs/AUDIT-REPORT.md P0): atomic quota, shared provider
// path (key in headers), origin-pinned CORS, sanitized errors.
//
// Deploy: supabase functions deploy recruiter-score
import { createClient } from 'npm:@supabase/supabase-js@2';
import { preflight, jsonResponse, errorResponse } from '../_shared/http.ts';
import { callProvider, defaultModel, clientLlmMessage, LLM_PROVIDERS } from '../_shared/llm.ts';

const PLAN_RS_CAP: Record<string, number> = { free: 3, pro: 2_147_483_647, studio: 2_147_483_647 };

const SYSTEM = (cv: string) => `You are an experienced hiring manager screening candidates for ONE role. Assess ONLY the candidate's CV against the job description — never infer protected attributes (age, gender, ethnicity, nationality, parental status, etc.) or proxies for them, and never weight them; judge strictly on demonstrated skills/experience/impact. Be honest and specific.

Screening rigor — reason like a disciplined recruiter, not a keyword matcher:
- Every "criteria" item must cite specific CV evidence — quote or paraphrase the exact CV line that satisfies it, or state plainly that the CV shows no evidence of it. Set "met" ("yes"|"partial"|"no") from that evidence, and put the cited line (or its absence) in "note". Make "criteria" the requirements that actually matter for THIS job description, marking "required":true for must-haves and false for nice-to-haves.
- Separate genuine, evidenced strengths from gaps. Strengths belong in the criteria you mark "met":"yes" with the supporting line; real shortfalls drive "gapsToClose" (each one actionable) and, where they signal risk, "redFlags".
- Strict but fair, evidence-based. Never credit keyword-stuffing, title inflation, or buzzwords unmatched by demonstrated work — credit a skill only where the CV evidences real application of it. Never reward vague or unverifiable claims, and when evidence is thin say so rather than guessing. Apply no protected-attribute weighting; "fairnessNote" states how you kept the assessment attribute-blind and evidence-based.
- "verdict" ("advance"|"borderline"|"reject") must follow from the balance of evidenced met-criteria against evidenced gaps — not from overall impression.
OUTPUT STRICT JSON ONLY (no markdown), matching exactly:
{"verdict":"advance"|"borderline"|"reject","headline":string,"sixSecondScan":string,"criteria":[{"name":string,"required":boolean,"met":"yes"|"partial"|"no","note":string}],"redFlags":[string],"gapsToClose":[string],"fairnessNote":string}

CANDIDATE CV (source of truth):
${cv}`;

function parseJson(text: string) {
  const t = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('model returned no JSON');
  return JSON.parse(t.slice(s, e + 1));
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405, origin);

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  // Service-role client for quota RPCs (locked to service_role in migration 0007).
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401, origin);

  // Per-user burst cap (cost/abuse control, beyond the monthly quota). Fixed window.
  const { data: allowed, error: rlErr } = await supabase.rpc('check_rate_limit', { p_metric: 'recruiter-score', p_limit: 20, p_window_seconds: 60 });
  if (rlErr) console.error('[rate_limit] recruiter-score', rlErr); // fail-open: don't lock out paying users on a transient DB error
  if (allowed === false) return jsonResponse({ error: 'rate_limited' }, 429, origin);

  const { roleId, provider = 'anthropic', model } = await req.json().catch(() => ({}));
  if (!roleId) return jsonResponse({ error: 'roleId required' }, 400, origin);
  if (!LLM_PROVIDERS.includes(provider)) return jsonResponse({ error: 'unsupported provider' }, 400, origin);

  const [{ data: role }, { data: sub }, { data: apiKey }, { data: profile }] = await Promise.all([
    supabase.from('roles').select('company,title,jd_text').eq('id', roleId).maybeSingle(),
    supabase.from('subscriptions').select('plan').maybeSingle(),
    supabase.rpc('get_provider_key', { p_provider: provider }),
    supabase.from('profiles').select('cv_md').maybeSingle(),
  ]);
  if (!role) return jsonResponse({ error: 'role not found' }, 404, origin);
  const plan = sub?.plan || 'free';
  if (!apiKey) return jsonResponse({ error: `No ${provider} API key saved. Add it in Settings.` }, 400, origin);
  if (!profile?.cv_md) return jsonResponse({ error: 'Add your CV in Settings before scoring.' }, 400, origin);

  // Atomic quota: reserve BEFORE spending on the LLM; refund on failure.
  const cap = PLAN_RS_CAP[plan] ?? 3;
  const { data: consumed, error: qErr } = await admin.rpc('consume_quota', { p_user_id: user.id, p_metric: 'recruiterScoresPerMonth', p_cap: cap });
  if (qErr) return errorResponse(500, 'Could not verify your monthly quota.', qErr, origin);
  if (consumed === -1) return jsonResponse({ error: 'quota_exceeded', plan }, 402, origin);

  try {
    const text = await callProvider(provider, model || defaultModel(provider), apiKey, SYSTEM(profile.cv_md),
      `JOB TITLE: ${role.title}\nCOMPANY: ${role.company}\n\n=== JOB DESCRIPTION ===\n${role.jd_text || ''}\n\nScore the candidate now. Return the scorecard JSON only.`, { json: true });
    const content = parseJson(text);
    if (!content.verdict || !Array.isArray(content.criteria)) throw new Error('recruiter scorecard malformed');
    const { error } = await supabase.from('recruiter_scores').upsert({ user_id: user.id, role_id: roleId, content, created_at: new Date().toISOString() }, { onConflict: 'user_id,role_id' });
    if (error) throw error;
    return jsonResponse({ ok: true, content }, 200, origin);
  } catch (err) {
    await admin.rpc('refund_quota', { p_user_id: user.id, p_metric: 'recruiterScoresPerMonth' }).catch(() => {});
    return errorResponse(502, clientLlmMessage(err, provider), err, origin);
  }
});
