import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { makeFileStore } from '../engine/store/file-store.mjs';

function tmpFile() {
  const dir = mkdtempSync(join(tmpdir(), 'hl-store-'));
  return { path: join(dir, 'store.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('file-store persists across instances (durability)', () => {
  const { path, cleanup } = tmpFile();
  try {
    // instance 1: write data
    let s = makeFileStore({ file: path });
    const t = s.createTenant({ name: 'Acme' });
    const r = s.saveRole(t.id, { company: 'Anthropic', title: 'AI Eng', score: 4.6 });
    const rep = s.saveReport(t.id, { roleId: r.id, markdown: '# report', score: 4.6 });
    s.setSubscription(t.id, { plan: 'pro', status: 'active' });
    s.incrementUsage(t.id, 'evaluationsPerMonth', 3);

    // instance 2: reopen the same file → everything is there
    s = makeFileStore({ file: path });
    assert.equal(s.tenantPlan(t.id), 'pro');
    assert.equal(s.getUsage(t.id, 'evaluationsPerMonth'), 3);
    const roles = s.listRoles(t.id).items;
    assert.equal(roles.length, 1);
    assert.equal(roles[0].company, 'Anthropic');
    assert.equal(roles[0].id, r.id);
    assert.equal(s.getReport(t.id, rep.id).markdown, '# report'); // report survived
  } finally { cleanup(); }
});

test('file-store keeps dedupe + tenant isolation after reload', () => {
  const { path, cleanup } = tmpFile();
  try {
    let s = makeFileStore({ file: path });
    const a = s.createTenant({ name: 'A' });
    const b = s.createTenant({ name: 'B' });
    const ra = s.saveRole(a.id, { company: 'X', title: 'Y' });
    s.saveRole(a.id, { company: 'X', title: 'Y', status: 'Applied' }); // dedupe upsert

    s = makeFileStore({ file: path }); // reload
    assert.equal(s.listRoles(a.id).items.length, 1);        // dedupe survived
    assert.equal(s.listRoles(a.id).items[0].status, 'Applied');
    assert.equal(s.getRole(b.id, ra.id), null);             // isolation survived
  } finally { cleanup(); }
});

test('counter continues after reload (no id collisions)', () => {
  const { path, cleanup } = tmpFile();
  try {
    let s = makeFileStore({ file: path });
    const t = s.createTenant({ name: 'A' });
    const r1 = s.saveRole(t.id, { company: 'C1', title: 'T' });

    s = makeFileStore({ file: path });
    const r2 = s.saveRole(t.id, { company: 'C2', title: 'T' });
    assert.notEqual(r1.id, r2.id); // ids don't collide across reloads
  } finally { cleanup(); }
});
