import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeInMemoryStore } from '../engine/store/store.mjs';
import { checkQuota, requireQuota } from '../engine/billing/plans.mjs';
import { evaluateUrl } from '../engine/pipeline/evaluate-url.mjs';

test('usage counters increment per metric and isolate by month', () => {
  let month = '2026-06';
  const s = makeInMemoryStore({ now: () => `${month}-01T00:00:00.000Z` });
  const t = s.createTenant({ name: 'Acme' });
  assert.equal(s.getUsage(t.id, 'evaluationsPerMonth'), 0);
  assert.equal(s.incrementUsage(t.id, 'evaluationsPerMonth'), 1);
  s.incrementUsage(t.id, 'evaluationsPerMonth', 2);
  assert.equal(s.getUsage(t.id, 'evaluationsPerMonth'), 3);
  // new month → counter resets (different period key)
  month = '2026-07';
  assert.equal(s.getUsage(t.id, 'evaluationsPerMonth'), 0);
});

test('checkQuota: Free caps at the limit, Pro is unlimited', () => {
  const s = makeInMemoryStore();
  const t = s.createTenant({ name: 'Acme' });
  for (let i = 0; i < 9; i++) s.incrementUsage(t.id, 'evaluationsPerMonth');
  assert.equal(checkQuota(s, t.id, 'evaluationsPerMonth').ok, true);   // 9 < 10
  s.incrementUsage(t.id, 'evaluationsPerMonth');                        // now 10
  assert.equal(checkQuota(s, t.id, 'evaluationsPerMonth').ok, false);  // 10 not < 10
  assert.throws(() => requireQuota(s, t.id, 'evaluationsPerMonth'), /limit reached/);
  // upgrade to Pro → unlimited
  s.setSubscription(t.id, { plan: 'pro', status: 'active' });
  assert.equal(checkQuota(s, t.id, 'evaluationsPerMonth').ok, true);
});

// --- evaluateUrl quota enforcement ---
const EVAL_TEXT = `ok\n\n---SCORE_SUMMARY---
COMPANY: Anthropic
ROLE: AI Eng
SCORE: 4.5
ARCHETYPE: AI
LEGITIMACY: High Confidence
---END_SUMMARY---`;
function anthropicFetch() {
  const fn = async () => { fn.called = (fn.called || 0) + 1; return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: EVAL_TEXT }], usage: {}, model: 'claude-sonnet-4-0', stop_reason: 'end_turn' }), text: async () => '' }; };
  return fn;
}

test('evaluateUrl blocks a Free tenant over quota BEFORE calling the model', async () => {
  const s = makeInMemoryStore();
  const t = s.createTenant({ name: 'Acme' });
  for (let i = 0; i < 10; i++) s.incrementUsage(t.id, 'evaluationsPerMonth'); // at cap
  const ff = anthropicFetch();
  await assert.rejects(
    () => evaluateUrl({ input: 'JD text', shared: 'S', oferta: 'O', cv: 'C', provider: 'anthropic', model: 'claude-sonnet-4-0', apiKey: 'k', store: s, tenantId: t.id, fetchImpl: ff }),
    /quota|limit reached/,
  );
  assert.equal(ff.called, undefined); // model never called — guarded before spend
});

test('evaluateUrl counts usage on success; Pro is unlimited', async () => {
  const s = makeInMemoryStore();
  const t = s.createTenant({ name: 'Acme' });
  s.setSubscription(t.id, { plan: 'pro', status: 'active' });
  const ff = anthropicFetch();
  const r = await evaluateUrl({ input: 'JD text', shared: 'S', oferta: 'O', cv: 'C', provider: 'anthropic', model: 'claude-sonnet-4-0', apiKey: 'k', store: s, tenantId: t.id, fetchImpl: ff });
  assert.ok(r.persisted);
  assert.equal(s.getUsage(t.id, 'evaluationsPerMonth'), 1); // counted
});
