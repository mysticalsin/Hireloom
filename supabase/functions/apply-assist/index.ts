// Supabase Edge Function: assisted apply — draft the common application free-text
// answers for a role, truthfully, on the user's BYO key. Human-in-the-loop: we draft,
// the user reviews and submits on the posting. Pro/Studio feature.
// Hardened (docs/AUDIT-REPORT.md P0): shared provider path (key in headers),
// origin-pinned CORS, sanitized errors.
//
// Deploy: supabase functions deploy apply-assist
import { createClient } from 'npm:@supabase/supabase-js@2';
import { preflight, jsonResponse, errorResponse } from '../_shared/http.ts';
import { callProvider, defaultModel, clientLlmMessage, LLM_PROVIDERS } from '../_shared/llm.ts';

const ASSISTED_APPLY_PLANS = new Set(['pro', 'studio']);

const SYSTEM = (cv: string) => `You draft application answers for a candidate, in FIRST PERSON, truthfully. Use ONLY facts from the CV — never invent experience, metrics, or skills. Warm, specific, concise (2-5 sentences each). Map to the job's real priorities; genuine hook to the company.
Cover these questions: "Why do you want to work here?", "Why are you a strong fit for this role?", "Describe a relevant accomplishment.", "What interests you about this position?".
OUTPUT STRICT JSON ONLY: {"answers":[{"question":string,"answer":string}]}

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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401, origin);

  // Per-user burst cap (cost/abuse control, beyond the monthly quota). Fixed window.
  const { data: allowed } = await supabase.rpc('check_rate_limit', { p_metric: 'apply-assist', p_limit: 20, p_window_seconds: 60 });
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
  if (!ASSISTED_APPLY_PLANS.has(sub?.plan || 'free')) return jsonResponse({ error: 'plan_required', upgradeTo: 'pro' }, 402, origin);
  if (!apiKey) return jsonResponse({ error: `No ${provider} API key saved. Add it in Settings.` }, 400, origin);
  if (!profile?.cv_md) return jsonResponse({ error: 'Add your CV in Settings first.' }, 400, origin);

  try {
    const text = await callProvider(provider, model || defaultModel(provider), apiKey, SYSTEM(profile.cv_md),
      `JOB TITLE: ${role.title}\nCOMPANY: ${role.company}\n\n=== JOB DESCRIPTION ===\n${role.jd_text || ''}\n\nReturn the answers JSON now.`, { json: true, maxTokens: 2048 });
    const content = parseJson(text);
    if (!Array.isArray(content.answers)) throw new Error('answers output malformed');
    const { error } = await supabase.from('apply_answers').upsert({ user_id: user.id, role_id: roleId, content, created_at: new Date().toISOString() }, { onConflict: 'user_id,role_id' });
    if (error) throw error;
    return jsonResponse({ ok: true, content }, 200, origin);
  } catch (err) {
    return errorResponse(502, clientLlmMessage(err, provider), err, origin);
  }
});
