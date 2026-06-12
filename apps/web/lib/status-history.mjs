// status-history.mjs — append-only TSV history of tracker status changes.
// Pure core (format/parse/query/extract — no I/O) + thin fs wrappers
// (loadHistory/appendHistory/setInterviewDate). The tracker itself
// (data/applications.md) only knows the CURRENT status of each row; this
// layer is the WHEN — every status flip and booked interview datetime, one
// line per change, written by whoever made the change (gmail-auto, classify,
// api, autopilot, backfill:<origin>).
//
// Entry shape everywhere: { ts, num, company, role, field, old, neu, source }.
// The TSV column is named 'new' but the JS property is `neu` — `new` is a
// reserved word, so `const { new } = entry` is a syntax error; one name that
// round-trips through formatHistoryLine/parseHistory beats two.
// `field` is 'status' (old/neu = tracker statuses) or 'interview_at'
// (neu = ISO 'YYYY-MM-DDTHH:mm' local wall-clock, no timezone math).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const HISTORY_HEADER = 'ts\tnum\tcompany\trole\tfield\told\tnew\tsource';

// Free text lands in a TSV — one stray tab in a role title would shift every
// column after it. Collapse tabs/newlines to spaces at write time.
const tabSafe = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();

export function formatHistoryLine({ ts, num, company, role, field, old, neu, source }) {
  return [ts, num, company, role, field, old, neu, source].map(tabSafe).join('\t');
}

// Tolerant: skips the header, blank lines, rows with too few columns, and
// rows whose num isn't numeric (hand-edits happen; never throw on a log file).
export function parseHistory(content) {
  const entries = [];
  for (const raw of String(content || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line === HISTORY_HEADER || line.startsWith('ts\t')) continue;
    const parts = line.split('\t');
    if (parts.length < 8) continue;
    const num = Number(parts[1]);
    if (!Number.isFinite(num)) continue;
    entries.push({
      ts: parts[0], num, company: parts[2], role: parts[3],
      field: parts[4], old: parts[5], neu: parts[6],
      // Extra tabs (hand-edited free text) fold into source rather than
      // silently truncating the line.
      source: parts.slice(7).join(' ').trim(),
    });
  }
  return entries;
}

// [fs] Append one entry; creates the file (with header) on first write.
// Idempotency guard: if the LAST entry for the same num+field already has the
// identical new value, this is a re-fire of the same change (rescans, double
// API calls) — skip it and return false. Only the LAST entry counts: a real
// revert (applied → rejected → applied) is a real change and must append.
export function appendHistory(filePath, entry) {
  mkdirSync(dirname(filePath), { recursive: true });
  const content = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
  const prior = parseHistory(content).filter(e => e.num === Number(entry.num) && e.field === entry.field);
  const last = prior[prior.length - 1];
  if (last && last.neu === tabSafe(entry.neu)) return false;
  const base = content
    ? (content.endsWith('\n') ? content : content + '\n')
    : HISTORY_HEADER + '\n';
  writeFileSync(filePath, base + formatHistoryLine(entry) + '\n');
  return true;
}

// [fs] Clearly-named load helper — the only sanctioned way to get entries
// from disk; everything downstream is pure on the returned array.
export function loadHistory(filePath) {
  if (!existsSync(filePath)) return [];
  return parseHistory(readFileSync(filePath, 'utf-8'));
}

const byTs = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);

// Ordered status changes for one tracker row (ISO-ish ts strings sort
// lexicographically, so string compare is the correct chronology).
export function statusTimeline(entries, num) {
  const n = Number(num);
  return entries.filter(e => e.num === n && e.field === 'status').slice().sort(byTs);
}

// ts of the last status change for a row — optionally the last change TO a
// specific status. Case-insensitive: the tracker writes 'Applied', canonical
// states.yml is lowercase, and history must serve both.
export function latestStatusDate(entries, num, status) {
  const tl = statusTimeline(entries, num);
  const want = status ? String(status).toLowerCase() : null;
  for (let i = tl.length - 1; i >= 0; i--) {
    if (!want || tl[i].neu.toLowerCase() === want) return tl[i].ts;
  }
  return null;
}

// Latest booked interview datetime for a row (the neu of the most recent
// 'interview_at' entry), or null. Rebookings append, so last-by-ts wins.
export function interviewDateFor(entries, num) {
  const n = Number(num);
  const rows = entries
    .filter(e => e.num === n && e.field === 'interview_at' && e.neu)
    .sort(byTs);
  return rows.length ? rows[rows.length - 1].neu : null;
}

// [fs] Booking an interview is just a history append with field
// 'interview_at' — same file, same guard, no separate store.
export function setInterviewDate(filePath, { ts, num, company, role, old = '', neu, source }) {
  return appendHistory(filePath, { ts, num, company, role, field: 'interview_at', old, neu, source });
}

// ── Natural-language interview datetime extraction ──────────────────────────
// Real notes/emails carry fragments like 'booked 06-16 15:00 ET',
// '3pm-3:30pm on Tuesday, June 16', 'Tue 9 Jun 2026 12:30pm'. Strategy:
// collect every date candidate and every time candidate WITH POSITIONS, then
// pair the closest date+time — a note like "invited screen 06-12, booked
// 06-16 15:00" has three dates, and naive first-date-first-time pairing
// would book the wrong day. Conservative by design: no time → null, no
// resolvable year → null, two equally-near pairs that disagree → null.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// Full names spelled out (not stem + [a-z]*) so 'Marketing'/'Junction' never
// read as months — \b after the alternation rejects partial-word matches.
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

function collectDates(text) {
  const found = [];
  const push = (start, end, y, m, d, prio) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return;
    found.push({ start, end, y, m, d, prio });
  };
  // prio 0 — full ISO: 2026-06-16
  for (const x of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g))
    push(x.index, x.index + x[0].length, +x[1], +x[2], +x[3], 0);
  // prio 1 — day first: '9 Jun 2026', '16th June'
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\b\\.?(?:,?\\s+(\\d{4})\\b)?`, 'gi');
  for (const x of text.matchAll(dayFirst))
    push(x.index, x.index + x[0].length, x[3] ? +x[3] : null, MONTHS[x[2].slice(0, 3).toLowerCase()], +x[1], 1);
  // prio 2 — month first: 'June 16', 'June 16, 2026'. (?!\d) keeps 'Jun 2026'
  // from reading as June 20 — the day may not be a truncated year.
  const monthFirst = new RegExp(`\\b${MONTH_RE}\\b\\.?\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?(?:,?\\s+(\\d{4})\\b)?`, 'gi');
  for (const x of text.matchAll(monthFirst))
    push(x.index, x.index + x[0].length, x[3] ? +x[3] : null, MONTHS[x[1].slice(0, 3).toLowerCase()], +x[2], 2);
  // prio 3 — bare MM-DD: '06-16'. The [\d-] guards keep it from biting
  // chunks out of full ISO dates ('2026-06-16') or phone numbers.
  for (const x of text.matchAll(/(?<![\d-])(\d{1,2})-(\d{1,2})(?![\d-])/g))
    push(x.index, x.index + x[0].length, null, +x[1], +x[2], 3);
  // Higher-priority (more explicit) candidates eat overlapping lower ones:
  // '9 Jun 2026' must win over a 'Jun 20' misread of the same span.
  found.sort((a, b) => a.prio - b.prio || a.start - b.start);
  const kept = [];
  for (const c of found) if (!kept.some(k => c.start < k.end && c.end > k.start)) kept.push(c);
  return kept.sort((a, b) => a.start - b.start);
}

function collectTimes(text) {
  const out = [];
  // 12h with am/pm: '3pm', '12:30pm', '9 a.m.'
  for (const x of text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/gi)) {
    let h = +x[1]; const min = x[2] ? +x[2] : 0;
    if (h < 1 || h > 12 || min > 59) continue;
    h = x[3].toLowerCase() === 'p' ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
    out.push({ start: x.index, end: x.index + x[0].length, h, min });
  }
  // 24h HH:mm — literal read, no am/pm guessing ('15:00' is unambiguous;
  // '9:00' reads as 09:00). Skip spans already claimed by an am/pm match.
  for (const x of text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) {
    const s = x.index, e = s + x[0].length;
    if (out.some(t => s < t.end && e > t.start)) continue;
    const h = +x[1], min = +x[2];
    if (h > 23 || min > 59) continue;
    out.push({ start: s, end: e, h, min });
  }
  out.sort((a, b) => a.start - b.start);
  // Ranges collapse to their START: '3pm-3:30pm' means the interview begins
  // at 3pm — without this, nearest-pair logic would book the range END
  // (it sits closer to a trailing date).
  const kept = [];
  for (const t of out) {
    const prev = kept[kept.length - 1];
    if (prev && /^\s*(?:-|–|—|to|until|till)\s*$/i.test(text.slice(prev.end, t.start))) continue;
    kept.push(t);
  }
  return kept;
}

// Resolve a (possibly year-less) date candidate to a concrete Y/M/D.
// Year-less dates take the NEXT occurrence on/after referenceDate within 366
// days — 'June 16' in a note written 2026-06-12 is 2026; 'Jan 5' written
// 2026-12-20 is 2027. No referenceDate + no explicit year → unresolvable.
function resolveDate(c, referenceDate) {
  const real = (y, m, d) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  };
  if (c.y) return real(c.y, c.m, c.d) ? c.y : null;
  if (!referenceDate || !/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) return null;
  const [ry, rm, rd] = referenceDate.split('-').map(Number);
  const ref = Date.UTC(ry, rm - 1, rd);
  for (const y of [ry, ry + 1]) {
    if (!real(y, c.m, c.d)) continue;
    const diff = (Date.UTC(y, c.m - 1, c.d) - ref) / 86400000;
    if (diff >= 0 && diff <= 366) return y;
  }
  return null;
}

// Dates and times further apart than this aren't the same appointment.
const MAX_PAIR_GAP = 40;

export function extractInterviewDateFromText(text, { referenceDate } = {}) {
  const t = String(text || '');
  const dates = collectDates(t);
  const times = collectTimes(t);
  if (!dates.length || !times.length) return null; // a date with no time is not a booking
  const pad = (n) => String(n).padStart(2, '0');
  const candidates = [];
  for (const d of dates) {
    const y = resolveDate(d, referenceDate);
    if (!y) continue;
    for (const tm of times) {
      const gap = tm.start >= d.end ? tm.start - d.end
        : tm.end <= d.start ? d.start - tm.end : 0;
      if (gap > MAX_PAIR_GAP) continue;
      candidates.push({ gap, iso: `${y}-${pad(d.m)}-${pad(d.d)}T${pad(tm.h)}:${pad(tm.min)}` });
    }
  }
  if (!candidates.length) return null;
  const min = Math.min(...candidates.map(c => c.gap));
  const winners = new Set(candidates.filter(c => c.gap === min).map(c => c.iso));
  // Two equally-near pairs that disagree = ambiguous. Null beats a guess —
  // a wrong interview time is worse than no interview time.
  return winners.size === 1 ? winners.values().next().value : null;
}
