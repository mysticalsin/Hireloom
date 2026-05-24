#!/usr/bin/env node
// Pull JDs for the 21 stragglers (native-ATS pages that were mislabeled "indeed"
// with no job URL in the indeed field). All public, no login — generic Playwright
// text extraction with a Greenhouse-API fallback. Saves to output/pool-jds/<rank>.json.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';

const EXE = process.env.PW_CHROMIUM_PATH || '';
const OUT = 'output/pool-jds';
mkdirSync(OUT, { recursive: true });

const pool = JSON.parse(readFileSync('output/pool-apply-order.json', 'utf8'));
const have = new Set((existsSync(OUT) ? readdirSync(OUT) : []).map(f => parseInt(f)));
const targets = pool.rows.filter(r => !have.has(r.rank) && r.url).sort((a, b) => a.rank - b.rank);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const stripHtml = h => h.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();

// Greenhouse content API fallback when a gh_jid is present
async function greenhouseApi(url, company) {
  const id = (url.match(/gh_jid=(\d+)/) || url.match(/\/jobs\/(\d+)/) || [])[1];
  if (!id) return '';
  const slugFromUrl = (url.match(/greenhouse\.io\/([^/]+)\/jobs/) || [])[1];
  const guesses = [slugFromUrl, company.toLowerCase().replace(/[^a-z0-9]/g, ''), company.toLowerCase().split(/\s+/)[0]].filter(Boolean);
  for (const slug of [...new Set(guesses)]) {
    try {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}?content=true`);
      if (res.ok) { const j = await res.json(); if (j.content) return stripHtml(j.content); }
    } catch {}
  }
  return '';
}

const ctx = await chromium.launch({ headless: true, ...(EXE ? { executablePath: EXE } : {}) });
const page = await ctx.newPage();
let ok = 0, fail = 0;
console.log(`\n▶ pulling ${targets.length} straggler JDs\n`);

for (const r of targets) {
  let jd = '';
  try {
    await page.goto(r.url, { waitUntil: 'networkidle', timeout: 40000 }).catch(() => {});
    await sleep(1800);
    jd = await page.evaluate(() => {
      const sels = ['#content', '.job__description', '.posting-page', '[class*="ashby"][class*="ApplicationForm"]',
        '[data-testid="job-description"]', '.sr-jobad', '.job-description', '#job-details', 'main', 'article'];
      let best = '';
      for (const s of sels) for (const el of document.querySelectorAll(s)) {
        const t = (el.innerText || '').trim();
        if (t.length > best.length) best = t;
      }
      if (best.length < 300) { const b = (document.body.innerText || '').trim(); if (b.length > best.length) best = b; }
      return best;
    }).catch(() => '');
  } catch {}

  if (jd.length < 300 && /greenhouse|gh_jid/.test(r.url)) {
    const api = await greenhouseApi(r.url, r.company);
    if (api.length > jd.length) jd = api;
  }

  const outPath = `${OUT}/${String(r.rank).padStart(3, '0')}.json`;
  if (jd.length >= 200) {
    writeFileSync(outPath, JSON.stringify({ rank: r.rank, company: r.company, title: r.title, url: r.url, jd, status: 'ok', pulledAt: new Date().toISOString() }, null, 2));
    ok++; console.log(`  ✓ #${r.rank} ${r.company} — ${jd.length} chars`);
  } else {
    writeFileSync(outPath, JSON.stringify({ rank: r.rank, company: r.company, title: r.title, url: r.url, jd, status: 'thin', pulledAt: new Date().toISOString() }, null, 2));
    fail++; console.log(`  ⚠ #${r.rank} ${r.company} — only ${jd.length} chars (SPA/blocked), saved as thin`);
  }
  await sleep(600);
}
await ctx.close();
console.log(`\n✅ stragglers: ${ok} good, ${fail} thin. JD store now complete-ish.`);
