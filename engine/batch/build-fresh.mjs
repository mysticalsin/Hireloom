#!/usr/bin/env node
/**
 * build-fresh.mjs — build tailored CV + cover packages for freshly-scanned roles.
 *
 * Reads data/pipeline.md for roles carrying a "posted YYYY-MM-DD" tag (written by
 * scan.mjs), keeps those within --max-age days, fit-ranks them, and for each:
 *   1. fetches the full JD from its ATS (Greenhouse / Lever / Ashby board APIs;
 *      Workday cxs job-detail endpoint) and saves it to the role folder as JD.md,
 *   2. Kimi-tailors cv.md to that JD (engine/batch/tailor-engine.mjs, honesty rules),
 *   3. renders "Ramy Sherif - Resume.pdf" + "... - Cover Letter.pdf" into
 *      output/applications/<Company> - <Role>/  (the loose lane the unified role
 *      registry reads — so each shows up in All Roles, JD-paired),
 *   4. writes meta.json (url, ats, posted, fit score, comp if found).
 *
 * Resumable: output/fresh-2026-06-15/built.json records done URLs; re-running skips
 * them. One shared Chromium; small concurrency for the network-bound Kimi calls.
 *
 * Usage:
 *   PW_CHROMIUM_PATH=… KIMI_API_KEY=… node engine/batch/build-fresh.mjs --max-age 14
 *   …                                                                   --max-age 14 --limit 4
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import yaml from 'js-yaml';
import { chromium } from 'playwright';
import { kimiTailor, normalizeContent, buildHtml, buildCoverHtml } from './tailor-engine.mjs';
import { loadIdentity } from '../lib/identity.mjs';
import { autoFitScore } from '../../apps/web/lib/fit-score.mjs';

const ID = loadIdentity();
const args = process.argv.slice(2);
const numFlag = (n, d) => { const i = args.indexOf(n); return i !== -1 ? parseInt(args[i + 1], 10) : d; };
const MAX_AGE = numFlag('--max-age', 14);
const LIMIT = numFlag('--limit', Infinity);
const CONC = numFlag('--conc', 3);
const TODAY = '2026-06-15';                 // stamped (Date.now avoided for reproducibility)
const CUTOFF = '2026-06-01';                // = TODAY - 14d; recomputed below if --max-age differs
const WORKDIR = 'output/fresh-2026-06-15';
const APPS = 'output/applications';
const BUILT_PATH = `${WORKDIR}/built.json`;

mkdirSync(WORKDIR, { recursive: true });

function cutoffDate() {
  if (MAX_AGE === 14) return CUTOFF;
  const d = new Date(TODAY + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - MAX_AGE);
  return d.toISOString().slice(0, 10);
}
const cutoff = cutoffDate();

const detectAts = u => /greenhouse\.io|gh_jid=/.test(u) ? 'greenhouse'
  : /lever\.co/.test(u) ? 'lever' : /ashbyhq\.com/.test(u) ? 'ashby'
  : /myworkdayjobs/.test(u) ? 'workday' : 'other';

const archOf = t => { t = t.toLowerCase();
  if (/implementation|onboard|go-live|deploy/.test(t)) return 'IMPL_DEL';
  if (/business analyst|systems analyst|business systems/.test(t)) return 'BIZ_ANALYST';
  if (/customer success|service delivery|\bsupport\b/.test(t)) return 'IT_SVC';
  if (/project manager|program manager|delivery manager|pmo|project lead|program lead|portfolio/.test(t)) return 'PROG_PM';
  return 'GEN_PM_OPS'; };

const safe = s => String(s).replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const strip = h => (h || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();

async function getJSON(url, opts = {}) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(20000), ...opts });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// company → greenhouse board slug, from portals.yml (custom-domain URLs carry
// gh_jid= but not the board slug, e.g. instacart.careers, mongodb.com/careers)
const ghSlug = {};
try {
  const pj = yaml.load(readFileSync('portals.yml', 'utf8'));
  for (const c of (pj.tracked_companies || [])) {
    const src = c.api || c.careers_url || '';
    const m = src.match(/greenhouse\.io\/(?:v1\/boards\/)?([^/?#]+)/);
    if (m && c.name) ghSlug[norm(c.name)] = m[1];
  }
} catch { /* portals optional */ }

const ashbyCache = {};
async function fetchJD(role) {
  const u = role.url;
  try {
    if (role.ats === 'greenhouse') {
      let slug, id;
      const m = u.match(/greenhouse\.io\/(?:embed\/job_board\?for=)?([^/?#]+)\/jobs\/(\d+)/);
      if (m) { slug = m[1]; id = m[2]; }
      else { const g = u.match(/gh_jid=(\d+)/); if (g) { id = g[1]; slug = ghSlug[norm(role.company)] || norm(role.company).replace(/ /g, ''); } }
      if (!slug || !id) return null;
      const j = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}?content=true`);
      return j ? { text: strip(j.content), comp: '' } : null;
    }
    if (role.ats === 'lever') {
      const m = u.match(/lever\.co\/([^/?#]+)\/([0-9a-f-]{8,})/i);
      if (!m) return null;
      const j = await getJSON(`https://api.lever.co/v0/postings/${m[1]}/${m[2]}`);
      return j ? { text: strip(j.descriptionPlain || j.description || ''), comp: '' } : null;
    }
    if (role.ats === 'ashby') {
      const m = u.match(/ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{8,})/i);
      if (!m) return null;
      if (!ashbyCache[m[1]]) ashbyCache[m[1]] = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${m[1]}?includeCompensation=true`);
      const board = ashbyCache[m[1]];
      const job = board?.jobs?.find(x => x.id === m[2]) || board?.jobs?.find(x => norm(x.title) === norm(role.title));
      return job ? { text: strip(job.descriptionPlain || job.descriptionHtml || ''), comp: '' } : null;
    }
    if (role.ats === 'workday') {
      const m = u.match(/https?:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/]+)\/job\/(.+)$/);
      if (!m) return null;
      const [, tenant, wd, site, path] = m;
      const j = await getJSON(`https://${tenant}.${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/job/${path}`);
      const info = j?.jobPostingInfo;
      if (!info) return null;
      const text = strip(info.jobDescription);
      const comp = (text.match(/Pay (?:Details|Range)[:\s]*([^.]+?CAD)/i) || [])[1] || '';
      return { text, comp: comp.trim() };
    }
  } catch { /* fall through */ }
  return null;
}

async function tailorWithRetry(cv, jd, title, company, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { return await kimiTailor(cv, jd, title, company); }
    catch (e) {
      if (e.code === 429) await new Promise(r => setTimeout(r, (parseInt(e.retryAfter) || 8) * 1000));
      else if (i === tries - 1) throw e;
      else await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error('tailor failed after retries');
}

// ── load work-list ──────────────────────────────────────────────────
const cv = readFileSync('cv.md', 'utf8');
const built = existsSync(BUILT_PATH) ? JSON.parse(readFileSync(BUILT_PATH, 'utf8')) : {};
const roles = readFileSync('data/pipeline.md', 'utf8').split('\n')
  .map(l => { const m = l.match(/^- \[ \] (\S+) \| (.+?) \| (.+?) \| posted (\d{4}-\d{2}-\d{2})/); return m ? { url: m[1], company: m[2].trim(), title: m[3].trim(), posted: m[4] } : null; })
  .filter(Boolean).filter(r => r.posted >= cutoff);
for (const r of roles) { r.ats = detectAts(r.url); r.archetype = archOf(r.title); r.score = autoFitScore({ title: r.title, ats: r.ats, archetype: r.archetype }).score; }
roles.sort((a, b) => (b.score - a.score) || b.posted.localeCompare(a.posted));
const todo = roles.filter(r => !built[r.url]).slice(0, LIMIT);

console.log(`fresh roles ≥${cutoff}: ${roles.length} | already built: ${Object.keys(built).length} | to build now: ${todo.length}`);
if (!process.env.KIMI_API_KEY) { console.error('FATAL: KIMI_API_KEY not set'); process.exit(1); }

// ── build ───────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}) });
const M = { top: '0.5in', bottom: '0.5in', left: '0.7in', right: '0.7in' };
let ok = 0, jdMiss = 0, fail = 0;

async function buildOne(role) {
  const folder = `${APPS}/${safe(`${role.company} - ${role.title}`)}`;
  const jd = await fetchJD(role);
  if (!jd || !jd.text || jd.text.length < 80) jdMiss++;
  const jdText = jd?.text && jd.text.length >= 80 ? jd.text : `${role.title} at ${role.company}.`;
  let content;
  try { content = normalizeContent(await tailorWithRetry(cv, jdText, role.title, role.company)); }
  catch (e) { fail++; console.log(`  ✗ ${role.company} | ${role.title} — tailor: ${e.message}`); return; }
  mkdirSync(folder, { recursive: true });
  const page = await browser.newPage();
  try {
    await page.setContent(buildHtml(content), { waitUntil: 'load' });
    await page.pdf({ path: `${folder}/${ID.name} - Resume.pdf`, format: 'Letter', printBackground: true, margin: M });
    if (content.coverLetter) {
      await page.setContent(buildCoverHtml(content.coverLetter), { waitUntil: 'load' });
      await page.pdf({ path: `${folder}/${ID.name} - Cover Letter.pdf`, format: 'Letter', printBackground: true, margin: M });
    }
  } finally { await page.close(); }
  if (jd?.text) writeFileSync(`${folder}/JD.md`, `# ${role.title} — ${role.company}\n\n**URL:** ${role.url}\n**Posted:** ${role.posted}${jd.comp ? `\n**Comp:** ${jd.comp}` : ''}\n\n---\n\n${jd.text}\n`);
  writeFileSync(`${folder}/meta.json`, JSON.stringify({ url: role.url, company: role.company, role: role.title, ats: role.ats, posted: role.posted, score: role.score, archetype: role.archetype, comp: jd?.comp || '', folder, builtAt: TODAY }, null, 2));
  built[role.url] = { folder, at: TODAY };
  writeFileSync(BUILT_PATH, JSON.stringify(built, null, 2));
  ok++;
  console.log(`  ✓ ${role.score.toFixed(1)} | ${role.company} | ${role.title}${jd?.comp ? ` | ${jd.comp}` : ''}`);
}

// small concurrency pool (network-bound Kimi calls)
let idx = 0;
async function worker() { while (idx < todo.length) { const r = todo[idx++]; await buildOne(r); } }
await Promise.all(Array.from({ length: Math.min(CONC, todo.length) }, worker));
await browser.close();

console.log(`\nDONE — built ${ok}, JD-missing ${jdMiss}, failed ${fail}. Total built: ${Object.keys(built).length}/${roles.length}`);
