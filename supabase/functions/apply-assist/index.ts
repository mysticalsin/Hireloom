// Supabase Edge Function: assisted apply — draft the common application free-text
// answers for a role, truthfully, on the user's BYO key. Human-in-the-loop: we
// draft, the user reviews and submits on the posting. Pro/Studio feature.
//
// Deploy: supabase functions deploy apply-assist
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });

const ASSISTED_APPLY_PLANS = new Set(['pro', 'studio']);

const SYSTEM = (cv: string) => `You draft application answers for a candidate, in FIRST PERSON, truthfully. Use ONLY facts from the CV — never invent experience, metrics, or skills. Warm, specific, concise (2-5 sentences each). Map to the job's real priorities; genuine hook to the company.
Cover these questions: "Why do you want to work here?", "Why are you a strong fit for this role?", "Describe a relevant accomplishment.", "What interests you about this position?".
OUTPUT STRICT JSON ONLY: {"answers":[{"question":string,"answer":string}]}

CANDIDATE CV (source of truth):
${cv}`;

async function callProvider(provider: string, model: string, apiKey: string, system: string, prompt: string): Promise<string> {
  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 2048, system, messages: [{ role: 'user', content: prompt }] }) });
    if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json(); return (j.content || []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
  }
  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 2048, responseMimeType: 'application/json' } }) });
    if (!r.ok) throw new Error(`gemini ${r.status}`);
    const j = await r.json(); return (j.candidates?.[0]?.content?.parts || []).map((p: { text: string }) => p.text).join('');
  }
  const base = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : (Deno.env.get('KIMI_BASE_URL') || 'https://api.moonshot.cn/v1');
  const r = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, max_tokens: 2048, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], response_format: { type: 'json_object' } }) });
  if (!r.ok) throw new Error(`${provider} ${r.status}`);
  const j = await r.json(); return j.choices?.[0]?.message?.content || '';
}
function parseJson(text: string) {
  const t = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('model returned no JSON');
  return JSON.parse(t.slice(s, e + 1));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { roleId, provider = 'anthropic', model } = await req.json().catch(() => ({}));
  if (!roleId) return json({ error: 'roleId required' }, 400);

  const [{ data: role }, { data: sub }, { data: apiKey }, { data: profile }] = await Promise.all([
    supabase.from('roles').select('company,title,jd_text').eq('id', roleId).maybeSingle(),
    supabase.from('subscriptions').select('plan').maybeSingle(),
    supabase.rpc('get_provider_key', { p_provider: provider }),
    supabase.from('profiles').select('cv_md').maybeSingle(),
  ]);
  if (!role) return json({ error: 'role not found' }, 404);
  if (!ASSISTED_APPLY_PLANS.has(sub?.plan || 'free')) return json({ error: 'plan_required', upgradeTo: 'pro' }, 402);
  if (!apiKey) return json({ error: `No ${provider} API key saved. Add it in Settings.` }, 400);
  if (!profile?.cv_md) return json({ error: 'Add your CV in Settings first.' }, 400);

  const defaultModel = provider === 'anthropic' ? 'claude-sonnet-4-0' : provider === 'gemini' ? 'gemini-2.0-flash' : 'moonshot-v1-128k';
  try {
    const text = await callProvider(provider, model || defaultModel, apiKey, SYSTEM(profile.cv_md), `JOB TITLE: ${role.title}\nCOMPANY: ${role.company}\n\n=== JOB DESCRIPTION ===\n${role.jd_text || ''}\n\nReturn the answers JSON now.`);
    const content = parseJson(text);
    if (!Array.isArray(content.answers)) throw new Error('answers output malformed');
    const { error } = await supabase.from('apply_answers').upsert({ user_id: user.id, role_id: roleId, content, created_at: new Date().toISOString() }, { onConflict: 'user_id,role_id' });
    if (error) throw new Error(error.message);
    return json({ ok: true, content });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
