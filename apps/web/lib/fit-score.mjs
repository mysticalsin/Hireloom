// fit-score.mjs — deterministic auto-fit scoring for roles that never got an
// evaluation report. Mirrors the pool-ranking heuristic the user already ran
// over the whole 350-role queue (engine/batch/rank-pool.mjs: tier → seniority
// fit → archetype direction → ATS autofill ease), projected onto the tracker's
// 0–5 score scale so every row can show SOMETHING honest.
//
// Display convention: auto-fit scores carry a trailing '*' ("4.2/5*") so they
// are never mistaken for a real evaluation-report score. parseFloat still
// reads them for sorting.
//
// Pure module — no I/O, fully unit-tested (tests/fit-score.test.mjs).

// Title seniority — same buckets as rank-pool.mjs seniority().
export function titleSeniority(title) {
  const x = String(title || '').toLowerCase();
  if (/\b(junior|jr|associate|coordinator|specialist|analyst|intern|entry|administrator|assistant)\b/.test(x)) return 0;
  if (/\b(director|head|vp|vice president|chief)\b/.test(x)) return 3;
  if (/\b(senior|sr|lead|principal|staff|ii|iii)\b/.test(x)) return 2;
  return 1;
}

// On-direction archetypes (the PM/delivery lane — empirically the only lane
// producing human screens in the 2026-06-11 pattern pass).
const ON_DIRECTION_ARCHETYPES = new Set(['PROG_PM', 'IMPL_DEL', 'BIZ_ANALYST']);
// Native ATSes the autopilot fills well (rank-pool rewards these too).
const EASY_ATS = new Set(['greenhouse', 'lever', 'ashby', 'smartrecruiters']);

// Title-only base when no pool tier exists (hand-created roles): PM/delivery
// titles are the lane; analyst/CSM/product/ops titles under-perform.
function titleBase(title) {
  const x = String(title || '').toLowerCase();
  const pmish = /\b(project|program|delivery|implementation|engagement)\b/.test(x) &&
    /\b(manager|lead|director|head)\b/.test(x);
  if (pmish) return 4.2;
  if (/\b(analyst|coordinator|specialist)\b/.test(x)) return 3.4;
  if (/\b(customer success|product manager|account manager)\b/.test(x)) return 3.2;
  if (/\bmanager\b/.test(x)) return 3.8;
  return 3.5;
}

// autoFitScore({ title, tier, archetype, ats }) → { score, display, factors }
//   tier: 0 = PM/PC (on-direction), 1 = strict, 2 = adjacent (pool tiers);
//         null/undefined = not a pool role, fall back to title heuristics.
export function autoFitScore({ title = '', tier = null, archetype = null, ats = null } = {}) {
  const factors = [];
  let score;
  if (tier === 0 || tier === 1 || tier === 2) {
    score = [4.4, 4.0, 3.2][tier];
    factors.push('tier ' + ['PM/PC (on-direction)', 'strict', 'adjacent'][tier]);
    const sen = titleSeniority(title);
    if (tier === 2 && sen >= 2) { score -= 0.4; factors.push('senior title off-direction'); }
    if (sen === 3) { score -= 0.8; factors.push('director+ level'); }
    if (tier === 2 && archetype && ON_DIRECTION_ARCHETYPES.has(archetype)) {
      score += 0.2; factors.push('PM-lane archetype');
    }
  } else {
    score = titleBase(title);
    factors.push(score >= 4.2 ? 'PM/delivery-titled (the lane)' : score <= 3.4 ? 'off-lane title' : 'title heuristic');
    if (titleSeniority(title) === 3) { score -= 0.8; factors.push('director+ level'); }
  }
  if (ats && EASY_ATS.has(String(ats).toLowerCase())) { score += 0.1; factors.push('native-ATS autofill'); }
  score = Math.min(4.8, Math.max(2.5, Math.round(score * 10) / 10));
  return { score, display: score.toFixed(1) + '/5*', factors };
}

// One-line human rationale for role pages that have no evaluation report.
export function explainFit({ title, tier, archetype, ats, rank, total } = {}) {
  const { display, factors } = autoFitScore({ title, tier, archetype, ats });
  const bits = [];
  if (rank != null) bits.push('Pool rank #' + rank + (total ? ' of ' + total : ''));
  if (archetype) bits.push('archetype ' + archetype);
  bits.push(factors.join(', '));
  return 'Auto-fit ' + display + ' — ' + bits.join(' · ') +
    '. Scored by the deterministic pool heuristic (tier → seniority fit → ATS), not an evaluation report.';
}
