#!/usr/bin/env node
/**
 * build-fresh.mjs — package freshly-scanned roles into apply-ready CV+cover sets.
 *
 * Tailoring is authored by CLAUDE IN-SESSION (Ramy's rule 2026-06-15: "your words,
 * kimi's style — don't use kimi/any API key to tailor"). So this script does ONLY
 * the no-LLM I/O around that authoring, in two modes:
 *
 *   --fetch-jds   Rank the fresh roles (data/pipeline.md "posted" tags, within
 *                 --max-age days), fetch each full JD from its ATS, and save
 *                 output/fresh-2026-06-15/{manifest.json, jds/<key>.json}.
 *                 No browser, no LLM. Run this FIRST.
 *
 *   --render      For each manifest role that has an authored content file at
 *                 output/fresh-2026-06-15/content/<key>.json (written by Claude),
 *                 render "Ramy Sherif - Resume.pdf" + "... - Cover Letter.pdf" into
 *                 output/applications/<Company> - <Role>/ (the loose lane the
 *                 unified registry reads), and write JD.md + meta.json. Idempotent
 *                 and incremental — re-run as more content files are authored.
 *
 * <key> = zero-padded fit rank (e.g. 001). Content file shape = kimiTailor's:
 *   {title, summary, experience:[{title,period,location,bullets:[]}], competencies, tools, coverLetter:[]}
 *
 * Usage:
 *   node engine/batch/build-fresh.mjs --fetch-jds --max-age 14
 *   PW_CHROMIUM_PATH=… node engine/batch/build-fresh.mjs --render
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import yaml from 'js-yaml';
import { chromium } from 'playwright';
import { normalizeContent, buildHtml, buildCoverHtml } from './tailor-engine.mjs';
import { loadIdentity } from '../lib/identity.mjs';
import { autoFitScore } from '../../apps/web/lib/fit-score.mjs';

const ID = loadIdentity();
const args = process.argv.slice(2);
const MODE = args.includes('--fetch-jds') ? 'fetch-jds' : args.includes('--render') ? 'render' : null;
const numFlag = (n, d) => { const i = args.indexOf(n); return i !== -1 ? parseInt(args[i + 1], 10) : d; };
const MAX_AGE = numFlag('--max-age', 14);
const CONC = numFlag('--conc', 4);
const TODAY = '2026-06-15';
const WORKDIR = 'output/fresh-2026-06-15';
const JDS = `${WORKDIR}/jds`;
const CONTENT = `${WORKDIR}/content`;
const APPS = 'output/applications';
mkdirSync(JDS, { recursive: true });
mkdirSync(CONTENT, { recursive: true });

if (!MODE) { console.error('usage: build-fresh.mjs (--fetch-jds | --render) [--max-age N]'); process.exit(1); }

// ── shared: rank the fresh roles ────────────────────────────────────
function cutoffDate() {
  if (MAX_AGE === 14) return '2026-06-01';
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

function buildManifest() {
  const roles = readFileSync('data/pipeline.md', 'utf8').split('\n')
    .map(l => { const m = l.match(/^- \[ \] (\S+) \| (.+?) \| (.+?) \| posted (\d{4}-\d{2}-\d{2})/); return m ? { url: m[1], company: m[2].trim(), title: m[3].trim(), posted: m[4] } : null; })
    .filter(Boolean).filter(r => r.posted >= cutoff);
  for (const r of roles) { r.ats = detectAts(r.url); r.archetype = archOf(r.title); r.score = autoFitScore({ title: r.title, ats: r.ats, archetype: r.archetype }).score; }
  roles.sort((a, b) => (b.score - a.score) || b.posted.localeCompare(a.posted));
  roles.forEach((r, i) => { r.fitRank = i + 1; r.key = String(i + 1).padStart(3, '0'); r.folder = `${APPS}/${safe(`${r.company} - ${r.title}`)}`; });
  writeFileSync(`${WORKDIR}/manifest.json`, JSON.stringify({ generated: TODAY, window: `${MAX_AGE}d`, count: roles.length, roles }, null, 2));
  return roles;
}

// ── JD fetch (greenhouse/lever/ashby board APIs + workday cxs) ───────
async function getJSON(url) {
  try { const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) }); return r.ok ? await r.json() : null; }
  catch { return null; }
}
const ghSlug = {};
try {
  const pj = yaml.load(readFileSync('portals.yml', 'utf8'));
  for (const c of (pj.tracked_companies || [])) { const src = c.api || c.careers_url || ''; const m = src.match(/greenhouse\.io\/(?:v1\/boards\/)?([^/?#]+)/); if (m && c.name) ghSlug[norm(c.name)] = m[1]; }
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
      const m = u.match(/lever\.co\/([^/?#]+)\/([0-9a-f-]{8,})/i); if (!m) return null;
      const j = await getJSON(`https://api.lever.co/v0/postings/${m[1]}/${m[2]}`);
      return j ? { text: strip(j.descriptionPlain || j.description || ''), comp: '' } : null;
    }
    if (role.ats === 'ashby') {
      const m = u.match(/ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{8,})/i); if (!m) return null;
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
      const info = j?.jobPostingInfo; if (!info) return null;
      const text = strip(info.jobDescription);
      const comp = (text.match(/Pay (?:Details|Range)[:\s]*([^.]+?CAD)/i) || [])[1] || '';
      return { text, comp: comp.trim() };
    }
  } catch { /* fall through */ }
  return null;
}

// ── MODE: fetch-jds ─────────────────────────────────────────────────
if (MODE === 'fetch-jds') {
  const roles = buildManifest();
  let got = 0, miss = 0;
  let idx = 0;
  async function worker() {
    while (idx < roles.length) {
      const r = roles[idx++];
      if (existsSync(`${JDS}/${r.key}.json`)) { got++; continue; }
      const jd = await fetchJD(r);
      const text = jd?.text && jd.text.length >= 80 ? jd.text : '';
      writeFileSync(`${JDS}/${r.key}.json`, JSON.stringify({ key: r.key, fitRank: r.fitRank, company: r.company, title: r.title, url: r.url, ats: r.ats, posted: r.posted, score: r.score, comp: jd?.comp || '', jd: text }, null, 2));
      if (text) got++; else miss++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, roles.length) }, worker));
  console.log(`fetch-jds: ${roles.length} roles ranked → manifest.json; JDs got ${got}, missing ${miss}. Saved to ${JDS}/`);
  process.exit(0);
}

// ── MODE: render (from Claude-authored content/<key>.json) ──────────
if (MODE === 'render') {
  const manifest = JSON.parse(readFileSync(`${WORKDIR}/manifest.json`, 'utf8'));
  const M = { top: '0.5in', bottom: '0.5in', left: '0.7in', right: '0.7in' };
  const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}) });
  let rendered = 0; const pending = [];
  try {
    for (const r of manifest.roles) {
      const cpath = `${CONTENT}/${r.key}.json`;
      if (!existsSync(cpath)) { pending.push(r.key); continue; }
      const content = normalizeContent(JSON.parse(readFileSync(cpath, 'utf8')));
      mkdirSync(r.folder, { recursive: true });
      const page = await browser.newPage();
      try {
        await page.setContent(buildHtml(content), { waitUntil: 'load' });
        await page.pdf({ path: `${r.folder}/${ID.name} - Resume.pdf`, format: 'Letter', printBackground: true, margin: M });
        if (content.coverLetter) {
          await page.setContent(buildCoverHtml(content.coverLetter), { waitUntil: 'load' });
          await page.pdf({ path: `${r.folder}/${ID.name} - Cover Letter.pdf`, format: 'Letter', printBackground: true, margin: M });
        }
      } finally { await page.close(); }
      const jdMeta = existsSync(`${JDS}/${r.key}.json`) ? JSON.parse(readFileSync(`${JDS}/${r.key}.json`, 'utf8')) : {};
      if (jdMeta.jd) writeFileSync(`${r.folder}/JD.md`, `# ${r.title} — ${r.company}\n\n**URL:** ${r.url}\n**Posted:** ${r.posted}${jdMeta.comp ? `\n**Comp:** ${jdMeta.comp}` : ''}\n\n---\n\n${jdMeta.jd}\n`);
      writeFileSync(`${r.folder}/meta.json`, JSON.stringify({ url: r.url, company: r.company, role: r.title, ats: r.ats, posted: r.posted, score: r.score, archetype: r.archetype, comp: jdMeta.comp || '', folder: r.folder, author: 'claude-max-session', builtAt: TODAY }, null, 2));
      rendered++;
      console.log(`  ✓ ${r.key} | ${r.score.toFixed(1)} | ${r.company} | ${r.title}`);
    }
  } finally { await browser.close(); }
  console.log(`\nrender: ${rendered} rendered. Awaiting content for ${pending.length} more${pending.length ? ' (' + pending.slice(0, 12).join(',') + (pending.length > 12 ? '…' : '') + ')' : ''}.`);
  process.exit(0);
}
