#!/usr/bin/env node
/**
 * refresh.mjs — Second Brain machine layer.
 * Regenerates _brain_api/*.json from Hireloom's real data files. The Obsidian
 * plugin ONLY reads these JSONs (+ a few direct file reads) — it never parses
 * markdown itself and never invents data (spec design law #1).
 *
 * Reuses Hireloom's analyzers instead of re-implementing them (spec law):
 *   node engine/tracker/followup-cadence.mjs  → followups.json
 *   node engine/tracker/analyze-patterns.mjs  → patterns.json
 *
 * Idempotent by design (spec self-test #4): no wall-clock timestamps in any
 * output — freshness comes from source-file mtimes, so refresh-twice → no diff.
 *
 * Run: node second-brain/plugin/refresh.mjs        (from the repo root or anywhere)
 */

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const API = join(ROOT, '_brain_api');
mkdirSync(API, { recursive: true });

const mtime = (p) => (existsSync(p) ? statSync(p).mtime.toISOString() : null);
const writeJson = (name, obj) => writeFileSync(join(API, name), JSON.stringify(obj, null, 1) + '\n');

// ── 1. pipeline.json — the tracker, parsed once, canonically ────────────────
const APPS = join(ROOT, 'data', 'applications.md');
function parseTracker() {
  if (!existsSync(APPS)) return { rows: [], byStatus: {}, sourceMtime: null };
  const lines = readFileSync(APPS, 'utf8').split('\n');
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // | # | Date | Company | Role | Score | Status | PDF | Report | Notes |
    if (cells.length < 10 || cells[1] === '#' || /^-+$/.test(cells[1])) continue;
    const num = parseInt(cells[1], 10);
    if (!Number.isFinite(num)) continue;
    rows.push({
      num,
      date: cells[2],
      company: cells[3],
      role: cells[4],
      score: cells[5],
      status: cells[6],
      pdf: cells[7],
      report: cells[8],
      notes: cells[9],
    });
  }
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  return { rows, byStatus, sourceMtime: mtime(APPS) };
}
const pipeline = parseTracker();
writeJson('pipeline.json', pipeline);

// ── 2. followups.json + patterns.json — the analyzers, reused verbatim ──────
function runAnalyzer(rel, outName) {
  try {
    const out = execFileSync(process.execPath, [join(ROOT, rel)], {
      cwd: ROOT, encoding: 'utf8', timeout: 30000,
    });
    writeJson(outName, JSON.parse(out));
    return true;
  } catch (e) {
    // Honest failure state — the plugin shows WHY a tab is empty, never a blank pane.
    writeJson(outName, { error: `analyzer failed: ${rel}`, detail: String(e.message).slice(0, 300) });
    return false;
  }
}
const okFollowups = runAnalyzer('engine/tracker/followup-cadence.mjs', 'followups.json');
const okPatterns = runAnalyzer('engine/tracker/analyze-patterns.mjs', 'patterns.json');

// ── 3. queue.json — ranked apply pool (head + counts), if the pool exists ───
const POOL = join(ROOT, 'output', 'pool-apply-order.json');
if (existsSync(POOL)) {
  try {
    const pool = JSON.parse(readFileSync(POOL, 'utf8'));
    const rows = pool.rows || [];
    // a row is done when it carries any terminal marker: the engine writes a
    // status string ('applied'/'discarded'/'rejected'); older pools used booleans
    const pending = rows.filter((r) => !r.status && !r.applied && !r.skipped);
    const applied = rows.filter((r) => /applied/i.test(r.status || '') || r.applied === true);
    writeJson('queue.json', {
      sourceMtime: mtime(POOL),
      nextRank: pool.nextRank ?? null,
      total: rows.length,
      pendingCount: pending.length,
      appliedCount: applied.length,
      head: pending.slice(0, 15),
    });
  } catch (e) {
    writeJson('queue.json', { error: 'pool-apply-order.json unreadable', detail: String(e.message).slice(0, 200) });
  }
} else {
  writeJson('queue.json', { missing: true });
}

// ── 4. scanfeed.json — newest scanner discoveries ────────────────────────────
const SCAN = join(ROOT, 'data', 'scan-history.tsv');
if (existsSync(SCAN)) {
  const lines = readFileSync(SCAN, 'utf8').trim().split('\n');
  const header = lines[0].split('\t');
  const recent = lines.slice(1).map((l) => {
    const c = l.split('\t');
    return Object.fromEntries(header.map((h, i) => [h, c[i] ?? '']));
  });
  recent.sort((a, b) => (b.first_seen || '').localeCompare(a.first_seen || ''));
  writeJson('scanfeed.json', {
    sourceMtime: mtime(SCAN),
    total: recent.length,
    lastSeen: recent[0]?.first_seen ?? null,
    recent: recent.slice(0, 30),
  });
} else {
  writeJson('scanfeed.json', { missing: true });
}

// ── 5. inbox.json — pending URLs from data/pipeline.md ───────────────────────
const INBOX = join(ROOT, 'data', 'pipeline.md');
if (existsSync(INBOX)) {
  const text = readFileSync(INBOX, 'utf8');
  const urls = [...text.matchAll(/^\s*[-*]\s+(?:\[[^\]]*\]\()?(https?:\/\/\S+?|local:\S+?)(?:\))?\s*$/gm)].map((m) => m[1]);
  writeJson('inbox.json', { sourceMtime: mtime(INBOX), pendingCount: urls.length, pending: urls.slice(0, 50) });
} else {
  writeJson('inbox.json', { missing: true });
}

// ── 6. interviews.json — Interview-stage rows + prep coverage ────────────────
const PREP_DIR = join(ROOT, 'interview-prep');
const prepFiles = existsSync(PREP_DIR) ? readdirSync(PREP_DIR).filter((f) => !f.startsWith('.')) : [];
const interviewRows = pipeline.rows
  .filter((r) => r.status === 'Interview')
  .map((r) => {
    const slug = r.company.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const prep = prepFiles.filter((f) => f.toLowerCase().includes(slug.split('-')[0]));
    return { ...r, prepFiles: prep };
  });
writeJson('interviews.json', {
  sourceMtime: pipeline.sourceMtime,
  count: interviewRows.length,
  rows: interviewRows,
  prepDirCount: prepFiles.length,
});

// ── 7. meta.json — build stamp + source freshness (no wall clock) ────────────
// First name for the dashboard greeting — read from the profile, never hardcoded.
let firstName = null;
try {
  const prof = readFileSync(join(ROOT, 'config', 'profile.yml'), 'utf8');
  const m = prof.match(/^\s*full_name:\s*["']?([^"'\n]+)/m);
  if (m) firstName = m[1].trim().split(/\s+/)[0];
} catch { /* greeting falls back to no name */ }

writeJson('meta.json', {
  buildStamp: 'brain-refresh-v1',
  user: { firstName },
  sources: {
    applications: pipeline.sourceMtime,
    pool: mtime(POOL),
    scanHistory: mtime(SCAN),
    inbox: mtime(INBOX),
    followups: okFollowups,
    patterns: okPatterns,
  },
  counts: {
    tracked: pipeline.rows.length,
    byStatus: pipeline.byStatus,
    interviews: interviewRows.length,
  },
});

// ── 8. spend.json — delegate to the transcript parser (cheap: <1s) ──────────
try {
  execFileSync(process.execPath, [join(ROOT, 'second-brain', 'plugin', 'spend.mjs')], { timeout: 60000 });
} catch (e) {
  writeJson('spend.json', { error: 'spend parser failed', detail: String(e.message).slice(0, 200) });
}

// ── 9. digest.md — the morning briefing, composed from the same real data ───
// No timestamps in the body (idempotency); the `morning` protocol reads this.
const overdueTop = (() => {
  try {
    const f = JSON.parse(readFileSync(join(API, 'followups.json'), 'utf8'));
    return (f.entries || []).filter((e) => /overdue|urgent/i.test(e.urgency || ''))
      .sort((a, b) => (b.daysSinceApplication || 0) - (a.daysSinceApplication || 0)).slice(0, 5);
  } catch { return []; }
})();
const queueHead = (() => {
  try { return (JSON.parse(readFileSync(join(API, 'queue.json'), 'utf8')).head || []).slice(0, 5); } catch { return []; }
})();
const digest = [
  '# Morning digest',
  '',
  `**Pipeline:** ${pipeline.rows.length} tracked — ${Object.entries(pipeline.byStatus).map(([k, v]) => `${v} ${k}`).join(' · ')}`,
  '',
  '## 🎤 Interviews live',
  ...(interviewRows.length ? interviewRows.map((r) => `- **${r.company}** — ${r.role}`) : ['- none in interview stage']),
  '',
  '## 🔥 Follow-ups due (top 5 overdue)',
  ...(overdueTop.length ? overdueTop.map((e) => `- **${e.company}** — ${e.role} (${e.daysSinceApplication}d since apply, ${e.followupCount} follow-ups sent)`) : ['- nothing overdue']),
  '',
  '## 🗂 Queue head',
  ...(queueHead.length ? queueHead.map((r) => `- #${r.rank} **${r.company}** — ${r.title}`) : ['- no ranked pool']),
  '',
].join('\n');
writeFileSync(join(API, 'digest.md'), digest + '\n');

console.log(`brain refresh OK → ${API} (${pipeline.rows.length} tracked, ${interviewRows.length} in interview, digest + spend written)`);
