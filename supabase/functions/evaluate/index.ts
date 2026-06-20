// Supabase Edge Function: evaluate a job posting on the user's BYO key, then
// persist the role + report so the dashboard reflects it. Self-contained (Deno):
// quota → fetch JD → provider call → parse → write → meter. Mirrors the Node engine.
//
// Deploy: supabase functions deploy evaluate
// (No extra secrets; uses the caller's JWT + their stored provider key.)
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });

const PLAN_EVAL_CAP: Record<string, number> = { free: 10, pro: Infinity, studio: Infinity };
const SUMMARY_RE = /---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/;

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

function dedupeKey(company: string, title: string) {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${n(company)}|${n(title)}`;
}
function parseSummary(text: string) {
  const out = { company: 'Unknown', role: 'Unknown', score: '', archetype: '', legitimacy: '' };
  const m = text.match(SUMMARY_RE); if (!m) return out;
  const pick = (k: string) => m[1].match(new RegExp(`${k}:\\s*(.+)`))?.[1].trim();
  return { company: pick('COMPANY') || out.company, role: pick('ROLE') || out.role, score: pick('SCORE') || '', archetype: pick('ARCHETYPE') || '', legitimacy: pick('LEGITIMACY') || '' };
}
function htmlToText(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n• ').replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
async function fetchJd(input: string): Promise<string> {
  if (!/^https?:\/\//i.test(input)) return input.trim();
  let m = input.match(/(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/);
  if (m) { const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}?content=true`); const j = await r.json(); return htmlToText(j.content || ''); }
  m = input.match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-fA-F-]{8,})/);
  if (m) { const r = await fetch(`https://api.lever.co/v0/postings/${m[1]}/${m[2]}`); const j = await r.json(); return j.descriptionPlain || htmlToText(j.description || ''); }
  const r = await fetch(input); return htmlToText(await r.text());
}

async function callProvider(provider: string, model: string, apiKey: string, system: string, prompt: string): Promise<string> {
  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 4096, system, messages: [{ role: 'user', content: prompt }] }) });
    if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json(); return (j.content || []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
  }
  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 4096 } }) });
    if (!r.ok) throw new Error(`gemini ${r.status}`);
    const j = await r.json(); return (j.candidates?.[0]?.content?.parts || []).map((p: { text: string }) => p.text).join('');
  }
  // openai-compatible (kimi | openrouter)
  const base = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : (Deno.env.get('KIMI_BASE_URL') || 'https://api.moonshot.cn/v1');
  const r = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }) });
  if (!r.ok) throw new Error(`${provider} ${r.status}`);
  const j = await r.json(); return j.choices?.[0]?.message?.content || '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { input, provider = 'anthropic', model } = await req.json().catch(() => ({}));
  if (!input) return json({ error: 'input (URL or JD text) required' }, 400);

  // Quota (Free = 10/mo)
  const period = new Date().toISOString().slice(0, 7);
  const [{ data: sub }, { data: usage }, { data: keyRow }, { data: profile }] = await Promise.all([
    supabase.from('subscriptions').select('plan').maybeSingle(),
    supabase.from('usage_counters').select('count').eq('period', period).eq('metric', 'evaluationsPerMonth').maybeSingle(),
    supabase.from('provider_keys').select('api_key').eq('provider', provider).maybeSingle(),
    supabase.from('profiles').select('cv_md').maybeSingle(),
  ]);
  const plan = sub?.plan || 'free';
  if ((usage?.count || 0) >= (PLAN_EVAL_CAP[plan] ?? 10)) return json({ error: 'quota_exceeded', plan }, 402);
  if (!keyRow?.api_key) return json({ error: `No ${provider} API key saved. Add it in Settings.` }, 400);

  const defaultModel = provider === 'anthropic' ? 'claude-sonnet-4-0' : provider === 'gemini' ? 'gemini-2.0-flash' : 'moonshot-v1-128k';
  try {
    const jd = await fetchJd(input);
    const text = await callProvider(provider, model || defaultModel, keyRow.api_key, SYSTEM(profile?.cv_md || ''), `\n\nJOB DESCRIPTION TO EVALUATE:\n\n${jd}`);
    const summary = parseSummary(text);
    const scoreNum = parseFloat(summary.score);
    const { data: role, error: roleErr } = await supabase.from('roles').upsert({
      user_id: user.id, dedupe_key: dedupeKey(summary.company, summary.role), company: summary.company, title: summary.role,
      status: 'Evaluated', score: Number.isFinite(scoreNum) ? scoreNum : null, url: /^https?:/i.test(input) ? input : null, source: 'url', jd_text: jd, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,dedupe_key' }).select('id').single();
    if (roleErr) throw new Error(roleErr.message);
    await supabase.from('reports').insert({ user_id: user.id, role_id: role.id, markdown: text.replace(SUMMARY_RE, '').trim(), score: Number.isFinite(scoreNum) ? scoreNum : null });
    await supabase.rpc('increment_usage', { p_metric: 'evaluationsPerMonth', p_n: 1 });
    return json({ ok: true, role_id: role.id, summary });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
