// email-groups.mjs — pure conversation grouping for the Inbox / Needs Review /
// Follow-up surfaces. One group per APPLICATION (company+role), not per Gmail
// thread: a real SMS Equipment arc spanned 3 threads (invite → reply-thread →
// rejection) plus a duplicate invite (two msg ids, same from+subject, 13s
// apart) — threadId grouping rendered 3+ cards for one conversation. Kong had
// 8 signals across 5 threads where the user's single reply had to count for
// the whole application, and replies can be FRESH emails to the recruiter
// (different thread entirely), so recipient/domain matching is required.
// No I/O here — callers load the cache/sent entries and pass data in
// (tests/email-groups.test.mjs).

// Near-duplicate window: the SMS duplicate invite arrived 13s after the
// original; 15 minutes catches resend hiccups without eating genuine
// follow-ups (two real Kong reminders 17m42s apart must stay separate).
export const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;
// "Respond by" horizon — mirrors the follow-up cadence rule (7 days of
// silence on a live conversation). Applies to the LATEST inbound only.
export const RESPOND_BY_DAYS = 7;

// Freemail roots — mirrors FREEMAIL_RE in apps/web/server.mjs (not importable
// here: server.mjs is a side-effecting entrypoint). A sent mail to ANY address
// at a freemail domain proves nothing about THIS conversation.
export const FREEMAIL_ROOTS = new Set(['gmail', 'googlemail', 'outlook', 'hotmail',
  'live', 'yahoo', 'icloud', 'me', 'proton', 'protonmail', 'aol']);
// Shared ATS / scheduling domains — many companies send from the same
// hire.lever.co or goodtime.io, so a domain-level sent-mail match across one
// of these is ambiguous and must never mark a group handled (rule d).
export const ATS_DOMAINS = ['greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'ashbyhq.com',
  'ashby-mail.com', 'myworkday.com', 'myworkdayjobs.com', 'workday.com', 'smartrecruiters.com',
  'icims.com', 'jobvite.com', 'bamboohr.com', 'workable.com', 'taleo.net', 'successfactors.com',
  'oraclecloud.com', 'indeed.com', 'linkedin.com', 'ziprecruiter.com', 'goodtime.io', 'calendly.com'];

export function isFreemail(domain) {
  const labels = String(domain || '').toLowerCase().split('.');
  // Registrable root ("foo.gmail.com" → "gmail") — same intent as the server's
  // /^(gmail|...)\./ test against the root label.
  return labels.length >= 2 && FREEMAIL_ROOTS.has(labels[labels.length - 2]);
}

export function isAts(domain) {
  const d = String(domain || '').toLowerCase();
  // Suffix match so "hire.lever.co" hits "lever.co" (hostMatches-style, never substring).
  return ATS_DOMAINS.some(a => d === a || d.endsWith('.' + a));
}

// "Michelle Parker <mparker@smsequip.com>" / bare "Devyn.Kelly@compass-canada.com"
// → lowercased address, or '' when none found.
export function senderEmail(from) {
  const s = String(from || '');
  const angled = s.match(/<([^<>\s]+@[^<>\s]+)>/);
  const m = angled ? angled[1] : (s.match(/[\w.+-]+@[\w.-]+/) || [])[0];
  return (m || '').toLowerCase();
}

const parseDate = (d, fallback = 0) => {
  const t = Date.parse(d || '');
  return Number.isFinite(t) ? t : fallback;
};
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
// Identity normalizer for company/role names: punctuation drift ("Sr." vs
// "Sr") must not split a group.
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  // Title-abbreviation folds so 'Senior Program Manager' and 'Sr Program
  // Manager - Engineering Operations' read as one role, not two.
  .replace(/\bsenior\b/g, 'sr').replace(/\bjunior\b/g, 'jr').replace(/\bsr\.\s/g, 'sr ');

// Strip Re:/Fwd:/Fw:/Canceled:/Updated: prefixes (repeatedly — "Re: Fwd: Re:"
// is real), zero-width chars, collapse whitespace, lowercase. This is the
// subject IDENTITY for dedupe and display, so a "Canceled: Interview
// Invitation" update folds into the same conversation as the invite.
export function normalizeSubject(s) {
  let t = String(s || '').replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '');
  const prefix = /^\s*(?:re|fwd?|fw|cancell?ed|updated)\s*:\s*/i;
  while (prefix.test(t)) t = t.replace(prefix, '');
  return t.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Drop near-duplicates: same normalized subject + same sender address within
// DUPLICATE_WINDOW_MS of the kept anchor → keep the EARLIEST id (stable:
// date asc, input order breaks ties). User-action flags on a dropped dup
// (userResponded etc.) are merged onto the survivor — the user may have acted
// on either copy, and losing the flag would un-handle the group.
export function dedupeSignals(signals) {
  const list = signals || [];
  const asc = list.map((s, i) => ({ s, i, t: parseDate(s.date) }))
    .sort((a, b) => a.t - b.t || a.i - b.i);
  const anchors = []; // earliest survivor per (subject, sender) cluster
  const drop = new Set(); const mergeInto = new Map(); // dropped idx → kept idx
  for (const cur of asc) {
    const subj = normalizeSubject(cur.s.subject);
    const email = senderEmail(cur.s.from);
    const hit = anchors.find(a => a.subj === subj && a.email === email && cur.t - a.t <= DUPLICATE_WINDOW_MS);
    if (hit) { drop.add(cur.i); mergeInto.set(cur.i, hit.i); }
    else anchors.push({ subj, email, t: cur.t, i: cur.i });
  }
  const copies = new Map(); // kept idx → flag-merged shallow copy
  for (const [di, ki] of mergeInto) {
    const dup = list[di];
    const base = copies.get(ki) || { ...list[ki] };
    for (const f of ['userResponded', 'dismissed', 'touchLogged']) if (dup[f]) base[f] = dup[f];
    for (const f of ['respondedAt', 'userReplyId', 'userReplyTo', 'classified', 'autoApplied']) {
      if (dup[f] && !base[f]) base[f] = dup[f];
    }
    copies.set(ki, base);
  }
  const out = [];
  list.forEach((s, i) => { if (!drop.has(i)) out.push(copies.get(i) || s); });
  return out;
}

// Build lookup maps from cache.sentIndex entries [{id, threadId, to, date}].
// Values are epoch-ms of the NEWEST sent mail per key (groupSignals also
// tolerates date strings for hand-built indexes).
export function buildSentIndex(sentEntries) {
  const byThread = new Map(), byRecipient = new Map(), byDomain = new Map();
  const keepNewest = (map, key, t) => {
    if (!key) return;
    const prev = map.get(key);
    if (prev == null || t > prev) map.set(key, t);
  };
  for (const e of sentEntries || []) {
    const t = parseDate(e.date);
    keepNewest(byThread, e.threadId, t);
    // 'to' may be a list with display names — index every address in it.
    for (const m of String(e.to || '').matchAll(/[\w.+-]+@[\w.-]+\w/g)) {
      const addr = m[0].toLowerCase();
      keepNewest(byRecipient, addr, t);
      keepNewest(byDomain, addr.split('@')[1], t);
    }
  }
  return { byThread, byRecipient, byDomain };
}

const sentAt = (map, key) => {
  if (!map || key == null || typeof map.get !== 'function') return null;
  const v = map.get(key);
  if (v == null) return null;
  return typeof v === 'number' ? v : parseDate(v, null);
};

// One group per application. Key: tracker num when matched ('t'+num — multi-
// role companies split per num by construction); else normalized company +
// normalized role (signal.role or signal.extractedRole); else company alone.
export function groupSignals({ signals = [], sentIndex = null, touchesByNum = null, now = Date.now() } = {}) {
  const deduped = dedupeSignals(signals);
  const buckets = new Map();
  for (const s of deduped) {
    const role = String(s.role || s.extractedRole || '').trim();
    const key = (s.num != null && s.num !== '')
      ? 't' + String(s.num)
      : normName(s.company) + (role ? '::' + normName(role) : '');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(s);
  }

  const groups = [];
  for (const [key, members] of buckets) {
    const emails = members.map((s, i) => ({ s, i, t: parseDate(s.date, now) }))
      .sort((a, b) => b.t - a.t || a.i - b.i); // newest first, stable
    const latest = emails[0].s;
    const latestT = emails[0].t;

    const num = members.find(s => s.num != null && s.num !== '')?.num ?? null;
    const roles = [], seenRoles = new Set();
    for (const { s } of emails) {
      const r = String(s.role || s.extractedRole || '').trim();
      const k = normName(r);
      if (r && !seenRoles.has(k)) { seenRoles.add(k); roles.push(r); }
    }
    const kinds = [...new Set(emails.map(e => e.s.signal))];
    // Latest known tracker status as cached — the integrator overwrites this
    // with the LIVE tracker row; we still emit what the cache knew.
    const status = emails.find(e => e.s.currentStatus != null)?.s.currentStatus ?? null;

    // ── handled (app-scoped, checked in priority order a→e) ────────────────
    let handled = false, handledBy = null, repliedAt = null;
    // (a) the user replied to ANY email of this application — even in another
    // thread (the Kong fix: one reply counts for all 5 threads).
    const replied = emails.map(e => e.s).filter(s => s.userResponded);
    if (replied.length) {
      handled = true; handledBy = 'reply';
      repliedAt = replied.map(s => s.respondedAt).filter(Boolean).sort().pop() || null;
    }
    // (b) sent mail in the latest inbound's thread, at/after it.
    if (!handled) {
      const at = sentAt(sentIndex?.byThread, latest.threadId);
      if (at != null && at >= latestT) { handled = true; handledBy = 'sent-thread'; repliedAt = new Date(at).toISOString(); }
    }
    // (c) sent mail TO the latest inbound's sender — catches fresh composes
    // to the recruiter that share no thread with the inbound.
    const sender = senderEmail(latest.from);
    if (!handled && sender) {
      const at = sentAt(sentIndex?.byRecipient, sender);
      if (at != null && at >= latestT) { handled = true; handledBy = 'sent-recipient'; repliedAt = new Date(at).toISOString(); }
    }
    // (d) sent mail to ANYONE at the sender's domain — only meaningful for a
    // real corporate domain. Freemail/ATS domains are shared across the world
    // (everyone mails someone@gmail.com; every Lever client is hire.lever.co),
    // so a match there proves nothing and must not mark handled.
    if (!handled && sender) {
      const domain = sender.split('@')[1] || '';
      if (domain && !isFreemail(domain) && !isAts(domain)) {
        const at = sentAt(sentIndex?.byDomain, domain);
        if (at != null && at >= latestT) { handled = true; handledBy = 'sent-domain'; repliedAt = new Date(at).toISOString(); }
      }
    }
    // (e) a logged follow-up touch (data/follow-ups.md, date-only) on/after
    // the latest inbound's day.
    if (!handled && num != null && touchesByNum && typeof touchesByNum.get === 'function') {
      const touch = touchesByNum.get(num) ?? touchesByNum.get(String(num)) ?? touchesByNum.get(Number(num));
      if (touch && touch >= isoDay(latestT)) { handled = true; handledBy = 'touch'; repliedAt = touch; }
    }

    groups.push({
      key,
      num,
      company: latest.company || members.find(s => s.company)?.company || '',
      roles,
      status,
      emails: emails.map(e => e.s),
      latest,
      latestDate: new Date(latestT).toISOString(),
      kinds,
      // Respond-by applies to the latest inbound only (per spec).
      respondBy: isoDay(latestT + RESPOND_BY_DAYS * 86400000),
      handled, handledBy, repliedAt,
    });
  }
  return groups.sort((a, b) => (a.latestDate < b.latestDate ? 1 : a.latestDate > b.latestDate ? -1 : 0));
}

// Inbox surface: groups with at least one live (non-dismissed) email, plus the
// passive tallies. dismissed-without-autoApplied = quietly auto-filed
// confirmation; autoApplied = the auto-sort wrote the tracker.
export function groupsForInbox(groups) {
  const all = groups || [];
  let autoFiledCount = 0, autoAppliedCount = 0;
  for (const g of all) {
    for (const s of g.emails) {
      if (s.autoApplied) autoAppliedCount++;
      else if (s.dismissed) autoFiledCount++;
    }
  }
  return { live: all.filter(g => g.emails.some(s => !s.dismissed)), autoFiledCount, autoAppliedCount };
}

// An email that needs the user's eyes. Cached signals carry no `confident`
// flag — confidence is encoded as autoApplied (confident → auto-written), so
// interview signals WITHOUT autoApplied are the non-confident flags.
const needsReview = (s, unmatched) =>
  unmatched ||
  s.signal === 'unknown' ||
  (s.signal === 'interview' && !s.autoApplied && s.confident !== true);
// classification (or dismissal) is the terminal state for a review item.
export const isResolved = (s) => Boolean(s.dismissed || s.classified);

// Statuses where the user already KNOWS where the application stands —
// either a live conversation he is driving (responded/interview/offer) or a
// row he deliberately closed. Ambiguous chatter on these never needs a
// review card (user rule, 2026-06-13: "Amaris is in needs review even though
// you know the status — don't do that; I'll update when I get an update, or
// you automatically on a confident signal"). Review is for UNRESOLVED roles:
// unmatched senders, pool-only applies awaiting a tracker row, and
// applied/evaluated rows whose response could mean anything.
export const NO_REVIEW_STATUSES = new Set(['responded', 'interview', 'offer',
  'rejected', 'discarded', 'skip', 'expired']);

// Does a signal still need the user's eyes? Shared with the server so role
// pages / All Roles can show "pending your review" instead of a real status
// (user rule: a role in Needs Review has NO status until he classifies it).
// No tracker num = unmatched OR pool-only — both review like unmatched
// groups do (every email needs eyes until a row exists).
export function signalPendingReview(s) {
  return needsReview(s, s.num == null || s.num === '') && !isResolved(s);
}

// Needs Review surface: groups with ≥1 unresolved review email — unknown
// responses, unmatched groups (no tracker num: ALL their emails need eyes),
// non-confident interview flags. HANDLED groups STAY here until classified
// (handled:true lets the UI show "✓ you already replied" — the Amaris fix:
// a replied-to unknown was suppressed before, leaving it unclassifiable).
// Groups whose role already has a known/closed status are EXEMPT entirely.
export function groupsForReview(groups) {
  const out = [];
  for (const g of groups || []) {
    if (NO_REVIEW_STATUSES.has(String(g.status || '').toLowerCase())) continue;
    const unmatched = g.num == null;
    const pending = g.emails.filter(s => needsReview(s, unmatched) && !isResolved(s));
    if (!pending.length) continue;
    const reason = unmatched ? 'unmatched'
      : pending.some(s => s.signal === 'unknown') ? 'unknown'
      : 'unconfident-interview';
    out.push({ ...g, reviewReason: reason, reviewEmails: pending });
  }
  return out;
}
