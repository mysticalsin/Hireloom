#!/usr/bin/env node
/**
 * followup-cadence.mjs — Follow-up Cadence Tracker for career-ops
 *
 * Parses applications.md + follow-ups.md, calculates follow-up cadence
 * for active applications, extracts contacts, and flags overdue entries.
 *
 * Run: node engine/tracker/followup-cadence.mjs             (JSON to stdout)
 *      node engine/tracker/followup-cadence.mjs --summary   (human-readable dashboard)
 *      node engine/tracker/followup-cadence.mjs --overdue-only
 *      node engine/tracker/followup-cadence.mjs --applied-days 10
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const CAREER_OPS = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const APPS_FILE = existsSync(join(CAREER_OPS, 'data/applications.md'))
  ? join(CAREER_OPS, 'data/applications.md')
  : join(CAREER_OPS, 'applications.md');
const FOLLOWUPS_FILE = join(CAREER_OPS, 'data/follow-ups.md');
const GMAIL_CACHE_FILE = join(CAREER_OPS, 'data/gmail-cache.json');


// --- CLI args ---
const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const overdueOnly = args.includes('--overdue-only');
const appliedDaysIdx = args.indexOf('--applied-days');
const APPLIED_FIRST = appliedDaysIdx !== -1 ? parseInt(args[appliedDaysIdx + 1]) || 7 : 7;

// --- Follow-up policy ---
// An Applied role you never followed up on is NOT an obligation: silence is
// a normal outcome of volume applying, and nagging every application buries
// the follow-ups that matter. Cadence tracking starts only once you log the
// first follow-up for that application in data/follow-ups.md (or the company
// responds). Users who DO want to chase every application can opt back in
// with `followups: { auto_applied: true }` in config/profile.yml, or
// --auto-applied for a single run.
let AUTO_APPLIED = args.includes('--auto-applied');
if (!AUTO_APPLIED) {
  try {
    const { load } = await import('js-yaml');
    const prof = load(readFileSync(join(CAREER_OPS, 'config/profile.yml'), 'utf-8'));
    AUTO_APPLIED = prof?.followups?.auto_applied === true;
  } catch { /* no profile or no yaml — stay opt-in */ }
}

// --- Cadence config ---
const CADENCE = {
  applied_first: APPLIED_FIRST,
  applied_subsequent: 7,
  applied_max_followups: 2,
  conversation_silence: 7, // responded/interview: flag after a week of silence
};

// --- Status normalization (mirrors verify-pipeline.mjs) ---
const ALIASES = {
  'evaluada': 'evaluated', 'condicional': 'evaluated', 'hold': 'evaluated',
  'evaluar': 'evaluated', 'verificar': 'evaluated',
  'aplicado': 'applied', 'enviada': 'applied', 'aplicada': 'applied',
  'applied': 'applied', 'sent': 'applied',
  'respondido': 'responded',
  'entrevista': 'interview',
  'oferta': 'offer',
  'rechazado': 'rejected', 'rechazada': 'rejected',
  'descartado': 'discarded', 'descartada': 'discarded',
  'cerrada': 'discarded', 'cancelada': 'discarded',
  'no aplicar': 'skip', 'no_aplicar': 'skip', 'monitor': 'skip', 'geo blocker': 'skip',
};

const ACTIONABLE_STATUSES = ['applied', 'responded', 'interview'];

function normalizeStatus(raw) {
  const clean = raw.replace(/\*\*/g, '').trim().toLowerCase()
    .replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  return ALIASES[clean] || clean;
}

// --- Date helpers ---
function today() {
  return new Date(new Date().toISOString().split('T')[0]);
}

function parseDate(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) return null;
  return new Date(dateStr.trim());
}

function daysBetween(d1, d2) {
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().split('T')[0];
}

// --- Parse applications.md ---
function parseTracker() {
  if (!existsSync(APPS_FILE)) return [];
  const content = readFileSync(APPS_FILE, 'utf-8');
  const entries = [];
  for (const line of content.split('\n')) {
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

// --- Parse follow-ups.md ---
function parseFollowups() {
  if (!existsSync(FOLLOWUPS_FILE)) return [];
  const content = readFileSync(FOLLOWUPS_FILE, 'utf-8');
  const entries = [];
  for (const line of content.split('\n')) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 8) continue;
    const num = parseInt(parts[1]);
    if (isNaN(num)) continue;
    entries.push({
      num,
      appNum: parseInt(parts[2]),
      date: parts[3],
      company: parts[4],
      role: parts[5],
      channel: parts[6],
      contact: parts[7],
      notes: parts[8] || '',
    });
  }
  return entries;
}

// --- Parse Gmail inbound responses ---
// The inbox scanner (apps/web/server.mjs) writes data/gmail-cache.json.
// Two distinct things come out of it:
//
// 1. FLAGS — a signal of type 'interview' or 'unknown' that was neither
//    auto-applied to the tracker nor filed quietly, and that the user hasn't
//    already replied to (sent-mail detection), is a "check the email" item.
//    Those ARE the follow-ups that matter most, so they surface as urgent,
//    ahead of cadence math.
//
// 2. ANCHORS — EVERY inbound response email (interview/unknown, including
//    auto-applied ones) re-anchors the silence clock for its row. A response
//    received today on a 20-day-old application is a follow-up PENDING from
//    today, not 13 days overdue (the Hootsuite radar bug, 2026-06-12).
function parseInboundResponses() {
  if (!existsSync(GMAIL_CACHE_FILE)) return { flags: [], byNum: new Map() };
  try {
    const cache = JSON.parse(readFileSync(GMAIL_CACHE_FILE, 'utf-8'));
    const flags = [];
    const byNum = new Map();
    for (const s of (cache.signals || [])) {
      const num = parseInt(s.num);
      if (!Number.isFinite(num)) continue;
      if (!['interview', 'unknown'].includes(s.signal)) continue;
      const d = new Date(s.date || '');
      const inboundDate = isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      if (!s.dismissed && !s.autoApplied && !s.userResponded) {
        flags.push({ num, id: s.id || null, subject: s.subject || '', date: s.date || '', from: s.from || '', kind: s.signal });
      }
      if (inboundDate) {
        const prev = byNum.get(num);
        if (!prev || inboundDate > prev.inboundDate) {
          byNum.set(num, { inboundDate, userResponded: !!s.userResponded, respondedAt: s.respondedAt || null, from: s.from || '', subject: s.subject || '' });
        }
      }
    }
    return { flags, byNum };
  } catch { return { flags: [], byNum: new Map() }; }
}

// --- Extract contacts from notes ---
function extractContacts(notes) {
  if (!notes) return [];
  const contacts = [];
  const emailRegex = /[\w.-]+@[\w.-]+\.\w+/g;
  const emails = notes.match(emailRegex) || [];
  for (const email of emails) {
    // Try to extract name before email: "Emailed Name at" or "contact: Name"
    let name = null;
    const beforeEmail = notes.substring(0, notes.indexOf(email));
    const nameMatch = beforeEmail.match(/(?:Emailed|emailed|contact[:\s]+|to\s+)([A-Z][a-z]+ ?[A-Z]?[a-z]*)\s*(?:at|@|$)/i);
    if (nameMatch) name = nameMatch[1].trim();
    contacts.push({ email, name });
  }
  return contacts;
}

// --- Resolve report path ---
function resolveReportPath(reportField) {
  const match = reportField.match(/\]\(([^)]+)\)/);
  if (!match) return null;
  const fullPath = join(CAREER_OPS, match[1]);
  return existsSync(fullPath) ? match[1] : null;
}

// --- Compute urgency ---
// `inbound` (optional): { daysSinceInbound, awaitingReply } — the latest
// response email for this row and whether the user has yet to answer it.
export function computeUrgency(status, daysSinceApp, daysSinceLastFollowup, followupCount, inbound = null, autoApplied = AUTO_APPLIED) {
  if (status === 'applied') {
    // Plain applications carry NO follow-up cadence — silence is a normal
    // outcome of volume applying. Opt-in only (followups.auto_applied /
    // --auto-applied) for users who want to chase every application.
    if (!autoApplied) return 'waiting';
    if (followupCount >= CADENCE.applied_max_followups) return 'cold';
    if (followupCount === 0 && daysSinceApp >= CADENCE.applied_first) return 'overdue';
    if (followupCount > 0 && daysSinceLastFollowup !== null && daysSinceLastFollowup >= CADENCE.applied_subsequent) return 'overdue';
    return 'waiting';
  }
  if (status === 'responded' || status === 'interview') {
    // The company wrote and the user hasn't answered: that's a follow-up
    // PENDING from the day the response arrived — overdue only once the
    // response window lapses. Receipt date anchors it, NEVER application age.
    if (inbound && inbound.awaitingReply) {
      return inbound.daysSinceInbound >= CADENCE.conversation_silence ? 'overdue' : 'respond-pending';
    }
    // Otherwise: live conversation, flag after a week of silence. The clock
    // anchors to the MOST RECENT event — last logged touch (data/follow-ups.md)
    // or last inbound response — falling back to the application date.
    const anchors = [daysSinceLastFollowup, inbound ? inbound.daysSinceInbound : null, daysSinceApp]
      .filter(v => v !== null && v !== undefined);
    const anchorDays = anchors.length ? Math.min(...anchors) : 0;
    return anchorDays >= CADENCE.conversation_silence ? 'overdue' : 'waiting';
  }
  return 'waiting';
}

// --- Compute next follow-up date ---
export function computeNextFollowupDate(status, appDate, lastFollowupDate, followupCount, inboundDate = null, autoApplied = AUTO_APPLIED) {
  if (status === 'applied') {
    if (!autoApplied) return null; // no cadence on plain applications
    if (followupCount >= CADENCE.applied_max_followups) return null; // cold
    if (followupCount === 0) return addDays(parseDate(appDate), CADENCE.applied_first);
    if (lastFollowupDate) return addDays(parseDate(lastFollowupDate), CADENCE.applied_subsequent);
    return addDays(parseDate(appDate), CADENCE.applied_first);
  }
  if (status === 'responded' || status === 'interview') {
    // Anchor = the most recent of (last touch, last inbound response, apply date).
    const anchor = [lastFollowupDate, inboundDate, appDate]
      .filter(d => d && parseDate(d)).sort().pop();
    return addDays(parseDate(anchor || appDate), CADENCE.conversation_silence);
  }
  return null;
}

// --- Main analysis ---
function analyze() {
  const apps = parseTracker();
  if (apps.length === 0) {
    return { error: 'No applications found in tracker.' };
  }

  const followups = parseFollowups();

  // Group follow-ups by app number
  const followupsByApp = new Map();
  for (const fu of followups) {
    if (!followupsByApp.has(fu.appNum)) followupsByApp.set(fu.appNum, []);
    followupsByApp.get(fu.appNum).push(fu);
  }

  const inbound = parseInboundResponses();
  const now = today();
  const entries = [];

  for (const app of apps) {
    const normalized = normalizeStatus(app.status);
    if (!ACTIONABLE_STATUSES.includes(normalized)) continue;

    const appDate = parseDate(app.date);
    if (!appDate) continue;

    const daysSinceApp = daysBetween(appDate, now);
    const appFollowups = followupsByApp.get(app.num) || [];
    const followupCount = appFollowups.length;

    // Find most recent follow-up
    let lastFollowupDate = null;
    let daysSinceLastFollowup = null;
    if (appFollowups.length > 0) {
      const sorted = appFollowups.sort((a, b) => (a.date > b.date ? -1 : 1));
      lastFollowupDate = sorted[0].date;
      const lastDate = parseDate(lastFollowupDate);
      if (lastDate) daysSinceLastFollowup = daysBetween(lastDate, now);
    }

    // Latest inbound response email for this row (Gmail), if any.
    const inb = inbound.byNum.get(app.num) || null;
    let inboundInfo = null;
    if (inb) {
      const inbDate = parseDate(inb.inboundDate);
      const daysSinceInbound = inbDate ? daysBetween(inbDate, now) : null;
      // "Awaiting reply" = no sent-mail reply detected AND no touch logged on
      // or after the day the response arrived.
      const touchCovers = lastFollowupDate && lastFollowupDate >= inb.inboundDate;
      if (daysSinceInbound !== null) {
        inboundInfo = { daysSinceInbound, awaitingReply: !inb.userResponded && !touchCovers };
      }
    }

    const urgency = computeUrgency(normalized, daysSinceApp, daysSinceLastFollowup, followupCount, inboundInfo);
    const nextFollowupDate = computeNextFollowupDate(normalized, app.date, lastFollowupDate, followupCount, inb ? inb.inboundDate : null);
    const nextDate = nextFollowupDate ? parseDate(nextFollowupDate) : null;
    const daysUntilNext = nextDate ? daysBetween(now, nextDate) : null;

    const contacts = extractContacts(app.notes);
    const reportPath = resolveReportPath(app.report);

    entries.push({
      num: app.num,
      date: app.date,
      company: app.company,
      role: app.role,
      status: normalized,
      score: app.score,
      notes: app.notes,
      reportPath,
      contacts,
      daysSinceApplication: daysSinceApp,
      daysSinceLastFollowup,
      followupCount,
      urgency,
      nextFollowupDate,
      daysUntilNext,
      // Inbound-response context (null when no response email is on file):
      inboundDate: inb ? inb.inboundDate : null,
      awaitingReply: !!(inboundInfo && inboundInfo.awaitingReply),
      respondedByUser: !!(inb && inb.userResponded),
      respondBy: inboundInfo && inboundInfo.awaitingReply ? addDays(parseDate(inb.inboundDate), CADENCE.conversation_silence) : null,
      inboundFrom: inb ? inb.from : null,
      // The user's side of the conversation clock (the radar shows both
      // dates plus a countdown to the next nudge): last logged touch from
      // data/follow-ups.md, and the sent-mail reply date when Gmail saw one.
      lastTouchDate: lastFollowupDate || null,
      respondedAt: inb && inb.respondedAt ? String(inb.respondedAt).slice(0, 10) : null,
    });
  }

  // Gmail next-step flags upgrade their row to urgent — an email that looks
  // like the company moved beats any cadence clock.
  const flagsByNum = new Map();
  for (const flag of inbound.flags) {
    if (!flagsByNum.has(flag.num)) flagsByNum.set(flag.num, []);
    flagsByNum.get(flag.num).push(flag);
  }
  for (const e of entries) {
    const flags = flagsByNum.get(e.num);
    if (flags?.length) {
      e.urgency = 'urgent';
      e.nextStepEmail = flags[flags.length - 1]; // newest-scanned flag for the row
    }
  }

  // Sort by urgency priority: urgent > overdue > respond-pending > waiting > cold
  const urgencyOrder = { urgent: 0, overdue: 1, 'respond-pending': 2, waiting: 3, cold: 4 };
  entries.sort((a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9));

  const filtered = overdueOnly
    ? entries.filter(e => e.urgency === 'overdue' || e.urgency === 'urgent')
    : entries;

  const count = (u) => entries.filter(e => e.urgency === u).length;
  return {
    metadata: {
      analysisDate: now.toISOString().split('T')[0],
      totalTracked: apps.length,
      actionable: entries.length,
      overdue: count('overdue'),
      urgent: count('urgent'),
      respondPending: count('respond-pending'),
      // "Pending" = everything that needs the user's action now (includes
      // overdue) — the dashboard's "follow-ups pending" headline number.
      pending: count('overdue') + count('urgent') + count('respond-pending'),
      cold: count('cold'),
      waiting: count('waiting'),
    },
    entries: filtered,
    cadenceConfig: CADENCE,
  };
}

// --- Summary mode ---
function printSummary(result) {
  if (result.error) {
    console.log(`\n${result.error}\n`);
    return;
  }

  const { metadata, entries } = result;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  Follow-up Cadence Dashboard — ${metadata.analysisDate}`);
  console.log(`  ${metadata.totalTracked} total applications, ${metadata.actionable} actionable`);
  console.log(`${'='.repeat(70)}\n`);

  if (entries.length === 0) {
    console.log('  No active applications to track. Apply to some roles first.\n');
    return;
  }

  // Status summary
  const urgencyIcon = { urgent: 'URGENT', overdue: 'OVERDUE', 'respond-pending': 'RESPOND', waiting: 'waiting', cold: 'COLD' };
  console.log(`  ${metadata.pending} pending (${metadata.urgent} urgent | ${metadata.overdue} overdue | ${metadata.respondPending} respond) | ${metadata.waiting} waiting | ${metadata.cold} cold\n`);

  // Table header
  console.log('  ' + '#'.padEnd(5) + 'Company'.padEnd(16) + 'Status'.padEnd(12) + 'Days'.padEnd(6) + 'F/U'.padEnd(5) + 'Next'.padEnd(13) + 'Urgency'.padEnd(10) + 'Contact');
  console.log('  ' + '-'.repeat(80));

  for (const e of entries) {
    const urgLabel = urgencyIcon[e.urgency] || e.urgency;
    const nextStr = e.nextFollowupDate || '-';
    const contactStr = e.contacts.length > 0 ? e.contacts[0].email : '-';
    console.log(
      '  ' +
      String(e.num).padEnd(5) +
      e.company.substring(0, 15).padEnd(16) +
      e.status.padEnd(12) +
      String(e.daysSinceApplication).padEnd(6) +
      String(e.followupCount).padEnd(5) +
      nextStr.padEnd(13) +
      urgLabel.padEnd(10) +
      contactStr
    );
  }

  console.log('');
}

// --- Run (only when executed directly — the pure helpers above are imported
// by tests/followup-cadence.test.mjs without triggering an analysis) ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = analyze();

  if (summaryMode) {
    printSummary(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }

  if (result.error) process.exit(1);
}
