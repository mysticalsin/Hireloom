#!/usr/bin/env node
/**
 * backfill-history.mjs — seed data/status-history.tsv from existing evidence.
 *
 * The history layer is greenfield (data/ has no git history), so the WHEN of
 * every existing status has to be reconstructed from what the repo already
 * knows. Evidence, best-first, all source-tagged 'backfill:<origin>':
 *   backfill:gmail   — gmail-cache signals the auto-sort actually wrote
 *                      (autoApplied), at the email's timestamp
 *   backfill:pool    — pool-apply-order.json appliedAt/appliedDate for pool
 *                      rows that join to a tracker row → 'Applied'
 *   backfill:notes   — rejection/closure dates written into tracker Notes
 *                      ("passed 2026-06-09", "Form rejection 06-03"), and
 *                      booked interview datetimes on Interview rows
 *   backfill:tracker — fallback: current status at the row's date column
 *                      (the only date the tracker itself knows)
 *
 * Run: node engine/tracker/backfill-history.mjs            (dry-run, default)
 *      node engine/tracker/backfill-history.mjs --write    (commit to TSV)
 *
 * Idempotent: entries already present in data/status-history.tsv (same
 * num+field+new value) are never written twice — safe to re-run after live
 * writers (gmail-auto, api) have started appending.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  parseHistory, appendHistory, extractInterviewDateFromText,
} from '../../apps/web/lib/status-history.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const WRITE = process.argv.includes('--write');
const HISTORY_FILE = join(ROOT, 'data/status-history.tsv');
const APPS_FILE = join(ROOT, 'data/applications.md');
const POOL_FILE = join(ROOT, 'output/pool-apply-order.json');
const GMAIL_FILE = join(ROOT, 'data/gmail-cache.json');

// ── tiny helpers ─────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');
// History timestamps are local wall-clock 'YYYY-MM-DDTHH:mm' (matches the
// 'row date + T00:00' convention; lexicographic order = chronology).
const fmtTs = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Loose-but-safe identity: exact normalized match or containment either way
// ('Applicants Inc.' ↔ 'Applicants Inc. (Lineside)').
const sameish = (a, b) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

// ── load inputs ──────────────────────────────────────────────────────────────

// Same column contract as engine/tracker/followup-cadence.mjs parseTracker.
function parseTracker() {
  if (!existsSync(APPS_FILE)) return [];
  const entries = [];
  for (const line of readFileSync(APPS_FILE, 'utf-8').split('\n')) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 9) continue;
    const num = parseInt(parts[1]);
    if (isNaN(num)) continue;
    entries.push({
      num, date: parts[2], company: parts[3], role: parts[4],
      score: parts[5], status: parts[6], pdf: parts[7], report: parts[8],
      notes: parts[9] || '',
    });
  }
  return entries;
}

const loadJson = (file, fallback) => {
  try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return fallback; }
};

const tracker = parseTracker();
const byNum = new Map(tracker.map(r => [r.num, r]));
const pool = loadJson(POOL_FILE, { rows: [] });
const gmail = loadJson(GMAIL_FILE, { signals: [] });
const existing = existsSync(HISTORY_FILE) ? parseHistory(readFileSync(HISTORY_FILE, 'utf-8')) : [];

const proposals = []; // {ts,num,company,role,field,old,neu,source}
const warnings = [];
const propose = (row, p) => proposals.push({ company: row.company, role: row.role, num: row.num, old: '', ...p });

// ── (b) gmail auto-writes — the email's own timestamp is the best evidence ──

for (const s of gmail.signals || []) {
  if (!s.autoApplied) continue;
  const num = Number(s.num);
  const row = byNum.get(num);
  if (!row) continue;
  // An auto-write that was filed against the wrong row must not seed history.
  if (!sameish(row.company, s.company)) {
    warnings.push(`gmail signal for #${num} company '${s.company}' does not match tracker '${row.company}' — skipped`);
    continue;
  }
  const d = new Date(s.date || '');
  if (isNaN(d.getTime())) continue;
  const neu = typeof s.autoApplied === 'string' ? s.autoApplied : (s.suggestedStatus || '');
  if (!neu) continue;
  propose(row, { ts: fmtTs(d), field: 'status', neu, source: 'backfill:gmail' });
}

// ── (c) pool appliedAt/appliedDate → 'Applied' for joined tracker rows ───────

const appliedPool = (pool.rows || []).filter(r => r.appliedAt || r.appliedDate);

// Preferred join: apps/web/lib/role-index.mjs loadRoleIndex({ rootDir }) →
// { roles }: joined applications are tracker roles (.num) carrying the pool
// role under .pool (.pool.poolN). Built in a parallel workstream — import
// dynamically and fall back to the inline join if it's missing or reshaped.
// .pool.appliedOn is date-only, so poolN maps back to the raw pool row to
// recover the full appliedAt timestamp. Every pair is company-validated
// afterwards either way, so a join bug cannot seed a wrong row.
async function roleIndexPairs() {
  try {
    const mod = await import(pathToFileURL(join(ROOT, 'apps/web/lib/role-index.mjs')).href);
    if (typeof mod.loadRoleIndex !== 'function') return null;
    const idx = mod.loadRoleIndex({ rootDir: ROOT });
    if (!Array.isArray(idx?.roles)) return null;
    const byPoolN = new Map(appliedPool.map(r => [Number(r.n), r]));
    const pairs = [];
    for (const r of idx.roles) {
      if (r.source !== 'tracker' || !r.pool) continue;
      const pr = byPoolN.get(Number(r.pool.poolN));
      if (pr && Number.isFinite(Number(r.num))) pairs.push([pr, Number(r.num)]);
    }
    return pairs.length ? pairs : null;
  } catch { return null; }
}

// Inline fallback join — conservative: company AND title must match
// (normalized, containment allowed) and the match must be UNIQUE.
function inlineJoin() {
  const pairs = [];
  for (const pr of appliedPool) {
    const hits = tracker.filter(t => sameish(t.company, pr.company) && sameish(t.role, pr.title));
    if (hits.length === 1) pairs.push([pr, hits[0].num]);
  }
  return pairs;
}

let joinVia = 'role-index';
let pairs = await roleIndexPairs();
if (!pairs) { pairs = inlineJoin(); joinVia = 'inline join (role-index.mjs unavailable)'; }

for (const [pr, tn] of pairs) {
  const row = byNum.get(tn);
  if (!row || !sameish(row.company, pr.company)) continue; // belt-and-suspenders on the join
  const ts = pr.appliedAt ? fmtTs(new Date(pr.appliedAt)) : `${pr.appliedDate}T00:00`;
  propose(row, { ts, field: 'status', neu: 'Applied', source: 'backfill:pool' });
}

// ── (d) notes-text rejection/closure dates ───────────────────────────────────
// Only on rows whose CURRENT status is a closure (Rejected/Discarded), only
// when a closure keyword PRECEDES a date within 40 chars ("passed 2026-06-09",
// "Form rejection 06-03", "CLOSED as a chase 2026-06-11"). Direction matters:
// in "nudge sent 2026-06-10; CLOSED ... 2026-06-11" the earlier date sits
// just BEFORE the keyword — keyword-first scoping keeps it out. Multiple
// distinct qualifying dates = ambiguous = skip; wrong dates are worse than
// missing ones.

const NOTE_KW_RE = /\b(reject(?:ed|ion|ions)?|passed|closed|filled)\b/gi;
const NOTE_DATE_RE = /(?<![\d-])(?:(\d{4})-)?(\d{1,2})-(\d{1,2})(?![\d-])/g;
const NOTES_YEAR = 2026; // spec: bare MM-DD note fragments are 2026

for (const row of tracker) {
  if (!['rejected', 'discarded'].includes(row.status.toLowerCase())) continue;
  const kws = [...row.notes.matchAll(NOTE_KW_RE)];
  const dates = [];
  for (const m of row.notes.matchAll(NOTE_DATE_RE)) {
    const y = m[1] ? +m[1] : NOTES_YEAR, mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    dates.push({ start: m.index, iso: `${y}-${pad(mo)}-${pad(d)}` });
  }
  const qualifying = new Set();
  for (const k of kws) {
    const kEnd = k.index + k[0].length;
    for (const dt of dates) {
      const gap = dt.start - kEnd;
      if (gap >= 0 && gap <= 40) qualifying.add(dt.iso);
    }
  }
  if (qualifying.size === 1) {
    const [iso] = qualifying;
    propose(row, { ts: `${iso}T00:00`, field: 'status', neu: row.status, source: 'backfill:notes' });
  } else if (qualifying.size > 1) {
    warnings.push(`#${row.num} ${row.company}: ${qualifying.size} distinct closure dates in notes — ambiguous, skipped`);
  }
}

// ── (e) interview datetimes from Interview-row notes ─────────────────────────

const nowTs = fmtTs(new Date());
for (const row of tracker) {
  if (row.status.toLowerCase() !== 'interview') continue;
  const iso = extractInterviewDateFromText(row.notes, { referenceDate: row.date });
  if (!iso) continue;
  propose(row, { ts: nowTs, field: 'interview_at', neu: iso, source: 'backfill:notes' });
}

// ── dedup within proposals (better evidence wins) ────────────────────────────
// Same num+field+neu from several origins (a Hootsuite rejection exists in
// BOTH gmail-cache and the row's note): exact-timestamp sources beat
// date-only notes beat the tracker fallback.

const SOURCE_PRIO = { 'backfill:gmail': 0, 'backfill:pool': 0, 'backfill:notes': 1, 'backfill:tracker': 2 };
const seen = new Map();
for (const p of proposals) {
  const key = `${p.num} ${p.field} ${p.neu.toLowerCase()}`;
  const cur = seen.get(key);
  if (!cur || SOURCE_PRIO[p.source] < SOURCE_PRIO[cur.source]) seen.set(key, p);
}
let deduped = [...seen.values()];

// ── (a) tracker fallback — every row's CURRENT status must appear ────────────
// Skipped when better evidence already covers it. ts = the row's date column
// (the only timestamp the tracker knows), clamped to not precede the row's
// latest evidence — a Rejected can't land before the Applied that pool dated.

for (const row of tracker) {
  const mine = deduped.filter(p => p.num === row.num && p.field === 'status');
  if (mine.some(p => p.neu.toLowerCase() === row.status.toLowerCase())) continue;
  const latest = mine.map(p => p.ts).sort().pop() || '';
  const base = `${row.date}T00:00`;
  deduped.push({
    ts: latest > base ? latest : base, num: row.num, company: row.company, role: row.role,
    field: 'status', old: '', neu: row.status, source: 'backfill:tracker',
  });
}

// ── drop entries the history file already has, chain old-values, sort ────────

const already = (p) => existing.some(e => e.num === p.num && e.field === p.field && e.neu === p.neu);
const skippedExisting = deduped.filter(already);
deduped = deduped.filter(p => !already(p));

deduped.sort((a, b) => a.num - b.num || (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
const lastNeu = new Map(); // num → last status value, seeded from existing file
for (const e of existing) if (e.field === 'status') lastNeu.set(e.num, e.neu);
for (const p of deduped) {
  if (p.field !== 'status') continue;
  p.old = lastNeu.get(p.num) || '';
  lastNeu.set(p.num, p.neu);
}

// ── report + (optionally) write ──────────────────────────────────────────────

const count = (src) => deduped.filter(p => p.source === src).length;
console.log(`\nStatus-history backfill — ${WRITE ? 'WRITE' : 'DRY RUN (pass --write to commit)'}`);
console.log(`History file: ${HISTORY_FILE} (${existing.length} existing entries)`);
console.log(`Tracker rows: ${tracker.length} | gmail autoApplied: ${(gmail.signals || []).filter(s => s.autoApplied).length} | pool rows with applied dates: ${appliedPool.length} (joined via ${joinVia}: ${pairs.length})`);
console.log(`Entries to write: ${deduped.length}  [tracker ${count('backfill:tracker')} | pool ${count('backfill:pool')} | gmail ${count('backfill:gmail')} | notes ${count('backfill:notes')}]`);
if (skippedExisting.length) console.log(`Already recorded (skipped): ${skippedExisting.length}`);
for (const w of warnings) console.log(`  ⚠ ${w}`);
console.log('');

for (const p of deduped) {
  console.log(
    '  #' + String(p.num).padEnd(5) +
    p.company.substring(0, 24).padEnd(26) +
    p.field.padEnd(14) +
    (`'${p.old}' → '${p.neu}'`).padEnd(38) +
    ('@ ' + p.ts).padEnd(20) +
    `[${p.source}]`,
  );
}

if (WRITE) {
  let written = 0, guarded = 0;
  for (const p of deduped) appendHistory(HISTORY_FILE, p) ? written++ : guarded++;
  console.log(`\nWrote ${written} entries to ${HISTORY_FILE}${guarded ? ` (${guarded} skipped by append guard)` : ''}`);
} else {
  console.log(`\nDry run — nothing written. Re-run with --write to commit ${deduped.length} entries.`);
}
