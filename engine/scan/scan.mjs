#!/usr/bin/env node

/**
 * scan.mjs — Zero-token portal scanner
 *
 * Fetches Greenhouse, Ashby, and Lever APIs directly, applies title
 * filters from portals.yml, deduplicates against existing history,
 * and appends new offers to pipeline.md + scan-history.tsv.
 *
 * Zero Claude API tokens — pure HTTP + JSON.
 *
 * Usage:
 *   node engine/scan/scan.mjs                  # scan all enabled companies
 *   node engine/scan/scan.mjs --dry-run        # preview without writing files
 *   node engine/scan/scan.mjs --company Cohere # scan a single company
 *   node engine/scan/scan.mjs --max-age 21     # only roles posted in the last 21 days
 *   node engine/scan/scan.mjs --since 2026-06-01  # only roles posted on/after a date
 *   node engine/scan/scan.mjs --max-age 21 --strict-age  # also drop unknown-date roles
 *
 * Freshness: --max-age/--since filter to newly-posted roles using each ATS's own
 * posting date (Greenhouse first_published, Ashby publishedAt, Lever createdAt,
 * Workday startDate/"Posted N Days Ago"). Roles with no detectable date are KEPT
 * and flagged "date unknown" unless --strict-age is set. Results sort newest-first.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import yaml from 'js-yaml';
const parseYaml = yaml.load;

// ── Config ──────────────────────────────────────────────────────────

const PORTALS_PATH = 'portals.yml';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';

// Ensure required directories exist (fresh setup)
mkdirSync('data', { recursive: true });

const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 10_000;

// ── API detection ───────────────────────────────────────────────────

function detectApi(company) {
  // Greenhouse: explicit api field
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
  }

  const url = company.careers_url || '';

  // Ashby
  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashbyMatch) {
    return {
      type: 'ashby',
      url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true`,
    };
  }

  // Lever
  const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (leverMatch) {
    return {
      type: 'lever',
      url: `https://api.lever.co/v0/postings/${leverMatch[1]}`,
    };
  }

  // Greenhouse EU boards
  const ghEuMatch = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (ghEuMatch && !company.api) {
    return {
      type: 'greenhouse',
      url: `https://boards-api.greenhouse.io/v1/boards/${ghEuMatch[1]}/jobs`,
    };
  }

  // Workday (paginated POST to the cxs endpoint). Accepts either a public board
  // URL like https://{tenant}.{shard}.myworkdayjobs.com/{site} (optionally with a
  // /{locale}/ prefix) or a direct .../wday/cxs/{tenant}/{site}/jobs URL.
  const wdMatch = url.match(/https?:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:wday\/cxs\/[^/]+\/([^/]+)\/jobs|(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+))/);
  if (wdMatch) {
    return {
      type: 'workday',
      host: `${wdMatch[1]}.${wdMatch[2]}.myworkdayjobs.com`,
      tenant: wdMatch[1],
      site: wdMatch[3] || wdMatch[4],
    };
  }

  return null;
}

// ── API parsers ─────────────────────────────────────────────────────

function parseGreenhouse(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    company: companyName,
    location: j.location?.name || '',
    posted: j.first_published || j.updated_at || null,
  }));
}

function parseAshby(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.jobUrl || '',
    company: companyName,
    location: j.location || '',
    posted: j.publishedAt || null,
  }));
}

function parseLever(json, companyName) {
  if (!Array.isArray(json)) return [];
  return json.map(j => ({
    title: j.text || '',
    url: j.hostedUrl || '',
    company: companyName,
    location: j.categories?.location || '',
    posted: j.createdAt ? new Date(j.createdAt).toISOString() : null,
  }));
}

const PARSERS = { greenhouse: parseGreenhouse, ashby: parseAshby, lever: parseLever };

// ── Posting-date helpers (freshness) ────────────────────────────────

// Workday gives either an ISO startDate or relative text ("Posted Today",
// "Posted 5 Days Ago", "Posted 30+ Days Ago"). Return an ISO date or null.
function parseWorkdayPosted(j) {
  if (j.startDate) return j.startDate;
  const t = (j.postedOn || '').toLowerCase();
  if (!t) return null;
  const d = new Date();
  if (t.includes('today')) return d.toISOString();
  if (t.includes('yesterday')) { d.setDate(d.getDate() - 1); return d.toISOString(); }
  const day = t.match(/(\d+)\+?\s*day/);
  if (day) { d.setDate(d.getDate() - parseInt(day[1], 10)); return d.toISOString(); }
  const mon = t.match(/(\d+)\+?\s*month/);
  if (mon) { d.setMonth(d.getMonth() - parseInt(mon[1], 10)); return d.toISOString(); }
  return null;
}

function daysSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

function fmtPosted(iso) {
  if (!iso) return 'date unknown';
  const d = daysSince(iso);
  return d === null ? iso.slice(0, 10) : `${iso.slice(0, 10)} (${d}d ago)`;
}

// ── Fetch with timeout ──────────────────────────────────────────────

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Workday fetch (paginated POST) ──────────────────────────────────
// Workday exposes a public JSON endpoint at /wday/cxs/{tenant}/{site}/jobs that
// takes a POST body and returns { total, jobPostings:[{title, externalPath,
// locationsText}] }. We page through it (20 at a time) and build public URLs.

const WORKDAY_PAGE = 20;
const WORKDAY_MAX = 1000; // safety cap on jobs per company

async function fetchWorkdayJobs(api, companyName) {
  const { host, tenant, site } = api;
  const cxs = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
  const out = [];
  let offset = 0;
  let total = null; // Workday reports the real total only on the first page

  while (offset < WORKDAY_MAX) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let json;
    try {
      const res = await fetch(cxs, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: WORKDAY_PAGE, offset, searchText: '' }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }

    if (offset === 0) total = json.total ?? 0; // capture once; later pages report 0
    const posts = json.jobPostings || [];
    if (posts.length === 0) break;

    for (const j of posts) {
      out.push({
        title: j.title || '',
        url: `https://${host}/${site}${j.externalPath || ''}`,
        company: companyName,
        location: j.locationsText || '',
        posted: parseWorkdayPosted(j),
      });
    }
    offset += WORKDAY_PAGE;
    if (total != null && offset >= total) break;
  }
  return out;
}

// ── Title filter ────────────────────────────────────────────────────

function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map(k => k.toLowerCase());
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase());

  return (title) => {
    const lower = title.toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(k => lower.includes(k));
    const hasNegative = negative.some(k => lower.includes(k));
    return hasPositive && !hasNegative;
  };
}

// ── Location filter (v1.8.0) ────────────────────────────────────────
// Keeps jobs whose location matches the user's eligibility. A job with an
// empty/unknown location passes (let the pipeline decide). A negative match
// always rejects, even if a positive keyword is also present.

function buildLocationFilter(locationFilter) {
  const positive = (locationFilter?.positive || []).map(k => k.toLowerCase());
  const negative = (locationFilter?.negative || []).map(k => k.toLowerCase());

  // No positive keywords configured → feature off, keep everything.
  if (positive.length === 0) return () => true;

  return (location) => {
    const loc = (location || '').trim().toLowerCase();
    if (!loc) return true; // unknown location → don't filter out
    if (negative.some(k => loc.includes(k))) return false;
    return positive.some(k => loc.includes(k));
  };
}

// ── Dedup ───────────────────────────────────────────────────────────

function loadSeenUrls() {
  const seen = new Set();

  // scan-history.tsv
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) { // skip header
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }

  // pipeline.md — extract URLs from checkbox lines
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seen.add(match[1]);
    }
  }

  // applications.md — extract URLs from report links and any inline URLs
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(match[0]);
    }
  }

  return seen;
}

function loadSeenCompanyRoles() {
  const seen = new Set();
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    // Parse markdown table rows: | # | Date | Company | Role | ...
    for (const match of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
      const company = match[1].trim().toLowerCase();
      const role = match[2].trim().toLowerCase();
      if (company && role && company !== 'company') {
        seen.add(`${company}::${role}`);
      }
    }
  }
  return seen;
}

// ── Pipeline writer ─────────────────────────────────────────────────

function appendToPipeline(offers) {
  if (offers.length === 0) return;

  let text = readFileSync(PIPELINE_PATH, 'utf-8');

  // Find "## Pendientes" section and append after it
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    // No Pendientes section — append at end before Procesadas
    const procIdx = text.indexOf('## Procesadas');
    const insertAt = procIdx === -1 ? text.length : procIdx;
    const block = `\n${marker}\n\n` + offers.map(o =>
      `- [ ] ${o.url} | ${o.company} | ${o.title} | posted ${o.posted ? o.posted.slice(0, 10) : '?'}`
    ).join('\n') + '\n\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  } else {
    // Find the end of existing Pendientes content (next ## or end)
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;

    const block = '\n' + offers.map(o =>
      `- [ ] ${o.url} | ${o.company} | ${o.title} | posted ${o.posted ? o.posted.slice(0, 10) : '?'}`
    ).join('\n') + '\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }

  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  // Ensure file + header exist
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tlocation\tstatus\n', 'utf-8');
  }

  const lines = offers.map(o =>
    `${o.url}\t${date}\t${o.source}\t${o.title}\t${o.company}\t${o.location || ''}\tadded`
  ).join('\n') + '\n';

  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

// ── Parallel fetch with concurrency limit ───────────────────────────

async function parallelFetch(tasks, limit) {
  const results = [];
  let i = 0;

  async function next() {
    while (i < tasks.length) {
      const task = tasks[i++];
      results.push(await task());
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const companyFlag = args.indexOf('--company');
  const filterCompany = companyFlag !== -1 ? args[companyFlag + 1]?.toLowerCase() : null;

  // Freshness filter: --max-age <days> or --since <YYYY-MM-DD>. null = no age filter.
  const maxAgeFlag = args.indexOf('--max-age');
  const maxAge = maxAgeFlag !== -1 ? parseInt(args[maxAgeFlag + 1], 10) : null;
  const sinceFlag = args.indexOf('--since');
  const since = sinceFlag !== -1 ? args[sinceFlag + 1] : null;
  const strictAge = args.includes('--strict-age');
  let ageCutoff = null;
  if (since && !Number.isNaN(Date.parse(since))) ageCutoff = Date.parse(since);
  else if (maxAge != null && !Number.isNaN(maxAge)) ageCutoff = Date.now() - maxAge * 86400000;

  // 1. Read portals.yml
  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first.');
    process.exit(1);
  }

  const config = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  const companies = config.tracked_companies || [];
  const titleFilter = buildTitleFilter(config.title_filter);
  const locationFilter = buildLocationFilter(config.location_filter);
  const locationFilterActive = (config.location_filter?.positive || []).length > 0;

  // 2. Filter to enabled companies with detectable APIs
  const targets = companies
    .filter(c => c.enabled !== false)
    .filter(c => !filterCompany || c.name.toLowerCase().includes(filterCompany))
    .map(c => ({ ...c, _api: detectApi(c) }))
    .filter(c => c._api !== null);

  const skippedCount = companies.filter(c => c.enabled !== false).length - targets.length;

  console.log(`Scanning ${targets.length} companies via API (${skippedCount} skipped — no API detected)`);
  if (dryRun) console.log('(dry run — no files will be written)\n');

  // 3. Load dedup sets
  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();

  // 4. Fetch all APIs
  const date = new Date().toISOString().slice(0, 10);
  let totalFound = 0;
  let totalFiltered = 0;
  let totalLocationFiltered = 0;
  let totalDupes = 0;
  let totalStale = 0;
  const newOffers = [];
  const errors = [];

  const tasks = targets.map(company => async () => {
    const api = company._api;
    try {
      let jobs;
      if (api.type === 'workday') {
        jobs = await fetchWorkdayJobs(api, company.name);
      } else {
        const json = await fetchJson(api.url);
        jobs = PARSERS[api.type](json, company.name);
      }
      totalFound += jobs.length;

      for (const job of jobs) {
        if (!titleFilter(job.title)) {
          totalFiltered++;
          continue;
        }
        if (!locationFilter(job.location)) {
          totalLocationFiltered++;
          continue;
        }
        if (seenUrls.has(job.url)) {
          totalDupes++;
          continue;
        }
        const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
        if (seenCompanyRoles.has(key)) {
          totalDupes++;
          continue;
        }
        // Freshness: drop roles posted before the cutoff. Unknown-date roles are
        // kept (and flagged later) unless --strict-age is set.
        if (ageCutoff != null) {
          const postedMs = job.posted ? Date.parse(job.posted) : NaN;
          if (Number.isNaN(postedMs)) {
            if (strictAge) { totalStale++; continue; }
          } else if (postedMs < ageCutoff) {
            totalStale++;
            continue;
          }
        }
        // Mark as seen to avoid intra-scan dupes
        seenUrls.add(job.url);
        seenCompanyRoles.add(key);
        newOffers.push({ ...job, source: `${api.type}-api` });
      }
    } catch (err) {
      errors.push({ company: company.name, error: err.message });
    }
  });

  await parallelFetch(tasks, CONCURRENCY);

  // Sort newest-first; unknown-date roles sink to the bottom.
  newOffers.sort((a, b) => {
    const ta = a.posted ? Date.parse(a.posted) : -Infinity;
    const tb = b.posted ? Date.parse(b.posted) : -Infinity;
    return (Number.isNaN(tb) ? -Infinity : tb) - (Number.isNaN(ta) ? -Infinity : ta);
  });

  // 5. Write results
  if (!dryRun && newOffers.length > 0) {
    appendToPipeline(newOffers);
    appendToScanHistory(newOffers, date);
  }

  // 6. Print summary
  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Portal Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  console.log(`Companies scanned:     ${targets.length}`);
  console.log(`Total jobs found:      ${totalFound}`);
  console.log(`Filtered by title:     ${totalFiltered} removed`);
  if (locationFilterActive) {
    console.log(`Filtered by location:  ${totalLocationFiltered} removed`);
  }
  console.log(`Duplicates:            ${totalDupes} skipped`);
  if (ageCutoff != null) {
    const label = since ? `before ${since}` : `older than ${maxAge}d`;
    console.log(`Filtered by age:       ${totalStale} removed (${label}${strictAge ? ', + unknown-date' : ''})`);
  }
  console.log(`New offers added:      ${newOffers.length}`);

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ✗ ${e.company}: ${e.error}`);
    }
  }

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers) {
      console.log(`  + ${o.company} | ${o.title} | ${o.location || 'N/A'} | ${fmtPosted(o.posted)}`);
    }
    if (dryRun) {
      console.log('\n(dry run — run without --dry-run to save results)');
    } else {
      console.log(`\nResults saved to ${PIPELINE_PATH} and ${SCAN_HISTORY_PATH}`);
    }
  }

  console.log(`\n→ Run /career-ops pipeline to evaluate new offers.`);
  console.log('→ Share results and get help: https://discord.gg/3jEjwygjNG');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
