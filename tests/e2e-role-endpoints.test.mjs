import test from 'node:test';
import assert from 'node:assert/strict';
import { bootServer, fetchPort } from './_helpers/boot-server.mjs';

// Role-centric endpoint contract: /api/roles, /api/role, /api/role/create,
// /api/classify, /api/assign, /api/attach, /api/reveal. All against tmp
// CONFIG_DIR/DATA_DIR (the MISTAKES.md rule) — the real tracker is never touched.

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-06-01 | Acme Robotics | Senior Project Manager | 4.2/5 | Applied | ❌ | — | seeded row |',
  '| 2 | 2026-06-02 | Borealis Health | Program Manager | N/A | Applied | ❌ | — | seeded row |',
].join('\n');

const CACHE = {
  v: 2,
  scanned_at: new Date().toISOString(),
  sentIndex: [],
  signals: [
    {
      id: 'm1', threadId: 'th1', num: null, unmatched: true,
      company: 'Northwind Aero', role: 'Delivery Manager', extractedRole: 'Delivery Manager',
      currentStatus: null, signal: 'interview', codes: [],
      subject: 'Interview Invitation - Delivery Manager', snippet: 'We would like to schedule an interview',
      from: 'Recruiting <talent@northwind-aero.com>', date: new Date().toUTCString(),
      suggestedStatus: null, dismissed: false,
    },
  ],
};

const POST = (body, origin) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
  body: JSON.stringify(body),
});

test('role-centric endpoint contract', async (t) => {
  const srv = await bootServer({ REVEAL_DRY_RUN: '1' }, {
    seedData: { 'applications.md': TRACKER, 'gmail-cache.json': CACHE },
  });
  t.after(srv.cleanup);

  await t.test('/api/roles lists the seeded tracker rows', async () => {
    const r = await fetchPort(srv.port, '/api/roles');
    const json = JSON.parse(r.body.toString());
    assert.ok(json.roles.some(x => x.key === 't1' && x.company === 'Acme Robotics'));
    assert.ok(json.roles.some(x => x.key === 't2'));
  });

  await t.test('/api/role returns the all-in-one payload', async () => {
    const r = await fetchPort(srv.port, '/api/role?key=t1');
    const json = JSON.parse(r.body.toString());
    assert.equal(json.company, 'Acme Robotics');
    assert.equal(json.status, 'applied');
    assert.ok(Array.isArray(json.timeline));
    const bad = await fetchPort(srv.port, '/api/role?key=zzz');
    assert.equal(bad.statusCode, 400);
  });

  await t.test('classify rejection flips the row + writes status history', async () => {
    const r = await fetchPort(srv.port, '/api/classify',
      POST({ action: 'rejection', ids: ['nonexistent'], num: '2' }));
    const json = JSON.parse(r.body.toString());
    assert.equal(json.ok, true);
    const role = JSON.parse((await fetchPort(srv.port, '/api/role?key=t2')).body.toString());
    assert.equal(role.status, 'rejected');
    assert.ok(role.statusDate, 'status-history records when it became Rejected');
  });

  await t.test('create role mints a row with merge-grade dedup', async () => {
    const r = await fetchPort(srv.port, '/api/role/create',
      POST({ company: 'Northwind Aero', role: 'Delivery Manager', status: 'Interview', interviewAt: '2026-06-20T14:00', ids: ['m1'] }));
    const json = JSON.parse(r.body.toString());
    assert.equal(json.ok, true);
    assert.equal(json.num, '3');
    const role = JSON.parse((await fetchPort(srv.port, '/api/role?key=t3')).body.toString());
    assert.equal(role.status, 'interview');
    assert.equal(role.interviewAt, '2026-06-20T14:00');
    assert.equal(role.emails.length, 1, 'the unmatched email rode along via ids[]');
    // duplicate company+role reuses the row instead of minting #4
    const dup = await fetchPort(srv.port, '/api/role/create',
      POST({ company: 'Northwind Aero', role: 'Delivery Manager' }));
    assert.equal(JSON.parse(dup.body.toString()).num, '3');
  });

  await t.test('assign moves loose emails onto a tracker row', async () => {
    const r = await fetchPort(srv.port, '/api/assign', POST({ ids: ['m1'], key: 't1' }));
    const json = JSON.parse(r.body.toString());
    assert.equal(json.ok, true);
    assert.equal(json.num, '1');
    assert.equal(json.assigned, 1);
  });

  await t.test('attach merges one role into another and the page shows it', async () => {
    const r = await fetchPort(srv.port, '/api/attach', POST({ from: 't3', into: 't1' }));
    assert.equal(JSON.parse(r.body.toString()).ok, true);
    const role = JSON.parse((await fetchPort(srv.port, '/api/role?key=t3')).body.toString());
    assert.equal(role.key, 't1', 'absorbed key resolves to the target');
    assert.ok(role.absorbed.some(a => a.key === 't3'));
    const again = await fetchPort(srv.port, '/api/attach', POST({ from: 't3', into: 't1' }));
    assert.equal(JSON.parse(again.body.toString()).already, true, 'idempotent');
  });

  await t.test('reveal: dry-run honored, traversal slots rejected', async () => {
    const bad = await fetchPort(srv.port, '/api/reveal', POST({ key: 't1', slot: '../../etc/passwd' }));
    assert.equal(bad.statusCode, 404); // no such slot resolves
    const badKey = await fetchPort(srv.port, '/api/reveal', POST({ key: 'x;rm', slot: 'cv' }));
    assert.equal(badKey.statusCode, 400);
  });

  await t.test('mutating role endpoints reject cross-origin (CSRF)', async () => {
    const r = await fetchPort(srv.port, '/api/classify',
      POST({ action: 'rejection', ids: ['x'], num: '1' }, 'https://evil.example.com'));
    assert.equal(r.statusCode, 403);
  });
});
