import test from 'node:test';
import assert from 'node:assert/strict';
import { computeUrgency, computeNextFollowupDate } from '../engine/tracker/followup-cadence.mjs';

// All calls pass autoApplied explicitly so the suite is independent of the
// local config/profile.yml followups.auto_applied setting.

// ── computeUrgency: inbound-response anchoring (the Hootsuite radar bug) ────

test('response received today on an old application is respond-pending, NOT overdue', () => {
  // 20 days since apply, no touches — but the company wrote back today.
  const u = computeUrgency('interview', 20, null, 0, { daysSinceInbound: 0, awaitingReply: true }, false);
  assert.equal(u, 'respond-pending');
});

test('unanswered response goes overdue only after the response window lapses', () => {
  const fresh = computeUrgency('responded', 30, null, 0, { daysSinceInbound: 6, awaitingReply: true }, false);
  assert.equal(fresh, 'respond-pending');
  const lapsed = computeUrgency('responded', 30, null, 0, { daysSinceInbound: 7, awaitingReply: true }, false);
  assert.equal(lapsed, 'overdue');
});

test('a reply (or logged touch) clears awaiting-reply: silence clock anchors to most recent event', () => {
  // Replied 2 days ago (inbound no longer awaiting) → waiting, not overdue,
  // even though the application is 20 days old.
  const u = computeUrgency('interview', 20, 2, 1, { daysSinceInbound: 3, awaitingReply: false }, false);
  assert.equal(u, 'waiting');
});

test('inbound response re-anchors even without a logged touch', () => {
  // No follow-ups.md touches, application 20d old, answered response 3d ago.
  const u = computeUrgency('interview', 20, null, 0, { daysSinceInbound: 3, awaitingReply: false }, false);
  assert.equal(u, 'waiting');
});

test('without any inbound response, the old silence rule stands', () => {
  assert.equal(computeUrgency('interview', 20, null, 0, null, false), 'overdue');
  assert.equal(computeUrgency('responded', 3, null, 0, null, false), 'waiting');
  assert.equal(computeUrgency('interview', 20, 8, 1, null, false), 'overdue');
  assert.equal(computeUrgency('interview', 20, 2, 1, null, false), 'waiting');
});

test('plain applied rows carry no obligation unless opted in', () => {
  assert.equal(computeUrgency('applied', 30, null, 0, null, false), 'waiting');
  assert.equal(computeUrgency('applied', 30, null, 0, null, true), 'overdue');
});

// ── computeNextFollowupDate: anchor = most recent event ─────────────────────

test('next follow-up anchors to the inbound response date when it is newest', () => {
  const next = computeNextFollowupDate('interview', '2026-05-23', null, 0, '2026-06-12', false);
  assert.equal(next, '2026-06-19'); // response date + 7, not apply date + 7
});

test('next follow-up anchors to the touch when it is newer than the response', () => {
  const next = computeNextFollowupDate('interview', '2026-05-23', '2026-06-14', 1, '2026-06-12', false);
  assert.equal(next, '2026-06-21');
});

test('no inbound, no touch: anchors to apply date (old behavior)', () => {
  const next = computeNextFollowupDate('responded', '2026-06-01', null, 0, null, false);
  assert.equal(next, '2026-06-08');
});
