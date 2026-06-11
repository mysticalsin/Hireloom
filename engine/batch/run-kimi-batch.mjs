#!/usr/bin/env node
// Kimi batch — tailors resume + cover for every tier-2 ("kimi") role to its saved JD.
// Resumable (skips roles already rendered), 429-aware:
//   • transient rate-limit  -> wait Retry-After/60s, retry same role (up to 4x)
//   • usage/quota limit      -> STOP CLEAN, write a handoff list for Claude, exit 7
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { kimiTailor, normalizeContent, renderRoleBoth } from './tailor-engine.mjs';

const pool = JSON.parse(readFileSync('output/pool-apply-order.json', 'utf8'));
const cv = readFileSync('cv.md', 'utf8');
const DONE = 'output/tailored-content'; mkdirSync(DONE, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const roles = pool.rows.filter(r => r.tailor === 'kimi').sort((a, b) => a.rank - b.rank);
const isDoneRank = r => existsSync(`${DONE}/${String(r.rank).padStart(3, '0')}.json`);

// usage-limit signatures (persistent — waiting won't help)
const USAGE_RE = /quota|credit|insufficient|exceeded your|billing|out of|depleted|spending limit/i;

let done = 0, skipped = 0, failed = 0;
const todo = roles.filter(r => !isDoneRank(r));
console.log(`\n▶ Kimi batch: ${todo.length} to tailor (${roles.length - todo.length} already done) of ${roles.length} tier-2 roles\n`);

for (const r of roles) {
  if (isDoneRank(r)) { skipped++; continue; }
  const jdPath = `output/pool-jds/${String(r.rank).padStart(3, '0')}.json`;
  if (!existsSync(jdPath)) { console.log(`  ⚠ #${r.rank} ${r.company} — no JD on disk, skipping`); failed++; continue; }
  const jd = JSON.parse(readFileSync(jdPath, 'utf8')).jd || '';

  // attempt = malformed/parse retries (cap 4). rateHits = rate-limit waits (very patient,
  // since the user is fine waiting out the cap). Only an explicit usage/quota signal, or an
  // extreme cumulative wait, is treated as terminal.
  let content = null, attempt = 0, rateHits = 0;
  while (!content && attempt < 4) {
    try {
      content = normalizeContent(await kimiTailor(cv, jd, r.title, r.company));
    } catch (e) {
      if (e.code === 429) {
        if (USAGE_RE.test(e.bodyText || '')) { // genuine quota exhaustion -> stop clean
          const remaining = roles.filter(x => !isDoneRank(x)).map(x => x.rank);
          writeFileSync('output/kimi-handoff.json', JSON.stringify({ reason: 'usage-limit', stoppedAt: r.rank, remaining, when: new Date().toISOString(), bodyText: (e.bodyText || '').slice(0, 300) }, null, 2));
          console.log(`\n🛑 USAGE/QUOTA limit at #${r.rank}. ${remaining.length} roles remaining (output/kimi-handoff.json). Stopping clean.`);
          process.exit(7);
        }
        rateHits++;
        if (rateHits > 25) { // ~hours of waiting exhausted — pause clean, resumable on re-run
          const remaining = roles.filter(x => !isDoneRank(x)).map(x => x.rank);
          writeFileSync('output/kimi-handoff.json', JSON.stringify({ reason: 'persistent-429-paused', stoppedAt: r.rank, remaining, when: new Date().toISOString() }, null, 2));
          console.log(`\n🛑 rate-limit would not clear after ${rateHits} waits at #${r.rank}. Paused clean — re-run to resume.`);
          process.exit(7);
        }
        // escalating backoff, respecting Retry-After; cap 300s (5-min cache-aligned)
        const wait = (parseInt(e.retryAfter) || Math.min(45 * rateHits, 300)) * 1000;
        console.log(`  ⏳ #${r.rank} rate-limited (wait ${rateHits}, ${wait / 1000}s)…`);
        await sleep(wait); // does NOT consume the malformed-retry budget
      } else {
        attempt++;
        console.log(`  ✗ #${r.rank} ${r.company} — ${e.message} (retry ${attempt})`);
        await sleep(3000);
      }
    }
  }
  if (!content) {
    failed++;
    const fp = 'output/kimi-failures.json';
    const list = existsSync(fp) ? JSON.parse(readFileSync(fp, 'utf8')) : [];
    if (!list.includes(r.rank)) { list.push(r.rank); writeFileSync(fp, JSON.stringify(list, null, 2)); }
    console.log(`  ✗✗ #${r.rank} ${r.company} — failed after retries, recorded for follow-up`);
    continue;
  }

  // render FIRST, then write the done-marker — so a render failure never marks a role complete
  await renderRoleBoth(content, r);
  writeFileSync(`${DONE}/${String(r.rank).padStart(3, '0')}.json`, JSON.stringify(content, null, 2));
  done++;
  console.log(`  ✓ [${done + skipped}/${roles.length}] #${r.rank} ${r.company} — ${r.title.slice(0, 50)}`);
  await sleep(6000); // spacing between roles to stay under NIM's per-minute token/burst cap
}

console.log(`\n✅ Kimi batch complete: ${done} tailored, ${skipped} already done, ${failed} failed.`);
