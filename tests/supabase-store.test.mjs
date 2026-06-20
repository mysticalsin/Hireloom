import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSupabaseStore } from '../engine/store/supabase-store.mjs';
import { dedupeKey } from '../engine/store/store.mjs';

// Minimal chainable mock of the supabase-js query builder. Records each op and
// resolves it via the provided responder.
function mockClient(respond) {
  const ops = [];
  const from = (table) => {
    const op = { table, filters: [] };
    ops.push(op);
    const b = {
      select(cols) { op.action = op.action || 'select'; op.cols = cols; return b; },
      insert(row) { op.action = 'insert'; op.row = row; return b; },
      upsert(row, opts) { op.action = 'upsert'; op.row = row; op.opts = opts; return b; },
      update(patch) { op.action = 'update'; op.patch = patch; return b; },
      eq(c, v) { op.filters.push([c, v]); return b; },
      order() { return b; },
      limit() { return Promise.resolve(respond(op)); },
      maybeSingle() { op.single = 'maybe'; return Promise.resolve(respond(op)); },
      single() { op.single = 'one'; return Promise.resolve(respond(op)); },
    };
    return b;
  };
  return { from, ops };
}
const ok = (data) => ({ data, error: null });

test('saveRole upserts with the dedupe key, onConflict, and maps jd_text', async () => {
  const client = mockClient((op) =>
    op.action === 'upsert'
      ? ok({ id: 'r1', company: op.row.company, title: op.row.title, status: op.row.status, score: op.row.score, url: op.row.url, source: op.row.source, jd_text: op.row.jd_text, created_at: 't', updated_at: 't' })
      : ok(null));
  const store = makeSupabaseStore({ client });
  const role = await store.saveRole('user-1', { company: 'Anthropic', title: 'AI Eng', score: 4.6, jdText: 'JD here', source: 'greenhouse' });
  const op = client.ops[0];
  assert.equal(op.table, 'roles');
  assert.equal(op.opts.onConflict, 'user_id,dedupe_key');
  assert.equal(op.row.user_id, 'user-1');
  assert.equal(op.row.dedupe_key, dedupeKey('Anthropic', 'AI Eng'));
  assert.equal(op.row.jd_text, 'JD here');
  assert.equal(role.id, 'r1');
  assert.equal(role.jdText, 'JD here'); // db jd_text -> jdText
  assert.equal(role.score, 4.6);
});

test('tenantPlan reads the subscription, defaults to free', async () => {
  const withSub = makeSupabaseStore({ client: mockClient(() => ok({ user_id: 'u', plan: 'pro', status: 'active' })) });
  assert.equal(await withSub.tenantPlan('u'), 'pro');
  const noSub = makeSupabaseStore({ client: mockClient(() => ok(null)) });
  assert.equal(await noSub.tenantPlan('u'), 'free');
});

test('incrementUsage reads current then upserts current+n', async () => {
  let upserted = null;
  const client = mockClient((op) => {
    if (op.action === 'select') return ok({ count: 4 });       // current
    if (op.action === 'upsert') { upserted = op.row; return ok({ count: op.row.count }); }
    return ok(null);
  });
  const store = makeSupabaseStore({ client, now: () => '2026-06-20T00:00:00.000Z' });
  const next = await store.incrementUsage('user-1', 'evaluationsPerMonth', 3);
  assert.equal(next, 7);                       // 4 + 3
  assert.equal(upserted.period, '2026-06');
  assert.equal(upserted.metric, 'evaluationsPerMonth');
  assert.equal(upserted.user_id, 'user-1');
});

test('listRoles scopes by user and maps rows', async () => {
  const client = mockClient((op) => ok([{ id: 'r1', company: 'X', title: 'Y', status: 'Applied', score: 4, url: null, source: 't', jd_text: null, created_at: 'a', updated_at: 'b' }]));
  const store = makeSupabaseStore({ client });
  const { items } = await store.listRoles('user-1', { status: 'Applied' });
  assert.equal(items.length, 1);
  assert.equal(items[0].company, 'X');
  assert.deepEqual(client.ops[0].filters, [['user_id', 'user-1'], ['status', 'Applied']]);
});

test('errors from supabase bubble up', async () => {
  const store = makeSupabaseStore({ client: mockClient(() => ({ data: null, error: { message: 'boom' } })) });
  await assert.rejects(() => store.getRole('u', 'r1'), /boom/);
});
