import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSubject, dedupeSignals, buildSentIndex, groupSignals,
  groupsForInbox, groupsForReview, senderEmail, isFreemail, isAts,
} from '../apps/web/lib/email-groups.mjs';

// Minimal cached-signal shape (data/gmail-cache.json) with overrides.
const sig = (over = {}) => ({
  id: 'x', threadId: null, num: null, company: '', role: '', currentStatus: null,
  signal: 'unknown', subject: '', snippet: '', from: '', date: '',
  suggestedStatus: null, dismissed: false, ...over,
});

// ── normalizeSubject ────────────────────────────────────────────────────────

test('normalizeSubject strips stacked reply/forward/calendar prefixes', () => {
  assert.equal(normalizeSubject('Re: FW: Fwd: Updated: Interview Invitation'), 'interview invitation');
  assert.equal(
    normalizeSubject('Canceled: Interview Invitation - Business Systems PM'),
    normalizeSubject('Interview Invitation - Business Systems PM'));
});

test('normalizeSubject strips zero-width chars and collapses whitespace', () => {
  assert.equal(normalizeSubject('Re:​  Interview­   Invitation﻿ '), 'interview invitation');
  assert.equal(normalizeSubject(null), '');
});

// ── dedupeSignals ───────────────────────────────────────────────────────────

const DUP_A = sig({ id: 'a', subject: 'Interview Invitation - PM', from: 'M <m@x.com>', date: 'Wed, 3 Jun 2026 15:46:20 +0000' });
const DUP_B = sig({ id: 'b', subject: 'Re: Interview Invitation - PM', from: 'M <m@x.com>', date: 'Wed, 3 Jun 2026 15:46:33 +0000' });

test('dedupe drops the 13s near-duplicate and keeps the EARLIEST id', () => {
  const out = dedupeSignals([DUP_B, DUP_A]); // input order must not matter
  assert.deepEqual(out.map(s => s.id), ['a']);
});

test('dedupe merges user-action flags from the dropped copy onto the survivor', () => {
  // The user may have replied to EITHER copy of a duplicate invite — losing
  // the flag would un-handle the group.
  const out = dedupeSignals([DUP_A, { ...DUP_B, userResponded: true, respondedAt: '2026-06-03T16:00:00.000Z' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'a');
  assert.equal(out[0].userResponded, true);
  assert.equal(out[0].respondedAt, '2026-06-03T16:00:00.000Z');
});

test('dedupe keeps same subject+sender outside the 15-minute window (the 17m42s Kong reminders)', () => {
  const later = { ...DUP_B, id: 'b2', date: 'Wed, 3 Jun 2026 16:04:21 +0000' }; // 18m01s after A
  assert.equal(dedupeSignals([DUP_A, later]).length, 2);
});

test('dedupe keeps same subject from a DIFFERENT sender within the window', () => {
  const other = { ...DUP_B, id: 'b3', from: 'Other <other@x.com>' };
  assert.equal(dedupeSignals([DUP_A, other]).length, 2);
});

// ── buildSentIndex ──────────────────────────────────────────────────────────

test('buildSentIndex indexes every recipient, domains, and newest-wins per key', () => {
  const idx = buildSentIndex([
    { id: 's1', threadId: 'th-1', to: 'Kevin <kevin@konghq.com>, jane@acme.com', date: 'Tue, 9 Jun 2026 10:00:00 +0000' },
    { id: 's2', threadId: 'th-1', to: 'kevin@konghq.com', date: 'Wed, 10 Jun 2026 10:00:00 +0000' },
  ]);
  assert.equal(idx.byThread.get('th-1'), Date.parse('Wed, 10 Jun 2026 10:00:00 +0000')); // newest wins
  assert.equal(idx.byRecipient.get('kevin@konghq.com'), Date.parse('Wed, 10 Jun 2026 10:00:00 +0000'));
  assert.equal(idx.byRecipient.get('jane@acme.com'), Date.parse('Tue, 9 Jun 2026 10:00:00 +0000'));
  assert.equal(idx.byDomain.get('acme.com'), Date.parse('Tue, 9 Jun 2026 10:00:00 +0000'));
});

test('senderEmail parses display-name and bare forms; freemail/ATS predicates', () => {
  assert.equal(senderEmail('Michelle Parker <MParker@smsequip.com>'), 'mparker@smsequip.com');
  assert.equal(senderEmail('Devyn.Kelly@compass-canada.com'), 'devyn.kelly@compass-canada.com');
  assert.equal(isFreemail('gmail.com'), true);
  assert.equal(isFreemail('konghq.com'), false);
  assert.equal(isAts('hire.lever.co'), true); // suffix, not substring
  assert.equal(isAts('cleverco.com'), false);
});

// ── the SMS Equipment arc: 3 threads + 13s duplicate → ONE group ────────────

const SMS_ROLE = 'Business Systems, Continuous Improvement Project Manager';
const SMS_SUBJ = 'Interview Invitation - Business Systems, Continuous Improvement Project Manager - Acheson, AB';
const SMS = [
  sig({ id: 'sms-inv', threadId: 'th-A', company: 'SMS Equipment', extractedRole: SMS_ROLE, signal: 'interview',
    subject: SMS_SUBJ, from: 'Michelle Parker <mparker@smsequip.com>', date: 'Wed, 3 Jun 2026 15:46:20 +0000' }),
  // The real duplicate: second msg id, same from+subject, 13 seconds later.
  sig({ id: 'sms-inv-dup', threadId: 'th-A', company: 'SMS Equipment', extractedRole: SMS_ROLE, signal: 'interview',
    subject: SMS_SUBJ, from: 'Michelle Parker <mparker@smsequip.com>', date: 'Wed, 3 Jun 2026 15:46:33 +0000' }),
  // Recruiter reply landed in a SECOND thread.
  sig({ id: 'sms-reply', threadId: 'th-B', company: 'SMS Equipment', extractedRole: SMS_ROLE, signal: 'interview',
    subject: 'Re: ' + SMS_SUBJ, from: 'Michelle Parker <mparker@smsequip.com>', date: 'Fri, 5 Jun 2026 19:08:38 +0000' }),
  // The 06-05 rejection arrived in a THIRD thread.
  sig({ id: 'sms-reject', threadId: 'th-C', company: 'SMS Equipment', extractedRole: SMS_ROLE, signal: 'rejected',
    subject: 'Follow up on your SMS Equipment Application - Business Systems, Continuous Improvement Project Manager',
    from: 'Michelle Parker <mparker@smsequip.com>', date: 'Fri, 5 Jun 2026 19:10:10 +0000' }),
];

test('SMS arc: 3 threads + duplicate collapse to ONE group keyed by company+role', () => {
  const groups = groupSignals({ signals: SMS });
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.equal(g.key, 'sms equipment::business systems continuous improvement project manager');
  assert.equal(g.num, null);
  assert.equal(g.company, 'SMS Equipment');
  assert.deepEqual(g.roles, [SMS_ROLE]);
  // Duplicate dropped (earliest copy survives), newest first.
  assert.deepEqual(g.emails.map(s => s.id), ['sms-reject', 'sms-reply', 'sms-inv']);
  assert.equal(g.latest.id, 'sms-reject');
  assert.deepEqual(g.kinds, ['rejected', 'interview']);
  // respondBy anchors to the NEWEST inbound (the 06-05 rejection) + 7 days.
  assert.equal(g.respondBy, '2026-06-12');
  assert.equal(g.handled, false);
});

test('SMS arc: unmatched group lands in Needs Review (reason: unmatched)', () => {
  const review = groupsForReview(groupSignals({ signals: SMS }));
  assert.equal(review.length, 1);
  assert.equal(review[0].reviewReason, 'unmatched');
  assert.equal(review[0].reviewEmails.length, 3); // every email of an unmatched group needs eyes
  assert.equal(review[0].respondBy, '2026-06-12');
});

// ── the Kong arc: 5 threads, one app — a reply ANYWHERE counts for all ──────

const kong = (over) => sig({ num: '120', company: 'Kong', role: 'Senior Program Manager, Engineering Operations',
  currentStatus: 'interview', signal: 'interview', dismissed: true, ...over });
const KONG = [
  kong({ id: 'k1', threadId: 'kth-1', subject: "Hi Ramy! You're invited to an interview with Kong!",
    from: 'Kong <no-reply@us.greenhouse-mail.io>', date: 'Mon, 1 Jun 2026 18:26:35 -0700' }),
  kong({ id: 'k2', threadId: 'kth-2', subject: "Ramy, you're confirmed for your interview with Kong!",
    from: 'Kong <no-reply@us.greenhouse-mail.io>', date: 'Mon, 1 Jun 2026 18:36:29 -0700' }),
  kong({ id: 'k3', threadId: 'kth-3', subject: 'Invitation from an unknown sender: Interview with Kong', signal: 'verification',
    from: 'Google Calendar <calendar-notification@google.com>', date: 'Tue, 02 Jun 2026 01:36:36 +0000' }),
  kong({ id: 'k4', threadId: 'kth-4', subject: "Re: Ramy, you're confirmed for your interview with Kong!",
    from: 'Kong <no-reply@us.greenhouse-mail.io>', date: 'Tue, 9 Jun 2026 12:12:51 -0400' }),
  kong({ id: 'k5', threadId: 'kth-5', subject: 'Following up on your interview', signal: 'unknown', dismissed: false,
    from: 'Kevin Coverson <kevin.coverson@konghq.com>', date: 'Wed, 10 Jun 2026 09:00:00 +0000' }),
];

test('Kong: 5 threads → one group; fresh-compose reply found via byRecipient marks it handled', () => {
  // The user's reply was a FRESH email to the recruiter — its thread (kth-9)
  // matches none of the 5 inbound threads, so only recipient matching works.
  const sentIndex = buildSentIndex([
    { id: 's1', threadId: 'kth-9', to: 'Kevin Coverson <kevin.coverson@konghq.com>', date: 'Wed, 10 Jun 2026 15:00:00 +0000' },
  ]);
  const groups = groupSignals({ signals: KONG, sentIndex });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, 't120');
  assert.equal(groups[0].handled, true);
  assert.equal(groups[0].handledBy, 'sent-recipient');
  // Control: without the sent index the group is unhandled.
  assert.equal(groupSignals({ signals: KONG })[0].handled, false);
});

test('sent-thread: a sent mail in the latest inbound thread handles; an OLDER one does not', () => {
  const mail = sig({ id: 'm1', threadId: 'th-Z', num: '7', company: 'Acme', signal: 'unknown',
    from: 'Pat <pat@acme.com>', date: 'Wed, 10 Jun 2026 09:00:00 +0000' });
  const after = buildSentIndex([{ id: 's', threadId: 'th-Z', to: 'pat@acme.com', date: 'Wed, 10 Jun 2026 10:00:00 +0000' }]);
  const g1 = groupSignals({ signals: [mail], sentIndex: after })[0];
  assert.equal(g1.handledBy, 'sent-thread');
  // Reply BEFORE the latest inbound = a new inbound arrived since → unhandled.
  const before = buildSentIndex([{ id: 's', threadId: 'th-Z', to: 'pat@acme.com', date: 'Tue, 9 Jun 2026 10:00:00 +0000' }]);
  assert.equal(groupSignals({ signals: [mail], sentIndex: before })[0].handled, false);
});

// ── the Amaris suppression bug ──────────────────────────────────────────────

const AMARIS = sig({ id: 'am1', threadId: 'ath-1', num: '85', company: 'Amaris Consulting',
  role: 'Senior Business Delivery Manager', currentStatus: 'applied', signal: 'unknown',
  subject: 'Amaris Consulting Recruitment Process', from: 'Recruiter <recruit@amaris.com>',
  date: 'Tue, 2 Jun 2026 14:10:22 +0000', userResponded: true, respondedAt: '2026-06-02T15:00:00.000Z' });

test('Amaris: replied-to unknown is handled BUT stays in review until classified', () => {
  const groups = groupSignals({ signals: [AMARIS] });
  assert.equal(groups[0].handled, true);
  assert.equal(groups[0].handledBy, 'reply');
  assert.equal(groups[0].repliedAt, '2026-06-02T15:00:00.000Z');
  // The old behavior suppressed handled groups from review — the email then
  // could never be classified. It must stay, marked handled, for the
  // "✓ you already replied" treatment.
  const review = groupsForReview(groups);
  assert.equal(review.length, 1);
  assert.equal(review[0].handled, true);
  assert.equal(review[0].reviewReason, 'unknown');
});

test('classification is terminal: classified emails leave review', () => {
  const groups = groupSignals({ signals: [{ ...AMARIS, classified: 'follow-up' }] });
  assert.equal(groupsForReview(groups).length, 0);
  // ...and the group itself still exists for the inbox surface.
  assert.equal(groups.length, 1);
});

// ── domain rules for handled ────────────────────────────────────────────────

test('freemail domain does NOT mark handled via byDomain', () => {
  const mail = sig({ id: 'f1', threadId: 'fth', num: '3', company: 'Acme', signal: 'unknown',
    from: 'Bob Recruiter <bob.recruiter@gmail.com>', date: 'Wed, 10 Jun 2026 09:00:00 +0000' });
  // Sent to a DIFFERENT gmail address: byRecipient misses, byDomain has
  // gmail.com — which proves nothing (everyone mails someone at gmail).
  const sentIndex = buildSentIndex([{ id: 's', threadId: 'other', to: 'aunt.judy@gmail.com', date: 'Wed, 10 Jun 2026 12:00:00 +0000' }]);
  assert.equal(groupSignals({ signals: [mail], sentIndex })[0].handled, false);
});

test('ATS domain does NOT mark handled via byDomain; a corporate domain DOES', () => {
  const ats = sig({ id: 'a1', threadId: 'ath', num: '4', company: 'Acme', signal: 'unknown',
    from: 'Acme <no-reply@hire.lever.co>', date: 'Wed, 10 Jun 2026 09:00:00 +0000' });
  const atsIdx = buildSentIndex([{ id: 's', threadId: 'z', to: 'jobs@hire.lever.co', date: 'Wed, 10 Jun 2026 12:00:00 +0000' }]);
  assert.equal(groupSignals({ signals: [ats], sentIndex: atsIdx })[0].handled, false);

  const corp = sig({ id: 'c1', threadId: 'cth', num: '5', company: 'AcmeCorp', signal: 'unknown',
    from: 'Jane <jane@acmecorp.com>', date: 'Wed, 10 Jun 2026 09:00:00 +0000' });
  // Sent to a colleague of the sender (coordinator handoff) — same corporate
  // domain is real evidence the user engaged this company.
  const corpIdx = buildSentIndex([{ id: 's', threadId: 'z', to: 'scheduling.team@acmecorp.com', date: 'Wed, 10 Jun 2026 12:00:00 +0000' }]);
  const g = groupSignals({ signals: [corp], sentIndex: corpIdx })[0];
  assert.equal(g.handled, true);
  assert.equal(g.handledBy, 'sent-domain');
});

test('a logged follow-up touch on/after the latest inbound day handles; an older one does not', () => {
  const mail = sig({ id: 't1', threadId: 'tth', num: '37', company: 'Lightspeed', signal: 'unknown',
    from: 'Rec <rec@lightspeed.com>', date: 'Wed, 10 Jun 2026 09:00:00 +0000' });
  const g1 = groupSignals({ signals: [mail], touchesByNum: new Map([['37', '2026-06-11']]) })[0];
  assert.equal(g1.handledBy, 'touch');
  assert.equal(g1.repliedAt, '2026-06-11');
  const g2 = groupSignals({ signals: [mail], touchesByNum: new Map([['37', '2026-06-09']]) })[0];
  assert.equal(g2.handled, false);
});

// ── review triggers ─────────────────────────────────────────────────────────

test('non-confident interview flag is reviewable; dismissed or auto-applied ones are not', () => {
  const flag = sig({ id: 'i1', num: '9', company: 'Acme', signal: 'interview',
    from: 'r@acme.com', date: 'Wed, 10 Jun 2026 09:00:00 +0000' }); // no autoApplied = not confident
  assert.equal(groupsForReview(groupSignals({ signals: [flag] }))[0].reviewReason, 'unconfident-interview');
  // Confident invite: auto-sort already wrote the tracker → nothing to review.
  const auto = { ...flag, id: 'i2', autoApplied: 'Interview', dismissed: true };
  assert.equal(groupsForReview(groupSignals({ signals: [auto] })).length, 0);
  // Quietly-filed reminder (dismissed, no write) → nothing to review either.
  const filed = { ...flag, id: 'i3', dismissed: true };
  assert.equal(groupsForReview(groupSignals({ signals: [filed] })).length, 0);
});

// ── multi-role companies ────────────────────────────────────────────────────

test('different roles at one company that matched different nums split into separate groups', () => {
  const groups = groupSignals({ signals: [
    sig({ id: 'p1', num: '10', company: 'PointClickCare', role: 'Project Coordinator, Contractor - 6 Months',
      signal: 'rejected', from: 'no-reply@hire.lever.co', date: 'Tue, 9 Jun 2026 10:00:00 +0000' }),
    sig({ id: 'p2', num: '45', company: 'PointClickCare', role: 'Sr. Project Manager (6 month contract)',
      signal: 'rejected', from: 'no-reply@hire.lever.co', date: 'Wed, 10 Jun 2026 10:00:00 +0000' }),
  ] });
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(g => g.key), ['t45', 't10']); // newest-first
  assert.deepEqual(groups.map(g => g.roles.length), [1, 1]);
});

test('same group with no role distinction lists all role names seen', () => {
  const groups = groupSignals({ signals: [
    sig({ id: 'q1', num: '120', company: 'Kong', role: 'Senior Program Manager, Engineering Operations',
      signal: 'interview', from: 'a@konghq.com', date: 'Tue, 9 Jun 2026 10:00:00 +0000' }),
    sig({ id: 'q2', num: '120', company: 'Kong', role: 'Sr Program Manager - Engineering Operations',
      signal: 'unknown', from: 'a@konghq.com', date: 'Wed, 10 Jun 2026 10:00:00 +0000' }),
  ] });
  assert.equal(groups.length, 1);
  // Punctuation-drift variants of the SAME title dedupe by normalized form.
  assert.deepEqual(groups[0].roles, ['Sr Program Manager - Engineering Operations']);
});

// ── inbox surface ───────────────────────────────────────────────────────────

test('groupsForInbox: live groups + auto-filed and auto-applied tallies', () => {
  const groups = groupSignals({ signals: [
    sig({ id: 'l1', num: '1', company: 'Live Co', signal: 'unknown', from: 'h@liveco.com', date: 'Wed, 10 Jun 2026 09:00:00 +0000' }),
    sig({ id: 'l2', num: '2', company: 'Ack Co', signal: 'received', dismissed: true, from: 'no-reply@ackco.com', date: 'Tue, 9 Jun 2026 09:00:00 +0000' }),
    sig({ id: 'l3', num: '3', company: 'Auto Co', signal: 'rejected', dismissed: true, autoApplied: 'Rejected', from: 'no-reply@autoco.com', date: 'Mon, 8 Jun 2026 09:00:00 +0000' }),
  ] });
  const { live, autoFiledCount, autoAppliedCount } = groupsForInbox(groups);
  assert.deepEqual(live.map(g => g.key), ['t1']);
  assert.equal(autoFiledCount, 1);   // dismissed without a tracker write
  assert.equal(autoAppliedCount, 1); // auto-sort wrote the tracker
});

test('groups are sorted newest-first and carry latest tracker status seen', () => {
  const groups = groupSignals({ signals: [
    sig({ id: 'o1', num: '1', company: 'Old', signal: 'received', currentStatus: 'applied', from: 'a@old.com', date: 'Mon, 1 Jun 2026 09:00:00 +0000' }),
    sig({ id: 'n1', num: '2', company: 'New', signal: 'interview', currentStatus: 'interview', from: 'a@new.com', date: 'Wed, 10 Jun 2026 09:00:00 +0000' }),
  ] });
  assert.deepEqual(groups.map(g => g.company), ['New', 'Old']);
  assert.equal(groups[0].status, 'interview');
  assert.equal(groups[0].latestDate, new Date('Wed, 10 Jun 2026 09:00:00 +0000').toISOString());
});
