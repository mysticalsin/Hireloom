#!/usr/bin/env node

/**
 * liveness-sweep.mjs — bulk liveness check of the pending apply queue via ATS APIs
 *
 * Walks output/pool-apply-order.json and checks every PENDING row (no status)
 * whose URL points at a Greenhouse / Ashby / Lever posting — including
 * company-hosted Greenhouse pages (?gh_jid=...) by resolving the board token
 * from the company name. One API call per board/org (cached), zero browser,
 * zero LLM tokens. Indeed/Google-placeholder rows are reported as unchecked.
 *
 * Usage:
 *   node engine/scan/liveness-sweep.mjs            # dry run — report only
 *   node engine/scan/liveness-sweep.mjs --write    # stamp expired rows in pool-apply-order.json
 *   node engine/scan/liveness-sweep.mjs --json     # machine-readable output
 *
 * Verdicts:
 *   live     — posting present in the ATS board feed
 *   expired  — board feed reachable but the posting is gone
 *   unknown  — board not resolvable / fetch error (NOT marked dead)
 *
 * --write sets status: "expired" (+ livenessCheckedAt) on expired rows so the
 * queue self-cleans; live rows get livenessCheckedAt only. Unknown rows are
 * never written — absence of proof is not proof of absence.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const POOL_PATH = join(ROOT, 'output', 'pool-apply-order.json');

const WRITE = process.argv.includes('--write');
const AS_JSON = process.argv.includes('--json');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function classifyUrl(row) {
  const url = row.url || '';
  let m;
  if ((m = url.match(/(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/))) {
    return { ats: 'greenhouse', board: m[1].toLowerCase(), jobId: m[2] };
  }
  if ((m = url.match(/[?&]gh_jid=(\d+)/))) {
    return { ats: 'greenhouse', board: null, jobId: m[1], guessBoard: true };
  }
  if ((m = url.match(new RegExp(`jobs\\.ashbyhq\\.com/([^/?#]+)/(${UUID})`)))) {
    return { ats: 'ashby', board: m[1], jobId: m[2] };
  }
  if ((m = url.match(new RegExp(`jobs\\.lever\\.co/([^/?#]+)/(${UUID})`)))) {
    return { ats: 'lever', board: m[1], jobId: m[2] };
  }
  return null;
}

// Board-token guesses for company-hosted Greenhouse pages (?gh_jid= with no
// board in the URL): "PointClickCare Inc." → pointclickcare, pointclickcareinc...
function boardGuesses(company) {
  const base = company.toLowerCase().replace(/&/g, 'and');
  const stripped = base.replace(/\b(inc|llc|ltd|corp|co|limited|technologies|technology|labs)\b\.?/g, '');
  const variants = [stripped, base]
    .map((s) => s.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
  const firstWord = base.split(/[^a-z0-9]+/).filter(Boolean)[0];
  if (firstWord) variants.push(firstWord);
  return [...new Set(variants)];
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return { status: res.status, json: null };
  return { status: res.status, json: await res.json() };
}

// One feed fetch per board/org, shared by every row on that board.
const feedCache = new Map();
async function boardIds(ats, board) {
  const key = `${ats}:${board}`;
  if (feedCache.has(key)) return feedCache.get(key);
  const promise = (async () => {
    try {
      if (ats === 'greenhouse') {
        const { status, json } = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`);
        if (status === 404) return null; // board doesn't exist
        if (!json) throw new Error(`HTTP ${status}`);
        return new Set(json.jobs.map((j) => String(j.id)));
      }
      if (ats === 'ashby') {
        const { status, json } = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${board}`);
        if (status === 404) return null;
        if (!json) throw new Error(`HTTP ${status}`);
        return new Set((json.jobs || []).map((j) => String(j.id)));
      }
      if (ats === 'lever') {
        const { status, json } = await fetchJson(`https://api.lever.co/v0/postings/${board}?mode=json`);
        if (status === 404) return null;
        if (!json) throw new Error(`HTTP ${status}`);
        return new Set(json.map((j) => String(j.id)));
      }
      return null;
    } catch (e) {
      return { error: String(e.message || e) };
    }
  })();
  feedCache.set(key, promise);
  return promise;
}

async function checkRow(row) {
  const target = classifyUrl(row);
  if (!target) return { verdict: 'unchecked', reason: 'no ATS API for this URL' };

  const boards = target.guessBoard ? boardGuesses(row.company) : [target.board];
  let sawError = null;
  for (const board of boards) {
    const ids = await boardIds(target.ats, board);
    if (ids === null) continue; // board doesn't exist under this token
    if (ids.error) { sawError = ids.error; continue; }
    return ids.has(target.jobId)
      ? { verdict: 'live', ats: target.ats, board }
      : { verdict: 'expired', ats: target.ats, board };
  }
  return {
    verdict: 'unknown',
    ats: target.ats,
    reason: sawError || (target.guessBoard ? `board not found (tried: ${boards.join(', ')})` : 'board not found'),
  };
}

async function main() {
  const pool = JSON.parse(readFileSync(POOL_PATH, 'utf8'));
  const pending = pool.rows.filter((r) => !r.status);

  const results = [];
  const CONCURRENCY = 8;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < pending.length) {
        const row = pending[cursor++];
        const result = await checkRow(row);
        results.push({ rank: row.rank, company: row.company, title: row.title, ...result });
        if (!AS_JSON && results.length % 25 === 0) {
          console.error(`  …${results.length}/${pending.length} checked`);
        }
      }
    })
  );
  results.sort((a, b) => a.rank - b.rank);

  const counts = {};
  for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1;

  const checkedAt = new Date().toISOString();
  if (WRITE) {
    const byRank = new Map(results.map((r) => [r.rank, r]));
    for (const row of pool.rows) {
      const r = byRank.get(row.rank);
      if (!r) continue;
      if (r.verdict === 'expired') {
        row.status = 'expired';
        row.livenessCheckedAt = checkedAt;
      } else if (r.verdict === 'live') {
        row.livenessCheckedAt = checkedAt;
      }
    }
    writeFileSync(POOL_PATH, JSON.stringify(pool, null, 2) + '\n');
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ checkedAt, counts, written: WRITE, results }, null, 2));
    return;
  }

  console.log(`\nLiveness sweep — ${pending.length} pending rows`);
  for (const [verdict, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${verdict.padEnd(10)} ${n}`);
  }
  const expired = results.filter((r) => r.verdict === 'expired');
  if (expired.length) {
    console.log(`\nExpired:`);
    for (const r of expired) console.log(`  rank ${String(r.rank).padStart(3)}  ${r.company} — ${r.title}`);
  }
  const unknown = results.filter((r) => r.verdict === 'unknown');
  if (unknown.length) {
    console.log(`\nUnknown (not marked, verify manually if they matter):`);
    for (const r of unknown) console.log(`  rank ${String(r.rank).padStart(3)}  ${r.company} — ${r.reason}`);
  }
  console.log(WRITE ? '\nExpired rows stamped in pool-apply-order.json.' : '\nDry run — re-run with --write to stamp expired rows.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
