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
import { fileURLToPath } from 'url';

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

// --- Parse Gmail next-step flags ---
// The inbox scanner (apps/web/server.mjs) writes data/gmail-cache.json. A
// signal with type 'interview' that was neither auto-applied to the tracker
// nor filed quietly is a "possible next step" — an email that looks like the
// company moved, pending a human glance. Those ARE the follow-ups that
// matter most, so they surface here as urgent, ahead of cadence math.
function parseNextStepFlags() {
  if (!existsSync(GMAIL_CACHE_FILE)) return [];
  try {
    const cache = JSON.parse(readFileSync(GMAIL_CACHE_FILE, 'utf-8'));
    return (cache.signals || [])
      .filter(s => s.signal === 'interview' && !s.dismissed && !s.autoApplied)
      .map(s => ({ num: parseInt(s.num), subject: s.subject || '', date: s.date || '', from: s.from || '' }))
      .filter(s => Number.isFinite(s.num));
  } catch { return []; }
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
function computeUrgency(status, daysSinceApp, daysSinceLastFollowup, followupCount) {
  if (status === 'applied') {
    // Plain applications carry NO follow-up cadence — silence is a normal
    // outcome of volume applying. Opt-in only (followups.auto_applied /
    // --auto-applied) for users who want to chase every application.
    if (!AUTO_APPLIED) return 'waiting';
    if (followupCount >= CADENCE.applied_max_followups) return 'cold';
    if (followupCount === 0 && daysSinceApp >= CADENCE.applied_first) return 'overdue';
    if (followupCount > 0 && daysSinceLastFollowup !== null && daysSinceLastFollowup >= CADENCE.applied_subsequent) return 'overdue';
    return 'waiting';
  }
  if (status === 'responded' || status === 'interview') {
    // Live conversations: flag after a week of silence. The clock anchors to
    // the LAST logged touch (data/follow-ups.md), falling back to the
    // application date — so logging a nudge or a held interview resets it.
    const anchorDays = daysSinceLastFollowup !== null ? daysSinceLastFollowup : daysSinceApp;
    return anchorDays >= CADENCE.conversation_silence ? 'overdue' : 'waiting';
  }
  return 'waiting';
}

// --- Compute next follow-up date ---
function computeNextFollowupDate(status, appDate, lastFollowupDate, followupCount) {
  if (status === 'applied') {
    if (!AUTO_APPLIED) return null; // no cadence on plain applications
    if (followupCount >= CADENCE.applied_max_followups) return null; // cold
    if (followupCount === 0) return addDays(parseDate(appDate), CADENCE.applied_first);
    if (lastFollowupDate) return addDays(parseDate(lastFollowupDate), CADENCE.applied_subsequent);
    return addDays(parseDate(appDate), CADENCE.applied_first);
  }
  if (status === 'responded' || status === 'interview') {
    const anchor = lastFollowupDate || appDate;
    return addDays(parseDate(anchor), CADENCE.conversation_silence);
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

    const urgency = computeUrgency(normalized, daysSinceApp, daysSinceLastFollowup, followupCount);
    const nextFollowupDate = computeNextFollowupDate(normalized, app.date, lastFollowupDate, followupCount);
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
    });
  }

  // Gmail next-step flags upgrade their row to urgent — an email that looks
  // like the company moved beats any cadence clock.
  const flagsByNum = new Map();
  for (const flag of parseNextStepFlags()) {
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

  // Sort by urgency priority: urgent > overdue > waiting > cold
  const urgencyOrder = { urgent: 0, overdue: 1, waiting: 2, cold: 3 };
  entries.sort((a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9));

  const filtered = overdueOnly
    ? entries.filter(e => e.urgency === 'overdue' || e.urgency === 'urgent')
    : entries;

  return {
    metadata: {
      analysisDate: now.toISOString().split('T')[0],
      totalTracked: apps.length,
      actionable: entries.length,
      overdue: entries.filter(e => e.urgency === 'overdue').length,
      urgent: entries.filter(e => e.urgency === 'urgent').length,
      cold: entries.filter(e => e.urgency === 'cold').length,
      waiting: entries.filter(e => e.urgency === 'waiting').length,
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
  const urgencyIcon = { urgent: 'URGENT', overdue: 'OVERDUE', waiting: 'waiting', cold: 'COLD' };
  console.log(`  ${metadata.urgent} urgent | ${metadata.overdue} overdue | ${metadata.waiting} waiting | ${metadata.cold} cold\n`);

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

// --- Run ---
const result = analyze();

if (summaryMode) {
  printSummary(result);
} else {
  console.log(JSON.stringify(result, null, 2));
}

if (result.error) process.exit(1);
