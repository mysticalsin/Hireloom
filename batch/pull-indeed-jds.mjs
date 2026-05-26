#!/usr/bin/env node
// Phase 1 — pull full JD text for every Indeed pool role using the logged-in
// .indeed-profile session. Saves one JSON per role to output/pool-jds/<rank>.json
// (resumable: already-saved ranks are skipped). Captcha-aware: if the JD doesn't
// load, it WAITS (polling) for the user to solve the challenge in the visible
// window, then continues automatically.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const EXE = process.env.PW_CHROMIUM_PATH || '';
const OUT = 'output/pool-jds';
mkdirSync(OUT, { recursive: true });

const pool = JSON.parse(readFileSync('output/pool-apply-order.json', 'utf8'));
const roles = pool.rows
  .filter(r => r.ats === 'indeed' && r.indeed)
  .sort((a, b) => a.rank - b.rank);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a));

const ctx = await chromium.launchPersistentContext('.indeed-profile', {
  headless: false, ...(EXE ? { executablePath: EXE } : {}),
  viewport: null,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
});
const page = ctx.pages()[0] || await ctx.newPage();

let done = 0, skipped = 0, captchas = 0, expired = 0;
const total = roles.length;
console.log(`\n▶ Indeed JD pull — ${total} roles with job URLs\n`);

for (const r of roles) {
  const outPath = `${OUT}/${String(r.rank).padStart(3, '0')}.json`;
  if (existsSync(outPath)) { skipped++; continue; }

  await page.goto(r.indeed, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(rnd(1200, 2600));

  // try to read the JD; if absent, assume captcha/login and wait for the user
  const readJd = async () => {
    try {
      return await page.evaluate(() => {
        const el = document.querySelector('#jobDescriptionText') ||
                   document.querySelector('[id*="jobDescription"]') ||
                   document.querySelector('.jobsearch-JobComponent-description');
        return el ? el.innerText.trim() : '';
      });
    } catch { return ''; }
  };

  let jd = await readJd();
  if (!jd) {
    captchas++;
    console.log(`  🔵 #${r.rank} ${r.company} — JD not visible (captcha/login?). SOLVE IT IN THE WINDOW; I'll wait…`);
    const deadline = Date.now() + 8 * 60 * 1000; // up to 8 min for the user
    while (!jd && Date.now() < deadline) {
      await sleep(2500);
      jd = await readJd();
    }
    if (jd) console.log(`  ✅ #${r.rank} resumed after solve`);
  }

  if (!jd) {
    // give up on this one — likely expired posting or hard block
    expired++;
    writeFileSync(outPath, JSON.stringify({
      rank: r.rank, company: r.company, title: r.title, url: r.indeed,
      jd: '', status: 'unavailable', pulledAt: new Date().toISOString(),
    }, null, 2));
    console.log(`  ⚠ #${r.rank} ${r.company} — no JD (expired/blocked), saved empty`);
  } else {
    writeFileSync(outPath, JSON.stringify({
      rank: r.rank, company: r.company, title: r.title, url: r.indeed,
      jd, status: 'ok', pulledAt: new Date().toISOString(),
    }, null, 2));
    done++;
    if (done % 5 === 0 || done < 5)
      console.log(`  [${done + skipped + expired}/${total}] #${r.rank} ${r.company} — saved (${jd.length} chars)`);
  }

  await sleep(rnd(1500, 3500)); // pace to reduce captcha frequency
}

console.log(`\n✅ Indeed JD pull complete: ${done} pulled, ${skipped} already had, ${expired} unavailable, ${captchas} captcha pauses.`);
console.log(`   Saved to ${OUT}/. Leaving browser open — close it when ready.`);
await new Promise(() => {});
