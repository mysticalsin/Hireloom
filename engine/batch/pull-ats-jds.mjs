#!/usr/bin/env node
// Phase 2 — fetch full JD text for native-ATS pool roles (Greenhouse / Lever /
// Ashby) via their board APIs. Pure HTTP, no browser. Saves one JSON per role to
// output/pool-jds/<rank>.json (resumable). Groups by board so each board is
// fetched once, then matches each role's posting by job id (fallback: title).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const OUT = 'output/pool-jds';
mkdirSync(OUT, { recursive: true });
const pool = JSON.parse(readFileSync('output/pool-apply-order.json', 'utf8'));

const NATIVE = new Set(['greenhouse', 'lever', 'ashby']);
const rows = pool.rows.filter(r => NATIVE.has(r.ats) && r.url);

const slugOf = (url) => {
  let m;
  if ((m = url.match(/greenhouse\.io\/(?:embed\/job_board\?for=)?([^/?#\s]+)/))) return m[1];
  if ((m = url.match(/lever\.co\/([^/?#\s]+)/))) return m[1];
  if ((m = url.match(/ashbyhq\.com\/([^/?#\s]+)/))) return m[1];
  return '';
};
const idOf = (url) => {
  let m;
  if ((m = url.match(/greenhouse\.io\/[^/]+\/jobs\/(\d+)/))) return m[1];           // numeric
  if ((m = url.match(/(?:lever\.co|ashbyhq\.com)\/[^/]+\/([0-9a-f-]{8,})/i))) return m[1]; // uuid
  return '';
};
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function getJSON(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function fetchBoard(ats, slug) {
  if (ats === 'greenhouse') {
    const d = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
    return d?.jobs?.map(j => ({ id: String(j.id), title: j.title || '', url: j.absolute_url || '',
      text: (j.content || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim() }));
  }
  if (ats === 'lever') {
    const d = await getJSON(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    return Array.isArray(d) ? d.map(j => ({ id: String(j.id), title: j.text || '', url: j.hostedUrl || '',
      text: ((j.descriptionPlain || '') + '\n' + (j.lists || []).map(l => l.text + ': ' + (l.content || '').replace(/<[^>]+>/g, ' ')).join('\n') + '\n' + (j.additionalPlain || '')).replace(/\s+\n/g, '\n').trim() })) : null;
  }
  if (ats === 'ashby') {
    const d = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
    return d?.jobs?.map(j => ({ id: String(j.id || j.jobId || ''), title: j.title || '', url: j.jobUrl || '',
      text: (j.descriptionPlain || '').replace(/\s+/g, ' ').trim() }));
  }
  return null;
}

// group rows by ats+slug
const groups = {};
for (const r of rows) {
  const slug = slugOf(r.url);
  if (!slug) continue;
  (groups[`${r.ats}|${slug}`] ||= []).push(r);
}

let ok = 0, miss = 0, skipped = 0;
const total = rows.length;
console.log(`\n▶ ATS JD pull — ${total} roles across ${Object.keys(groups).length} boards\n`);

for (const key of Object.keys(groups)) {
  const [ats, slug] = key.split('|');
  const board = await fetchBoard(ats, slug);
  const grp = groups[key];
  if (!board) { miss += grp.length; console.log(`  ✗ ${ats}/${slug} — board fetch failed (${grp.length} roles)`); continue; }
  const byId = new Map(board.map(j => [j.id, j]));
  for (const r of grp) {
    const outPath = `${OUT}/${String(r.rank).padStart(3, '0')}.json`;
    if (existsSync(outPath)) { skipped++; continue; }
    const id = idOf(r.url);
    let j = (id && byId.get(id)) || board.find(b => norm(b.title) === norm(r.title)) ||
            board.find(b => b.url && r.url && b.url.includes(id));
    const jd = (j?.text || '').trim();
    writeFileSync(outPath, JSON.stringify({
      rank: r.rank, company: r.company, title: r.title, url: r.url, ats: r.ats,
      jd, status: jd ? 'ok' : 'unavailable', pulledAt: new Date().toISOString(),
    }, null, 2));
    if (jd) { ok++; } else { miss++; console.log(`  ⚠ #${r.rank} ${r.company} — no JD match on ${ats}/${slug}`); }
  }
  console.log(`  ${ats}/${slug}: ${grp.length} roles processed`);
}

console.log(`\n✅ ATS JD pull complete: ${ok} pulled, ${skipped} already had, ${miss} unavailable. → ${OUT}/`);
