// Supabase Edge Function: evaluate a job posting on the user's BYO key, then
// persist the role + report. Self-contained (Deno). Hardened (docs/AUDIT-REPORT.md P0):
// SSRF-safe JD fetch, atomic quota (reserve→refund), shared provider path (key in headers),
// origin-pinned CORS, sanitized errors.
//
// Deploy: supabase functions deploy evaluate
import { createClient } from 'npm:@supabase/supabase-js@2';
import { preflight, jsonResponse, errorResponse } from '../_shared/http.ts';
import { callProvider, defaultModel, clientLlmMessage, LLM_PROVIDERS } from '../_shared/llm.ts';
import { safeFetchText } from '../_shared/safe-fetch.ts';

const PLAN_EVAL_CAP: Record<string, number> = { free: 10, pro: 2_147_483_647, studio: 2_147_483_647 };
const SUMMARY_RE = /---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/;

const SYSTEM = (cv: string) => `You are Hireloom, an AI job-search assistant. Evaluate the job below against the candidate's CV with a structured A-G analysis (role summary, CV match, level & strategy, comp & demand [estimate from training data], personalization plan, interview plan, posting legitimacy). Be honest; never invent experience.

Scoring rigor — reason like a disciplined hiring panel, not a keyword matcher:
- Score across these explicit dimensions, naming each as you go: (1) skills match — required vs. demonstrated capabilities; (2) seniority / level fit — scope, ownership, and autonomy vs. what the role demands; (3) domain / industry fit — relevant sector, product, and problem-space experience; (4) impact / evidence — quantified outcomes the CV actually shows; (5) trajectory — direction and velocity of the candidate's career toward this role.
- Track positives and gaps SEPARATELY. List the candidate's genuine strengths (bonuses) in one set and the gaps/risks (deductions) in another. Attach exactly one concrete piece of EVIDENCE to every point — quote or cite the specific CV line or JD requirement it rests on (e.g. "CV: 'cut involuntary churn 18%'" or "JD requires 'SQL and experimentation'; CV shows neither"). A claim without cited evidence does not belong in the analysis.
- Strict but fair. Never reward keyword-stuffing, title inflation, or buzzwords unmatched by demonstrated work — credit a skill only where the CV evidences real application of it. Never reward unverifiable or vague claims. Equally, never penalize protected attributes (age, gender, ethnicity, nationality, parental status, etc.) or proxies for them, and never infer them; judge strictly on demonstrated skills, experience, and impact. When evidence is thin, say so plainly rather than guessing high or low.
- The 0-5 SCORE must follow from this dimensional reasoning and the balance of evidenced bonuses against evidenced deductions — not from overall vibe.

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

// Pasted text → returned as-is. Greenhouse/Lever → sanctioned APIs (fixed hosts, safe).
// Any other URL → SSRF-safe fetch (https only, no private IPs, manual redirects, capped).
async function fetchJd(input: string): Promise<string> {
  if (!/^https?:\/\//i.test(input)) return input.trim();
  let m = input.match(/(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/);
  if (m) { const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}?content=true`); const j = await r.json(); return htmlToText(j.content || ''); }
  m = input.match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-fA-F-]{8,})/);
  if (m) { const r = await fetch(`https://api.lever.co/v0/postings/${m[1]}/${m[2]}`); const j = await r.json(); return j.descriptionPlain || htmlToText(j.description || ''); }
  return htmlToText(await safeFetchText(input));
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405, origin);

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  // Service-role client for quota RPCs. Migration 0007 locks consume_quota/refund_quota to
  // service_role only, so a user JWT can no longer call refund_quota directly to reset its
  // own counter. We verify the JWT below, then pass the verified user.id explicitly.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401, origin);

  // Per-user burst cap (cost/abuse control, beyond the monthly quota). Fixed window.
  const { data: allowed, error: rlErr } = await supabase.rpc('check_rate_limit', { p_metric: 'evaluate', p_limit: 20, p_window_seconds: 60 });
  if (rlErr) console.error('[rate_limit] evaluate', rlErr); // fail-open: don't lock out paying users on a transient DB error
  if (allowed === false) return jsonResponse({ error: 'rate_limited' }, 429, origin);

  const { input, provider = 'anthropic', model } = await req.json().catch(() => ({}));
  if (!input || typeof input !== 'string') return jsonResponse({ error: 'input (URL or JD text) required' }, 400, origin);
  if (!LLM_PROVIDERS.includes(provider)) return jsonResponse({ error: 'unsupported provider' }, 400, origin);

  const [{ data: sub }, { data: apiKey }, { data: profile }] = await Promise.all([
    supabase.from('subscriptions').select('plan').maybeSingle(),
    supabase.rpc('get_provider_key', { p_provider: provider }), // decrypts from Vault, scoped to the caller
    supabase.from('profiles').select('cv_md').maybeSingle(),
  ]);
  const plan = sub?.plan || 'free';
  if (!apiKey) return jsonResponse({ error: `No ${provider} API key saved. Add it in Settings.` }, 400, origin);

  // Fetch the JD first — a bad/blocked URL is a 400 and must NOT consume quota.
  let jd: string;
  try {
    jd = await fetchJd(input);
  } catch (err) {
    return errorResponse(400, 'That URL could not be fetched safely. Paste the job description text instead.', err, origin);
  }
  if (!jd || jd.length < 30) return jsonResponse({ error: 'Could not extract a job description. Paste the text instead.' }, 400, origin);

  // Atomic quota: reserve a slot BEFORE spending on the LLM; refund if the call fails.
  const cap = PLAN_EVAL_CAP[plan] ?? 10;
  const { data: consumed, error: qErr } = await admin.rpc('consume_quota', { p_user_id: user.id, p_metric: 'evaluationsPerMonth', p_cap: cap });
  if (qErr) return errorResponse(500, 'Could not verify your monthly quota.', qErr, origin);
  if (consumed === -1) return jsonResponse({ error: 'quota_exceeded', plan }, 402, origin);

  try {
    const text = await callProvider(provider, model || defaultModel(provider), apiKey, SYSTEM(profile?.cv_md || ''), `\n\nJOB DESCRIPTION TO EVALUATE:\n\n${jd}`);
    const summary = parseSummary(text);
    const scoreNum = parseFloat(summary.score);
    const { data: role, error: roleErr } = await supabase.from('roles').upsert({
      user_id: user.id, dedupe_key: dedupeKey(summary.company, summary.role), company: summary.company, title: summary.role,
      status: 'Evaluated', score: Number.isFinite(scoreNum) ? scoreNum : null,
      url: /^https?:/i.test(input) ? input : null, source: /^https?:/i.test(input) ? 'url' : 'paste',
      jd_text: jd, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,dedupe_key' }).select('id').single();
    if (roleErr) throw roleErr;
    await supabase.from('reports').insert({ user_id: user.id, role_id: role.id, markdown: text.replace(SUMMARY_RE, '').trim(), score: Number.isFinite(scoreNum) ? scoreNum : null });
    return jsonResponse({ ok: true, role_id: role.id, summary }, 200, origin);
  } catch (err) {
    await admin.rpc('refund_quota', { p_user_id: user.id, p_metric: 'evaluationsPerMonth' }).catch(() => {}); // give the slot back
    return errorResponse(502, clientLlmMessage(err, provider), err, origin);
  }
});
