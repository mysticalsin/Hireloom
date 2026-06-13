import test from 'node:test';
import assert from 'node:assert/strict';
import { autoFitScore, explainFit, titleSeniority } from '../apps/web/lib/fit-score.mjs';

// ── titleSeniority ──────────────────────────────────────────────────────────

test('titleSeniority buckets match the rank-pool heuristic', () => {
  assert.equal(titleSeniority('Project Coordinator'), 0);
  assert.equal(titleSeniority('Project Manager'), 1);
  assert.equal(titleSeniority('Senior Program Manager'), 2);
  assert.equal(titleSeniority('Director, PMO'), 3);
  assert.equal(titleSeniority('Senior Director of Delivery'), 3); // director outranks senior
  assert.equal(titleSeniority(null), 1);
});

// ── autoFitScore: pool-tier path ────────────────────────────────────────────

test('tier 0 (PM/PC, on-direction) scores highest', () => {
  const fit = autoFitScore({ title: 'Project Manager', tier: 0, ats: 'indeed' });
  assert.equal(fit.score, 4.4);
  assert.equal(fit.display, '4.4/5*');
});

test('native ATS adds the autofill bonus', () => {
  const fit = autoFitScore({ title: 'Project Manager', tier: 0, ats: 'greenhouse' });
  assert.equal(fit.score, 4.5);
});

test('adjacent tier with a senior off-direction title is penalized', () => {
  const base = autoFitScore({ title: 'Operations Manager', tier: 2 });
  const senior = autoFitScore({ title: 'Senior Operations Manager', tier: 2 });
  assert.ok(senior.score < base.score, 'senior off-direction must rank below mid-level');
});

test('PM-lane archetype lifts an adjacent-tier role', () => {
  const plain = autoFitScore({ title: 'Operations Manager', tier: 2, archetype: 'GEN_PM_OPS' });
  const lane = autoFitScore({ title: 'Operations Manager', tier: 2, archetype: 'PROG_PM' });
  assert.ok(lane.score > plain.score);
});

// ── autoFitScore: title-only path (hand-created roles) ──────────────────────

test('PM/delivery titles are the lane — they outscore analyst/CSM titles', () => {
  const pm = autoFitScore({ title: 'Program Delivery Manager' });
  const analyst = autoFitScore({ title: 'Business Analyst' });
  const csm = autoFitScore({ title: 'Customer Success Manager - Canada' });
  assert.ok(pm.score > analyst.score);
  assert.ok(pm.score > csm.score);
  assert.equal(pm.score, 4.2);
});

test('director-level hand-created roles are penalized (>10yr gates)', () => {
  const pm = autoFitScore({ title: 'Project Manager' });
  const dir = autoFitScore({ title: 'Director of Project Management' });
  assert.ok(dir.score < pm.score);
});

test('score is clamped to [2.5, 4.8] and display carries the * marker', () => {
  for (const input of [
    { title: 'Director Customer Success', tier: 2 },
    { title: 'Technical Delivery Project Manager', tier: 0, ats: 'greenhouse' },
  ]) {
    const { score, display } = autoFitScore(input);
    assert.ok(score >= 2.5 && score <= 4.8, display + ' out of bounds');
    assert.match(display, /^\d\.\d\/5\*$/);
  }
});

test('deterministic: same input, same score', () => {
  const a = autoFitScore({ title: 'Senior Project Manager', tier: 1, ats: 'lever' });
  const b = autoFitScore({ title: 'Senior Project Manager', tier: 1, ats: 'lever' });
  assert.deepEqual(a, b);
});

// ── explainFit ──────────────────────────────────────────────────────────────

test('explainFit names the rank, the factors, and the auto-fit score', () => {
  const text = explainFit({ title: 'Business Systems, Continuous Improvement Project Manager', tier: 0, archetype: 'PROG_PM', ats: 'indeed', rank: 47 });
  assert.match(text, /Pool rank #47/);
  assert.match(text, /Auto-fit \d\.\d\/5\*/);
  assert.match(text, /not an evaluation report/);
});

test('explainFit works without pool data (hand-created role)', () => {
  const text = explainFit({ title: 'Project Manager' });
  assert.match(text, /Auto-fit \d\.\d\/5\*/);
  assert.doesNotMatch(text, /Pool rank/);
});
