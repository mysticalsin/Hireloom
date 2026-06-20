import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeInMemoryStore, dedupeKey } from '../engine/store/store.mjs';

test('dedupeKey normalizes company + title', () => {
  assert.equal(dedupeKey('Anthropic', 'Applied AI Engineer'), 'anthropic|applied ai engineer');
  assert.equal(dedupeKey('  ACME, Inc. ', 'Staff   Eng.'), 'acme inc|staff eng');
  assert.equal(dedupeKey('Anthropic', 'Applied AI Engineer'), dedupeKey('ANTHROPIC ', 'applied-ai  engineer'));
});

test('tenants and users: creation + per-tenant unique email', () => {
  const s = makeInMemoryStore();
  const t = s.createTenant({ name: 'Acme' });
  assert.match(t.id, /^t_/);
  const u = s.createUser({ tenantId: t.id, email: 'a@b.com' });
  assert.equal(u.tenantId, t.id);
  assert.throws(() => s.createUser({ tenantId: t.id, email: 'a@b.com' }), /already exists/);
  assert.throws(() => s.createUser({ tenantId: 'nope', email: 'x@y.com' }), /unknown tenant/);
});

test('saveRole dedupes per tenant (upsert, stable id)', () => {
  const s = makeInMemoryStore();
  const t = s.createTenant({ name: 'Acme' });
  const r1 = s.saveRole(t.id, { company: 'Anthropic', title: 'Applied AI Engineer', status: 'Evaluated', score: 4.6 });
  const r2 = s.saveRole(t.id, { company: 'ANTHROPIC', title: 'applied-ai  engineer', status: 'Applied' });
  assert.equal(r1.id, r2.id);                 // same role, upserted
  assert.equal(r2.status, 'Applied');         // field updated
  assert.equal(r2.score, 4.6);                // prior value preserved when not provided
  assert.equal(s.listRoles(t.id).items.length, 1);
});

test('TENANT ISOLATION: cross-tenant reads return null/empty', () => {
  const s = makeInMemoryStore();
  const a = s.createTenant({ name: 'A' });
  const b = s.createTenant({ name: 'B' });
  const ra = s.saveRole(a.id, { company: 'Anthropic', title: 'AI Eng' });
  const repA = s.saveReport(a.id, { roleId: ra.id, markdown: '# secret A', score: 4.6 });
  // tenant B cannot read tenant A's role or report by id
  assert.equal(s.getRole(b.id, ra.id), null);
  assert.equal(s.getReport(b.id, repA.id), null);
  assert.equal(s.updateRoleStatus(b.id, ra.id, 'Applied'), null);
  // and B's listing never includes A's rows
  assert.deepEqual(s.listRoles(b.id).items, []);
  // owner still sees them
  assert.equal(s.getRole(a.id, ra.id).company, 'Anthropic');
  assert.equal(s.getReport(a.id, repA.id).markdown, '# secret A');
});

test('listRoles filters by status and paginates by cursor', () => {
  const s = makeInMemoryStore();
  const t = s.createTenant({ name: 'Acme' });
  for (let i = 0; i < 5; i++) s.saveRole(t.id, { company: `Co${i}`, title: 'Eng', status: i % 2 ? 'Applied' : 'Evaluated' });
  assert.equal(s.listRoles(t.id, { status: 'Applied' }).items.length, 2);
  const p1 = s.listRoles(t.id, { limit: 2 });
  assert.equal(p1.items.length, 2);
  assert.ok(p1.nextCursor);
  const p2 = s.listRoles(t.id, { limit: 2, cursor: p1.nextCursor });
  assert.equal(p2.items.length, 2);
  assert.notEqual(p1.items[0].id, p2.items[0].id); // no overlap
});

test('provider keys: upsert per (tenant, provider), isolated, ciphertext only', () => {
  const s = makeInMemoryStore();
  const a = s.createTenant({ name: 'A' });
  const b = s.createTenant({ name: 'B' });
  s.upsertProviderKey(a.id, { provider: 'anthropic', ciphertext: 'enc-1' });
  s.upsertProviderKey(a.id, { provider: 'anthropic', ciphertext: 'enc-2' }); // upsert
  assert.equal(s.getProviderKey(a.id, 'anthropic').ciphertext, 'enc-2');
  assert.equal(s.getProviderKey(b.id, 'anthropic'), null);                   // isolation
  assert.throws(() => s.upsertProviderKey(a.id, { provider: 'kimi' }), /required/);
});

test('saveReport rejects a roleId from another tenant', () => {
  const s = makeInMemoryStore();
  const a = s.createTenant({ name: 'A' });
  const b = s.createTenant({ name: 'B' });
  const ra = s.saveRole(a.id, { company: 'X', title: 'Y' });
  assert.throws(() => s.saveReport(b.id, { roleId: ra.id, markdown: 'x' }), /not in tenant/);
});
