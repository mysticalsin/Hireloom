// Shared tailoring engine: Kimi call + new-layout renderer.
// New layout: header + summary + work history + competencies on PAGE 1;
// education + certifications forced to PAGE 2. Reused by the sample and the batch.
import { readFileSync } from 'fs';
import { chromium } from 'playwright';
import { loadIdentity } from '../lib/identity.mjs';

const KEY   = process.env.KIMI_API_KEY || '';
const BASE  = (process.env.KIMI_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
const MODEL = process.env.KIMI_MODEL || 'moonshotai/kimi-k2.6';

// Candidate name/contact/education/certs come from config/profile.yml — see lib/identity.mjs.
const ID = loadIdentity();

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- Kimi call: reshape CV → JD. Returns {title, summary, experience[], competencies, tools} ----
const SYSTEM = `You are an elite resume writer tailoring ONE candidate's resume to ONE specific job description.

ABSOLUTE HONESTY RULES (never break):
- Use ONLY facts, employers, titles, dates, locations, metrics, tools, and certifications that appear in the candidate's CV. NEVER invent or imply experience the CV does not contain.
- If the JD wants a skill/domain the candidate lacks (e.g., "civil earthworks", "blueprints", "capital projects", "site order of operations"), do NOT assert it as proven experience and do NOT lift the JD's phrase as if the candidate has done it. You may only connect via explicit transferable framing ("transferable to…", "analogous to…") OR omit it. Name a tool ONLY if it's already in the CV (you may append "(ramping)" to a genuinely adjacent tool at most once).
- NO keyword-stuffing: do not pad competencies with soft-skill phrases echoed from the JD ("fast-paced", "attention to detail"). Every competency must reflect real demonstrated work.
- Keep every employer, job title, period (DATES ONLY — never put the location in the period), and location EXACTLY as in the CV. Reshape only the bullet wording/emphasis.

TASK: Rewrite the summary, the bullets under each job, the competencies, and the tools list so the resume reads as a strong, HONEST match for THIS JD. Mirror the JD's real priorities and vocabulary. Re-weight the tools list toward what THIS JD values (drop irrelevant tools, surface relevant ones from the CV). Make bullets long and specific so the WORK HISTORY ALONE FILLS A FULL PAGE: most recent role 5 substantial bullets, each role 3-4, every bullet a full 2 lines of real detail. Start each role's first bullet with a short scope-setting clause (team size, scope, what was owned).

Also write a tailored COVER LETTER of EXACTLY 3 paragraphs (no more) to the same company/role, same honesty rules: para 1 — the role + a genuine hook to the company's mission/work; para 2 — 2-3 concrete, real achievements mapped to the JD's priorities; para 3 — logistics/fit (Canada-eligible, no sponsorship, availability) + close. First person, warm and professional, no invented experience.

OUTPUT: STRICT JSON only, no markdown, matching exactly:
{"title": string, "summary": string, "experience": [{"title": string, "period": string, "location": string, "bullets": [string]}], "competencies": string (" · " separated), "tools": string (" · " separated), "coverLetter": [string, string, string]}`;

export async function kimiTailor(cvText, jd, roleTitle, company) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `JOB TITLE: ${roleTitle}\nCOMPANY: ${company}\n\n=== JOB DESCRIPTION ===\n${jd}\n\n=== CANDIDATE CV (source of truth) ===\n${cvText}\n\nReturn the tailored JSON now.` },
    ],
    temperature: 0.4, max_tokens: 3000,
    response_format: { type: 'json_object' },
  };
  // hard timeout so a stalled connection fails fast and the caller retries
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 180_000);
  let res;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } finally { clearTimeout(timer); }
  if (res.status === 429) { const e = new Error('rate-or-usage-limit'); e.code = 429; e.retryAfter = res.headers.get('retry-after'); e.bodyText = await res.text().catch(() => ''); throw e; }
  if (!res.ok) throw new Error(`kimi ${res.status}: ${await res.text().catch(() => '')}`);
  const j = await res.json();
  let txt = j.choices?.[0]?.message?.content || '';
  txt = txt.replace(/```json/gi, '').replace(/```/g, '').trim();
  const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('kimi returned no JSON');
  const parsed = JSON.parse(txt.slice(s, e + 1));
  // structural validation — a malformed shape should retry, not crash the renderer
  if (!parsed.summary || !Array.isArray(parsed.experience) || parsed.experience.length === 0 ||
      parsed.experience.some(j => !j.title || !Array.isArray(j.bullets) || j.bullets.length === 0))
    throw new Error('kimi returned malformed structure');
  parsed.title = parsed.title || roleTitle;
  parsed.competencies = parsed.competencies || '';
  parsed.tools = parsed.tools || '';
  return parsed;
}

// ---- Normalizer: fix common Kimi quirks before rendering ----
// • period field should be dates only (Kimi sometimes appends the location)
// • dedupe a doubled location ("X · X" / "X, X" → "X")
// • enforce reverse-chronological job order matching the CV
export function normalizeContent(c) {
  // job-order hints come from cv.experience_order in config/profile.yml;
  // with no hints the input order is kept (Array.sort is stable)
  const order = t => ID.experienceOrder(t);
  for (const j of c.experience || []) {
    // period: keep the date range only
    j.period = (j.period || '').split('·')[0].split(/\s{2,}/)[0].trim();
    // location: collapse "A · A" or "A, B, A" duplicates
    const parts = (j.location || '').split(/\s*·\s*/).map(s => s.trim()).filter(Boolean);
    j.location = [...new Set(parts)].join(', ') || j.location;
    const half = j.location.split(', ');
    if (half.length === 4 && half.slice(0, 2).join(', ') === half.slice(2).join(', ')) j.location = half.slice(0, 2).join(', ');
  }
  c.experience = (c.experience || []).sort((a, b) => order(a.title) - order(b.title));
  if (Array.isArray(c.coverLetter) && c.coverLetter.length > 4) c.coverLetter = c.coverLetter.slice(0, 4);
  return c;
}

// ---- Renderer ----
function expHtml(experience) {
  return (experience || []).map(job => `
      <div class="job">
        <div class="job-header"><span class="job-title">${esc(job.title || '')}</span><span class="job-period">${esc(job.period || '')}</span></div>
        <div class="job-location">${esc(job.location || '')}</div>
        <ul>${(job.bullets || []).map(b => `<li>${esc(b)}</li>`).join('')}</ul>
      </div>`).join('');
}

export function buildHtml(c) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;line-height:1.5;color:#1a1a1a;background:#fff}
  .page{width:100%;margin:0;padding:0}
  .header{margin-bottom:6px}.header-row{display:flex;justify-content:space-between;align-items:flex-end;gap:16px}
  .header h1{font-size:30px;font-weight:800;text-transform:uppercase;letter-spacing:.02em;color:#111;line-height:1.05}
  .header .role{font-size:15px;font-weight:700;color:#222;white-space:nowrap;padding-bottom:3px}
  .header-rule{height:2px;background:linear-gradient(to right,#777,#d8d8d8);margin:8px 0 10px}
  .contact-row{text-align:center;font-size:11px;color:#333}.contact-row .sep{color:#999;padding:0 6px}
  .section{margin-bottom:16px}.section-title{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.03em;color:#111;margin-bottom:8px}
  .summary-text{font-size:11px;line-height:1.6;color:#2b2b2b;text-align:justify}
  .experience{position:relative;padding-left:22px}.experience::before{content:'';position:absolute;left:4px;top:6px;bottom:8px;width:1.5px;background:#c9c9c9}
  .job{position:relative;margin-bottom:14px}.job::before{content:'';position:absolute;left:-22px;top:3px;width:9px;height:9px;border-radius:50%;background:#1a1a1a;border:2px solid #fff;box-shadow:0 0 0 1px #1a1a1a}
  .job-header{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
  .job-title{font-size:12px;font-weight:700;color:#111}.job-period{font-size:11px;font-weight:700;color:#111;white-space:nowrap}
  .job-location{font-size:10.5px;color:#555;margin-bottom:4px}
  .job ul{padding-left:16px;margin-top:4px}.job li{font-size:10.5px;line-height:1.55;color:#2b2b2b;margin-bottom:4px;text-align:justify;orphans:2;widows:2;break-inside:avoid;page-break-inside:avoid}
  p,.summary-text,.ct-list{orphans:3;widows:3}
  .two-col{display:flex;gap:40px;margin-bottom:16px}.two-col>.col{flex:1;min-width:0}
  .edu-degree,.cert-title{font-size:11px;font-weight:700;color:#111}.edu-org{font-size:11px;color:#333;margin-top:1px}
  .edu-date,.cert-date{font-size:11px;font-weight:700;color:#111;margin-top:1px}.edu-item{margin-bottom:8px}.cert-item{margin-bottom:10px}.cert-org{font-size:11px;color:#333}
  .ct-block{margin-bottom:8px}.ct-label{font-weight:700;color:#111;font-size:11px}.ct-list{font-size:11px;color:#2b2b2b;line-height:1.6}
  .avoid-break,.job,.edu-item,.cert-item,.two-col{break-inside:avoid;page-break-inside:avoid}
  .pagebreak{page-break-before:always}
  /* === SINGLE-PAGE TIGHTENING (keeps Education+Certs+Competencies on page 1 with the experience) === */
  .section{margin-bottom:9px}
  .section-title{margin-bottom:5px;font-size:12.5px}
  .summary-text{line-height:1.42}
  .job{margin-bottom:7px}
  .job ul{margin-top:2px}
  .job li{margin-bottom:2px;line-height:1.38}
  .job-location{margin-bottom:2px}
  .two-col{margin-bottom:9px;gap:36px}
  .edu-item{margin-bottom:5px}.cert-item{margin-bottom:6px}
  .ct-block{margin-bottom:5px}.ct-list{line-height:1.45}
  .header-rule{margin:6px 0 8px}
  </style></head><body><div class="page">
    <div class="header avoid-break"><div class="header-row"><h1>${esc(ID.name)}</h1><div class="role">${esc(c.title)}</div></div>
    <div class="header-rule"></div><div class="contact-row">${ID.contactHtml}</div></div>
    <div class="section avoid-break"><div class="section-title">Professional Summary</div><div class="summary-text">${esc(c.summary)}</div></div>
    <div class="section"><div class="section-title">Work Experience</div><div class="experience">${expHtml(c.experience)}</div></div>
    <div class="two-col"><div class="col"><div class="section-title">Education</div>${ID.eduHtml}</div>
      <div class="col"><div class="section-title">Certifications</div>${ID.certsHtml}</div></div>
    <div class="section avoid-break"><div class="section-title">Core Competencies & Tools</div>
      <div class="ct-block"><span class="ct-label">Competencies:</span> <span class="ct-list">${esc(c.competencies)}</span></div>
      <div class="ct-block"><span class="ct-label">Tools:</span> <span class="ct-list">${esc(c.tools)}</span></div></div>
  </div></body></html>`;
}

export function buildCoverHtml(paras) {
  const body = (paras || []).map(p => `<p>${esc(p)}</p>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11.5px;line-height:1.65;color:#1a1a1a}
  .h{font-size:24px;font-weight:800;text-transform:uppercase;letter-spacing:.02em}
  .rule{height:2px;background:linear-gradient(to right,#777,#d8d8d8);margin:8px 0 16px}
  .c{font-size:11px;color:#333;margin-bottom:20px}
  p{margin-bottom:12px;text-align:justify;orphans:3;widows:3}
  </style></head><body>
  <div class="h">${esc(ID.name)}</div><div class="rule"></div>
  <div class="c">${esc(ID.contactText)}</div>
  ${body}<p>Sincerely,<br>${esc(ID.name)}</p></body></html>`;
}

async function toPdf(html, outPath) {
  const EXE = process.env.PW_CHROMIUM_PATH || '';
  const ctx = await chromium.launch({ headless: true, ...(EXE ? { executablePath: EXE } : {}) });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  // 0.5in top/bottom + 0.7in sides keeps the whole CV on a single page
  // (with the buildHtml single-page tightening) while staying print-safe.
  await page.pdf({ path: outPath, format: 'Letter', printBackground: true,
    margin: { top: '0.5in', bottom: '0.5in', left: '0.7in', right: '0.7in' } });
  await ctx.close();
}

export const renderPdf = (content, outPath) => toPdf(buildHtml(content), outPath);
export const renderCoverPdf = (paras, outPath) => toPdf(buildCoverHtml(paras), outPath);

// Single combined PDF: cover letter (page 1+), page-break, then the resume.
// Used by employers that require cover + resume as ONE uploaded PDF (e.g. TransLink).
export function buildCombinedHtml(content) {
  const coverBody = buildCoverHtml(content.coverLetter)
    .replace(/^[\s\S]*?<body>/, '').replace(/<\/body>[\s\S]*$/, '');
  const coverCss = `.cv-cover .h{font-size:24px;font-weight:800;text-transform:uppercase;letter-spacing:.02em;color:#111}`
    + `.cv-cover .rule{height:2px;background:linear-gradient(to right,#777,#d8d8d8);margin:8px 0 16px}`
    + `.cv-cover .c{font-size:11px;color:#333;margin-bottom:20px}`
    + `.cv-cover p{font-size:11.5px;line-height:1.65;margin-bottom:12px;text-align:justify;orphans:3;widows:3}`;
  return buildHtml(content)
    .replace('</style>', coverCss + '</style>')
    .replace('<div class="page">', `<div class="page"><div class="cv-cover">${coverBody}</div><div class="pagebreak"></div>`);
}
export const renderCombinedPdf = (content, outPath) => toPdf(buildCombinedHtml(content), outPath);

// Render resume + cover into BOTH the pool-NNN folder and the rank-NNN browse folder,
// reusing a single Chromium + page for all PDFs of this role (much faster).
export async function renderRoleBoth(content, row) {
  const fs = await import('fs');
  const EXE = process.env.PW_CHROMIUM_PATH || '';
  const pad = String(row.rank).padStart(3, '0');
  const poolFolder = row.folder; // output/applications/pool-NNN - Company - Role
  const base = poolFolder.split('/').pop().replace(/^pool-\d+/, pad);
  const queueFolder = `output/applications-by-queue/${base}`;
  const M = { top: '0.5in', bottom: '0.5in', left: '0.7in', right: '0.7in' };
  const ctx = await chromium.launch({ headless: true, ...(EXE ? { executablePath: EXE } : {}) });
  const page = await ctx.newPage();
  try {
    for (const dir of [poolFolder, queueFolder]) {
      fs.mkdirSync(dir, { recursive: true });
      await page.setContent(buildHtml(content), { waitUntil: 'load' });
      await page.pdf({ path: `${dir}/${ID.name} - Resume.pdf`, format: 'Letter', printBackground: true, margin: M });
      if (content.coverLetter) {
        await page.setContent(buildCoverHtml(content.coverLetter), { waitUntil: 'load' });
        await page.pdf({ path: `${dir}/${ID.name} - Cover Letter.pdf`, format: 'Letter', printBackground: true, margin: M });
      }
    }
  } finally { await ctx.close(); }
}
