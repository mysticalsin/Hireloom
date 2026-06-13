/**
 * tests/profile-diagnostics.test.mjs — the profile-gap analysis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProfile, GAP_CATALOG } from '../apps/web/lib/profile-diagnostics.mjs';

const FULL = {
  candidate: { email: 'a@b.com', phone: '416', location: 'Toronto' },
  narrative: { headline: 'PM', best_achievement: 'won' },
  compensation: { target_range: '$100k' },
  work_authorization: { legally_authorized_to_work: 'Yes', require_sponsorship: 'No' },
  application_answers: {
    notice_period: '2w', earliest_start_date: 'now', willing_to_relocate: 'Yes', over_18: 'Yes',
    criminal_record: 'No', background_check_consent: 'Yes', citizenship: 'CA', drivers_license: 'Yes',
  },
  eeo_voluntary: {},
  custom_answers: [{ question: 'q', answer: 'a' }],
  additional_context: 'notes',
};

test('a complete profile reports 100% and no required gaps', () => {
  const r = analyzeProfile(FULL);
  assert.equal(r.completeness.pct, 100);
  assert.equal(r.gaps.length, 0);
  assert.equal(r.customAnswerCount, 1);
  assert.equal(r.hasFreeText, true);
});

test('an empty profile flags every required answer', () => {
  const r = analyzeProfile({});
  const required = GAP_CATALOG.filter(e => e.sev !== 'optional').length;
  assert.equal(r.gaps.length, required);
  assert.equal(r.completeness.filled, 0);
  assert.equal(r.completeness.pct, 0);
});

test('optional self-ID gaps are separated from required gaps', () => {
  const r = analyzeProfile({});
  assert.ok(r.optional.length >= 4); // gender/race/veteran/disability
  assert.ok(r.optional.every(o => o.severity === 'optional'));
  assert.ok(r.gaps.every(g => g.severity !== 'optional'));
});

test('a specific missing answer is detected with a fix path', () => {
  const partial = { ...FULL, work_authorization: {} };
  const r = analyzeProfile(partial);
  const we = r.gaps.find(g => g.id === 'work_eligibility');
  assert.ok(we, 'work eligibility gap detected');
  assert.match(we.fix, /Work authorization/);
  assert.ok(we.why.length > 0);
});

test('gaps are sorted high-severity first', () => {
  const r = analyzeProfile({});
  const rank = { high: 0, medium: 1, low: 2 };
  for (let i = 1; i < r.gaps.length; i++) {
    assert.ok(rank[r.gaps[i - 1].severity] <= rank[r.gaps[i].severity], 'sorted by severity');
  }
});

test('empty strings and blank arrays count as gaps', () => {
  const r = analyzeProfile({ candidate: { email: '   ' }, application_answers: { notice_period: '' } });
  assert.ok(r.gaps.find(g => g.id === 'email'));
  assert.ok(r.gaps.find(g => g.id === 'notice_period'));
});
