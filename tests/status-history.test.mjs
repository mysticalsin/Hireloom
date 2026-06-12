// tests/status-history.test.mjs — unit tests for apps/web/lib/status-history.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HISTORY_HEADER, formatHistoryLine, parseHistory, appendHistory, loadHistory,
  statusTimeline, latestStatusDate, interviewDateFor, setInterviewDate,
  extractInterviewDateFromText,
} from '../apps/web/lib/status-history.mjs';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'status-history-')), 'status-history.tsv');
const entry = (over = {}) => ({
  ts: '2026-06-12T10:00', num: 122, company: 'Compass Group Canada',
  role: 'Project Manager, Program Management', field: 'status',
  old: 'Applied', neu: 'Interview', source: 'gmail-auto', ...over,
});

// ── header + format ──────────────────────────────────────────────────────────

test('HISTORY_HEADER names the 8 columns', () => {
  assert.equal(HISTORY_HEADER, 'ts\tnum\tcompany\trole\tfield\told\tnew\tsource');
  assert.equal(HISTORY_HEADER.split('\t').length, 8);
});

test('formatHistoryLine joins the 8 fields in column order', () => {
  assert.equal(
    formatHistoryLine(entry()),
    '2026-06-12T10:00\t122\tCompass Group Canada\tProject Manager, Program Management\tstatus\tApplied\tInterview\tgmail-auto',
  );
});

test('formatHistoryLine strips tabs/newlines from free text', () => {
  const line = formatHistoryLine(entry({ company: 'Evil\tCo\nInc', role: 'PM\t(Tech)' }));
  assert.equal(line.split('\t').length, 8);
  assert.ok(line.includes('Evil Co Inc'));
  assert.ok(line.includes('PM (Tech)'));
});

test('formatHistoryLine round-trips through parseHistory', () => {
  const e = entry();
  const [parsed] = parseHistory(HISTORY_HEADER + '\n' + formatHistoryLine(e) + '\n');
  assert.deepEqual(parsed, e);
});

// ── parseHistory ─────────────────────────────────────────────────────────────

test('parseHistory skips header, blanks, and malformed lines', () => {
  const content = [
    HISTORY_HEADER,
    '',
    'not\ta\tvalid\tline', // too few columns
    formatHistoryLine(entry()),
    'ts\tnum\tcompany\trole\tfield\told\tnew\tsource', // duplicate header
    formatHistoryLine(entry({ num: 85, neu: 'Rejected' })),
  ].join('\n');
  const entries = parseHistory(content);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].num, 122);
  assert.equal(entries[1].neu, 'Rejected');
});

test('parseHistory skips rows with non-numeric num and parses num as number', () => {
  const bad = formatHistoryLine(entry({ num: 'abc' }));
  const good = formatHistoryLine(entry({ num: '85' }));
  const entries = parseHistory(bad + '\n' + good);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].num, 85); // number, not string
});

test('parseHistory folds extra tab-separated tails into source', () => {
  const entries = parseHistory(formatHistoryLine(entry()) + '\textra\ttail');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source, 'gmail-auto extra tail');
});

// ── appendHistory (fs) ───────────────────────────────────────────────────────

test('appendHistory creates the file with header on first write', () => {
  const file = tmp();
  assert.equal(appendHistory(file, entry()), true);
  const content = readFileSync(file, 'utf-8');
  assert.ok(content.startsWith(HISTORY_HEADER + '\n'));
  assert.equal(parseHistory(content).length, 1);
});

test('appendHistory appends subsequent entries', () => {
  const file = tmp();
  appendHistory(file, entry({ ts: '2026-06-01T09:00', neu: 'Applied', old: '' }));
  appendHistory(file, entry({ ts: '2026-06-12T10:00', neu: 'Interview' }));
  appendHistory(file, entry({ num: 85, ts: '2026-06-12T11:00', neu: 'Rejected' }));
  assert.equal(parseHistory(readFileSync(file, 'utf-8')).length, 3);
});

test('appendHistory skips when last entry for num+field has identical new value', () => {
  const file = tmp();
  assert.equal(appendHistory(file, entry()), true);
  assert.equal(appendHistory(file, entry({ ts: '2026-06-13T08:00' })), false); // re-fire
  assert.equal(parseHistory(readFileSync(file, 'utf-8')).length, 1);
});

test('appendHistory guard is per num+field — other rows and fields still append', () => {
  const file = tmp();
  appendHistory(file, entry());
  // same neu, different num → appends
  assert.equal(appendHistory(file, entry({ num: 85 })), true);
  // same num, different field → appends
  assert.equal(appendHistory(file, entry({ field: 'interview_at', neu: '2026-06-16T15:00' })), true);
  assert.equal(parseHistory(readFileSync(file, 'utf-8')).length, 3);
});

test('appendHistory allows a real revert (guard checks LAST entry only)', () => {
  const file = tmp();
  appendHistory(file, entry({ ts: '1', neu: 'Applied', old: '' }));
  appendHistory(file, entry({ ts: '2', neu: 'Rejected' }));
  assert.equal(appendHistory(file, entry({ ts: '3', neu: 'Applied' })), true);
  assert.equal(parseHistory(readFileSync(file, 'utf-8')).length, 3);
});

test('loadHistory returns [] for a missing file', () => {
  const file = tmp();
  assert.equal(existsSync(file), false);
  assert.deepEqual(loadHistory(file), []);
});

// ── timeline queries (pure) ──────────────────────────────────────────────────

const TIMELINE = [
  entry({ num: 85, ts: '2026-06-03T10:00', neu: 'Interview', old: 'Responded' }),
  entry({ num: 85, ts: '2026-05-26T00:00', neu: 'Applied', old: '' }),
  entry({ num: 85, ts: '2026-05-27T09:00', neu: 'Responded', old: 'Applied' }),
  entry({ num: 85, ts: '2026-06-01T12:00', field: 'interview_at', neu: '2026-06-03T10:00', old: '' }),
  entry({ num: 85, ts: '2026-06-02T12:00', field: 'interview_at', neu: '2026-06-05T14:00', old: '2026-06-03T10:00' }),
  entry({ num: 120, ts: '2026-05-29T00:00', neu: 'Applied', old: '' }),
];

test('statusTimeline filters to one row + status field, ordered by ts', () => {
  const tl = statusTimeline(TIMELINE, 85);
  assert.deepEqual(tl.map(e => e.neu), ['Applied', 'Responded', 'Interview']);
  assert.deepEqual(statusTimeline(TIMELINE, 120).map(e => e.neu), ['Applied']);
  // string num accepted (gmail-cache carries num as a string)
  assert.equal(statusTimeline(TIMELINE, '85').length, 3);
});

test('latestStatusDate returns ts of last status change', () => {
  assert.equal(latestStatusDate(TIMELINE, 85), '2026-06-03T10:00');
});

test('latestStatusDate with status filter is case-insensitive', () => {
  assert.equal(latestStatusDate(TIMELINE, 85, 'applied'), '2026-05-26T00:00');
  assert.equal(latestStatusDate(TIMELINE, 85, 'Responded'), '2026-05-27T09:00');
});

test('latestStatusDate returns null when nothing matches', () => {
  assert.equal(latestStatusDate(TIMELINE, 85, 'offer'), null);
  assert.equal(latestStatusDate(TIMELINE, 999), null);
});

test('interviewDateFor returns the latest interview_at value (rebooking wins)', () => {
  assert.equal(interviewDateFor(TIMELINE, 85), '2026-06-05T14:00');
  assert.equal(interviewDateFor(TIMELINE, 120), null);
});

test('setInterviewDate appends an interview_at entry through the same guard', () => {
  const file = tmp();
  const e = { ts: '2026-06-12T10:00', num: 122, company: 'Compass', role: 'PM', neu: '2026-06-16T15:00', source: 'classify' };
  assert.equal(setInterviewDate(file, e), true);
  assert.equal(setInterviewDate(file, e), false); // idempotent re-fire
  const entries = loadHistory(file);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].field, 'interview_at');
  assert.equal(interviewDateFor(entries, 122), '2026-06-16T15:00');
});

// ── extractInterviewDateFromText — the five real-world fragments ─────────────

test("extract: 'booked 06-16 15:00 ET' (MM-DD + 24h, year from reference)", () => {
  assert.equal(
    extractInterviewDateFromText('booked 06-16 15:00 ET', { referenceDate: '2026-06-12' }),
    '2026-06-16T15:00',
  );
});

test("extract: '3pm-3:30pm on Tuesday, June 16' (range start, month-name date)", () => {
  assert.equal(
    extractInterviewDateFromText('3pm-3:30pm on Tuesday, June 16', { referenceDate: '2026-06-12' }),
    '2026-06-16T15:00',
  );
});

test("extract: 'Tue 9 Jun 2026 12:30pm' (day-first with explicit year)", () => {
  assert.equal(
    extractInterviewDateFromText('Tue 9 Jun 2026 12:30pm'),
    '2026-06-09T12:30',
  );
});

test("extract: '2026-06-16 15:00' (full ISO + 24h)", () => {
  assert.equal(
    extractInterviewDateFromText('2026-06-16 15:00'),
    '2026-06-16T15:00',
  );
});

test("extract: 'June 16 at 3pm' (month-name + bare 12h)", () => {
  assert.equal(
    extractInterviewDateFromText('June 16 at 3pm', { referenceDate: '2026-06-12' }),
    '2026-06-16T15:00',
  );
});

// ── extractInterviewDateFromText — pairing, year logic, conservatism ─────────

test('extract pairs the time with the NEAREST date (real tracker note #122)', () => {
  const note = 'Applied off-tracker 05-27 (Req MGRVP003484); recruiter Devyn Kelly invited screen 06-12, booked 06-16 15:00 ET (Teams)';
  assert.equal(
    extractInterviewDateFromText(note, { referenceDate: '2026-05-27' }),
    '2026-06-16T15:00', // NOT 05-27 or 06-12
  );
});

test('extract resolves year-less dates to the NEXT occurrence (rollover)', () => {
  assert.equal(
    extractInterviewDateFromText('Jan 5 at 2pm', { referenceDate: '2026-12-20' }),
    '2027-01-05T14:00',
  );
});

test('extract returns null for a date with no time (not a booking)', () => {
  assert.equal(extractInterviewDateFromText('interview scheduled 2026-05-27'), null);
  assert.equal(
    extractInterviewDateFromText('Screen 2026-06-11 (Kirsi Maharaj) PASSED strong', { referenceDate: '2026-05-26' }),
    null,
  );
});

test('extract returns null for a time with no date', () => {
  assert.equal(extractInterviewDateFromText('call at 3pm sharp', { referenceDate: '2026-06-12' }), null);
});

test('extract returns null when the year is unresolvable (no reference, no year)', () => {
  assert.equal(extractInterviewDateFromText('June 16 at 3pm'), null);
});

test('extract returns null when date and time are too far apart to be one appointment', () => {
  const far = '3pm works best for me. ' + 'x'.repeat(60) + ' We met back on June 16.';
  assert.equal(extractInterviewDateFromText(far, { referenceDate: '2026-06-12' }), null);
});

test('extract returns null on an ambiguous tie between two candidate datetimes', () => {
  assert.equal(
    extractInterviewDateFromText('either 06-12 3pm or 06-16 3pm', { referenceDate: '2026-06-10' }),
    null,
  );
});

test('extract handles 12:30pm and noon/midnight edges of the 12h clock', () => {
  assert.equal(extractInterviewDateFromText('2026-06-16 12:30pm'), '2026-06-16T12:30');
  assert.equal(extractInterviewDateFromText('2026-06-16 12pm'), '2026-06-16T12:00');
  assert.equal(extractInterviewDateFromText('2026-06-16 12am'), '2026-06-16T00:00');
});

test("extract does not misread month-adjacent years as days ('Jun 2026')", () => {
  // 'Jun 2026' must not parse as June 20; with no real day present → null.
  assert.equal(extractInterviewDateFromText('sometime in Jun 2026 around 3pm'), null);
});
