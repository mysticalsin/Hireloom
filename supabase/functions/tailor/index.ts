// Supabase Edge Function: tailor the user's CV + a cover letter to one role,
// truthfully, on their BYO key. Hardened (docs/AUDIT-REPORT.md P0): atomic quota,
// shared provider path (key in headers), origin-pinned CORS, sanitized errors.
//
// Deploy: supabase functions deploy tailor
import { createClient } from 'npm:@supabase/supabase-js@2';
import { preflight, jsonResponse, errorResponse } from '../_shared/http.ts';
import { callProvider, defaultModel, clientLlmMessage, LLM_PROVIDERS } from '../_shared/llm.ts';

const PLAN_PKG_CAP: Record<string, number> = { free: 3, pro: 2_147_483_647, studio: 2_147_483_647 };

const SYSTEM = (cv: string) => `You are an elite resume writer tailoring ONE candidate's resume to ONE job.
ABSOLUTE HONESTY: use ONLY facts, employers, titles, dates, locations, metrics, and tools that appear in the CV. Never invent or imply experience the CV lacks. No keyword-stuffing. Keep every employer, title, period (dates only), and location EXACTLY as in the CV; reshape only bullet wording/emphasis to mirror the JD's real priorities.
Also write a cover letter of EXACTLY 3 paragraphs (hook to the company's mission; 2-3 real achievements mapped to the JD; logistics/fit + close), same honesty rules.
OUTPUT STRICT JSON ONLY (no markdown), matching exactly:
{"title":string,"summary":string,"experience":[{"title":string,"period":string,"location":string,"bullets":[string]}],"competencies":string,"tools":string,"coverLetter":[string,string,string]}

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
  const { data: allowed, error: rlErr } = await supabase.rpc('check_rate_limit', { p_metric: 'tailor', p_limit: 20, p_window_seconds: 60 });
  if (rlErr) console.error('[rate_limit] tailor', rlErr); // fail-open: don't lock out paying users on a transient DB error
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
  if (!profile?.cv_md) return jsonResponse({ error: 'Add your CV in Settings before tailoring.' }, 400, origin);

  // Atomic quota: reserve BEFORE spending on the LLM; refund on failure.
  const cap = PLAN_PKG_CAP[plan] ?? 3;
  const { data: consumed, error: qErr } = await admin.rpc('consume_quota', { p_user_id: user.id, p_metric: 'packagesPerMonth', p_cap: cap });
  if (qErr) return errorResponse(500, 'Could not verify your monthly quota.', qErr, origin);
  if (consumed === -1) return jsonResponse({ error: 'quota_exceeded', plan }, 402, origin);

  try {
    const text = await callProvider(provider, model || defaultModel(provider), apiKey, SYSTEM(profile.cv_md),
      `JOB TITLE: ${role.title}\nCOMPANY: ${role.company}\n\n=== JOB DESCRIPTION ===\n${role.jd_text || ''}\n\nReturn the tailored JSON now.`, { json: true });
    const content = parseJson(text);
    if (!content.summary || !Array.isArray(content.experience)) throw new Error('tailored output malformed');
    const { error } = await supabase.from('tailorings').upsert({ user_id: user.id, role_id: roleId, content, created_at: new Date().toISOString() }, { onConflict: 'user_id,role_id' });
    if (error) throw error;
    return jsonResponse({ ok: true, content }, 200, origin);
  } catch (err) {
    await admin.rpc('refund_quota', { p_user_id: user.id, p_metric: 'packagesPerMonth' }).catch(() => {});
    return errorResponse(502, clientLlmMessage(err, provider), err, origin);
  }
});
