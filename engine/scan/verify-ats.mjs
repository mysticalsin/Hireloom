#!/usr/bin/env node
// verify-ats.mjs — verify a company's ATS slug against the live API and count
// Canada-eligible target-title roles. Use it BEFORE adding companies to
// portals.yml (so a wrong slug never enters the pool), or as a pool health-check
// that flags dead boards (404) and empty/low-yield companies.
//
// Usage:
//   node engine/scan/verify-ats.mjs --portals            health-check every enabled company in portals.yml
//   node engine/scan/verify-ats.mjs <candidates.json>    verify a list: [{name, careers_url}] or [{name, ats_provider, slug}]
//   node engine/scan/verify-ats.mjs --url <careers_url>  verify one company by its careers URL
//   flags: --json (machine-readable output) · --enabled-only (portals: skip disabled, default on)
//
// Supports greenhouse / ashby / lever / workday / smartrecruiters / recruitee.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// ── Pure helpers (exported for tests) ───────────────────────────────

// Target PM/delivery/ops titles Ramy is pivoting toward.
export const TARGET_RE = /(project manager|program manager|product manager|product owner|delivery manager|portfolio manager|operations manager|business analyst|systems analyst|implementation|transformation|change manager|continuous improvement|operational excellence|pmo|chief of staff|strategy|scrum master|operations analyst|supply chain|logistics|vendor manager|procurement|coordinator)/i;
// Canada-eligible. Bare "remote" is intentionally NOT counted (avoids "Remote - US").
export const CA_RE = /(canada|canadian|toronto|ontario|mississauga|markham|ottawa|waterloo|kitchener|hamilton|vancouver|burnaby|victoria|montr|quebec|qc\b|calgary|edmonton|winnipeg|halifax|\banywhere\b|north america|worldwide)/i;
export const NONCA_RE = /(only|united states only|us only|emea|apac|united kingdom|\bindia\b)/i;

// Derive {provider, slug} from a careers URL. Mirrors scan.mjs detectApi and adds
// smartrecruiters + recruitee. Returns null if no known ATS is recognized.
export function deriveAts(careersUrl, apiUrl = '') {
  const url = String(careersUrl || '');
  if ((apiUrl || '').includes('greenhouse')) {
    const m = apiUrl.match(/boards\/([^/?#]+)\/jobs/) || apiUrl.match(/greenhouse\.io\/([^/?#]+)/);
    if (m) return { provider: 'greenhouse', slug: m[1] };
  }
  let m;
  if ((m = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/))) return { provider: 'ashby', slug: m[1] };
  if ((m = url.match(/jobs\.lever\.co\/([^/?#]+)/))) return { provider: 'lever', slug: m[1] };
  if ((m = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/))) return { provider: 'greenhouse', slug: m[1] };
  if ((m = url.match(/jobs\.smartrecruiters\.com\/([^/?#]+)/))) return { provider: 'smartrecruiters', slug: m[1] };
  if ((m = url.match(/https?:\/\/([^.]+)\.recruitee\.com/))) return { provider: 'recruitee', slug: m[1] };
  if ((m = url.match(/https?:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)/))) {
    return { provider: 'workday', slug: `${m[1]}|${m[2]}|${m[3]}` };
  }
  return null;
}

// Tally target / Canada-eligible-target roles from [{title, loc}].
export function tallyRoles(rows) {
  let target = 0, caTarget = 0;
  const samples = [];
  for (const { title, loc } of rows) {
    if (!TARGET_RE.test(title || '')) continue;
    target++;
    const caOk = !loc || (CA_RE.test(loc) && !NONCA_RE.test(loc));
    if (caOk) { caTarget++; if (samples.length < 4) samples.push(`${title} [${loc || '?'}]`); }
  }
  return { total: rows.length, target, caTarget, samples };
}

// ── Network ─────────────────────────────────────────────────────────

async function getJson(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', ...(opts.headers || {}) } });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return { data: await r.json() };
  } catch (e) { return { error: e.message }; }
  finally { clearTimeout(t); }
}

async function verifyOne(provider, slug) {
  if (provider === 'greenhouse') {
    const { data, error } = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
    if (error) return { status: 'FAIL', err: error };
    return { status: 'OK', ...tallyRoles((data.jobs || []).map(j => ({ title: j.title, loc: j.location?.name }))) };
  }
  if (provider === 'lever') {
    const { data, error } = await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    if (error) return { status: 'FAIL', err: error };
    return { status: 'OK', ...tallyRoles((Array.isArray(data) ? data : []).map(j => ({ title: j.text, loc: j.categories?.location }))) };
  }
  if (provider === 'ashby') {
    const { data, error } = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
    if (error) return { status: 'FAIL', err: error };
    return { status: 'OK', ...tallyRoles((data.jobs || []).map(j => ({ title: j.title, loc: j.location }))) };
  }
  if (provider === 'smartrecruiters') {
    const { data, error } = await getJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`);
    if (error) return { status: 'FAIL', err: error };
    return { status: 'OK', ...tallyRoles((data.content || []).map(j => ({ title: j.name, loc: [j.location?.city, j.location?.country].filter(Boolean).join(', ') }))) };
  }
  if (provider === 'recruitee') {
    const sub = slug.replace(/\..*/, '');
    const { data, error } = await getJson(`https://${sub}.recruitee.com/api/offers/`);
    if (error) return { status: 'FAIL', err: error };
    return { status: 'OK', ...tallyRoles((data.offers || []).map(j => ({ title: j.title, loc: [j.city, j.country_code].filter(Boolean).join(', ') }))) };
  }
  if (provider === 'workday') {
    const [tenant, wd, site] = slug.split('|');
    if (!tenant || !wd || !site) return { status: 'bad-workday-slug' };
    const url = `https://${tenant}.${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
    let total = null; const rows = [];
    for (let off = 0; off < 400; off += 20) { // Workday caps limit at 20; total on page 1 only
      const { data, error } = await getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: off, searchText: '' }) });
      if (error) { if (off === 0) return { status: 'FAIL', err: error }; break; }
      if (off === 0) total = data.total ?? 0;
      const batch = data.jobPostings || [];
      if (!batch.length) break;
      for (const j of batch) rows.push({ title: j.title, loc: j.locationsText });
      if (total != null && off + 20 >= total) break;
    }
    return { status: 'OK', total: total ?? rows.length, ...tallyRoles(rows), note: `scanned ${rows.length}` };
  }
  return { status: 'unsupported-provider' };
}

// ── CLI ─────────────────────────────────────────────────────────────

async function loadCandidates(args) {
  const urlFlag = args.indexOf('--url');
  if (urlFlag !== -1) {
    const u = args[urlFlag + 1];
    return [{ name: u, careers_url: u }];
  }
  if (args.includes('--portals')) {
    const YAML = (await import('js-yaml')).default;
    const cfg = YAML.load(fs.readFileSync(path.join(ROOT, 'portals.yml'), 'utf8'));
    // Only API-backed companies — websearch-lane entries aren't ATS-scannable by design.
    return (cfg.tracked_companies || [])
      .filter(c => c.enabled !== false && c.scan_method !== 'websearch')
      .map(c => ({ name: c.name, careers_url: c.careers_url, api: c.api }));
  }
  const file = args.find(a => a.endsWith('.json'));
  if (!file) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(raw) ? raw : (raw.companies || []);
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const cands = await loadCandidates(args);
  if (!cands) {
    console.error('usage: verify-ats.mjs --portals | <candidates.json> | --url <careers_url>  [--json]');
    process.exit(1);
  }

  const out = [];
  const LIMIT = 6;
  let idx = 0;
  async function worker() {
    while (idx < cands.length) {
      const i = idx++;
      const c = cands[i];
      let provider = c.ats_provider, slug = c.slug;
      if (!provider || !slug) {
        const d = deriveAts(c.careers_url, c.api);
        if (!d) { out[i] = { ...c, status: 'no-ats-detected' }; continue; }
        provider = d.provider; slug = d.slug;
      }
      out[i] = { ...c, ats_provider: provider, slug, ...(await verifyOne(provider, slug)) };
    }
  }
  await Promise.all(Array.from({ length: LIMIT }, worker));

  if (asJson) { console.log(JSON.stringify(out, null, 2)); return; }

  out.sort((a, b) => (b.caTarget || 0) - (a.caTarget || 0));
  const ok = out.filter(o => o.status === 'OK');
  const dead = out.filter(o => o.status && o.status !== 'OK');
  console.log(`\n=== ${ok.length} reachable · ${dead.length} dead/unknown ===`);
  for (const o of out) {
    const tag = o.status === 'OK' ? `total=${o.total} target=${o.target} CA-target=${o.caTarget}` : o.status + (o.err ? ` (${o.err})` : '');
    console.log(`${String(o.caTarget || 0).padStart(3)} | ${(o.ats_provider || '?').padEnd(15)} | ${(o.name || '').slice(0, 30).padEnd(30)} | ${tag}`);
    if (o.samples?.length) console.log(`      e.g. ${o.samples.join(' · ')}`);
  }
  if (dead.length) {
    console.log(`\n⚠ DEAD / EMPTY (review or disable in portals.yml):`);
    for (const o of dead) console.log(`   - ${o.name} [${o.ats_provider || '?'}] ${o.status}${o.err ? ` (${o.err})` : ''}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
