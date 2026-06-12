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

// ── 5. inbox.json — Gmail signals + pending URLs from data/pipeline.md ───────
// The Inbox tab is the mail-shaped view: what the Gmail auto-sort saw (live
// signals + a quiet auto-filed tally), plus any unprocessed job URLs. Before
// 2026-06-12 it bound ONLY to pipeline.md, so it read "Inbox empty" while the
// user's Gmail was visibly full — the signals lived in data/gmail-cache.json
// and never reached the vault.
const INBOX = join(ROOT, 'data', 'pipeline.md');
const GMAIL_CACHE = join(ROOT, 'data', 'gmail-cache.json');
function readGmailSignals() {
  if (!existsSync(GMAIL_CACHE)) return { connected: false, signals: [] };
  try {
    const cache = JSON.parse(readFileSync(GMAIL_CACHE, 'utf8'));
    return { connected: true, signals: cache.signals || [], scannedAt: cache.scanned_at || null };
  } catch { return { connected: false, signals: [] }; }
}
const gmail = readGmailSignals();
const slimSignal = (s) => ({
  id: s.id, threadId: s.threadId || null, num: s.num ?? null, company: s.company || '', role: s.role || '',
  kind: s.signal, unmatched: !!s.unmatched, subject: s.subject || '',
  snippet: s.snippet || '', from: s.from || '', date: s.date || '',
  autoApplied: s.autoApplied || null, userResponded: !!s.userResponded,
  respondedAt: s.respondedAt || null,
});
// Last logged touch per application (data/follow-ups.md) — a touch on/after
// an email's receipt date means the user already handled that conversation.
const lastTouchByApp = (() => {
  const f = join(ROOT, 'data', 'follow-ups.md');
  const map = new Map();
  if (!existsSync(f)) return map;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 9 || !/^\d+$/.test(cells[2] || '') || !/^\d{4}-\d{2}-\d{2}$/.test(cells[3] || '')) continue;
    const prev = map.get(cells[2]);
    if (!prev || cells[3] > prev) map.set(cells[2], cells[3]);
  }
  return map;
})();
{
  const urls = existsSync(INBOX)
    ? [...readFileSync(INBOX, 'utf8').matchAll(/^\s*[-*]\s+(?:\[[^\]]*\]\()?(https?:\/\/\S+?|local:\S+?)(?:\))?\s*$/gm)].map((m) => m[1])
    : [];
  const live = gmail.signals.filter((s) => !s.dismissed).map(slimSignal);
  const autoFiled = gmail.signals.filter((s) => s.dismissed);
  writeJson('inbox.json', {
    sourceMtime: mtime(INBOX),
    gmailMtime: mtime(GMAIL_CACHE),
    gmailConnected: gmail.connected,
    signals: live.slice(0, 50),
    signalCount: live.length,
    autoFiledCount: autoFiled.length,
    autoAppliedCount: autoFiled.filter((s) => s.autoApplied).length,
    pendingCount: urls.length,
    pending: urls.slice(0, 50),
  });
}

// ── 5b. needsreview.json — "response: reasoning unknown" + unverified flags ──
// Everything the classifier refused to decide on its own: unknown-meaning
// responses, low-confidence interview flags, and strong signals that matched
// no tracker row. The user reads the email and says what it was. Items the
// user already replied to (sent-mail detection) drop out automatically.
{
  const reviewable = gmail.signals.filter((s) =>
    (s.signal === 'unknown' || s.unmatched || (s.signal === 'interview' && !s.autoApplied && !s.dismissed))
    && !s.dismissed);
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const stamped = reviewable.map((s) => {
    const d = new Date(s.date || '');
    const received = isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    const respondBy = isNaN(d.getTime()) ? null : new Date(d.getTime() + sevenDays).toISOString().slice(0, 10);
    return { ...slimSignal(s), received, respondBy };
  });
  // Cleared = the user replied (sent-mail detection) OR logged a touch on/after
  // the email arrived (a held call or hand-logged nudge counts as handled).
  const open = stamped.filter((s) => !s.userResponded &&
    !(s.num != null && s.received && (lastTouchByApp.get(String(s.num)) || '') >= s.received));
  // One conversation = one card: collapse same-thread items, keep the newest.
  const byThread = new Map();
  for (const s of open) {
    const key = s.threadId || s.id;
    const prev = byThread.get(key);
    if (!prev || (s.received || '') > (prev.received || '')) byThread.set(key, s);
  }
  const items = [...byThread.values()];
  writeJson('needsreview.json', {
    gmailMtime: mtime(GMAIL_CACHE),
    gmailConnected: gmail.connected,
    count: items.length,
    repliedCount: reviewable.length - open.length,
    items: items.slice(0, 50),
  });
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
    return (f.entries || []).filter((e) => /overdue|urgent|respond-pending/i.test(e.urgency || ''))
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
  ...(overdueTop.length ? overdueTop.map((e) => e.nextStepEmail
    ? `- **${e.company}** — ${e.role} — ⚠ possible next-step email: “${e.nextStepEmail.subject}”`
    : e.urgency === 'respond-pending'
      ? `- **${e.company}** — ${e.role} — they wrote ${e.inboundDate}; respond by ${e.respondBy}`
      : `- **${e.company}** — ${e.role} (${e.daysSinceApplication}d since apply, ${e.followupCount} follow-ups sent)`) : ['- nothing overdue']),
  '',
  '## 🗂 Queue head',
  ...(queueHead.length ? queueHead.map((r) => `- #${r.rank} **${r.company}** — ${r.title}`) : ['- no ranked pool']),
  '',
].join('\n');
writeFileSync(join(API, 'digest.md'), digest + '\n');

console.log(`brain refresh OK → ${API} (${pipeline.rows.length} tracked, ${interviewRows.length} in interview, digest + spend written)`);
