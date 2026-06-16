import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveAts, tallyRoles } from '../engine/scan/verify-ats.mjs';

test('deriveAts: greenhouse board URL', () => {
  assert.deepEqual(deriveAts('https://job-boards.greenhouse.io/lyft'), { provider: 'greenhouse', slug: 'lyft' });
});

test('deriveAts: greenhouse via explicit api field', () => {
  assert.deepEqual(
    deriveAts('https://x.com', 'https://boards-api.greenhouse.io/v1/boards/later/jobs'),
    { provider: 'greenhouse', slug: 'later' });
});

test('deriveAts: ashby / lever / smartrecruiters / recruitee', () => {
  assert.deepEqual(deriveAts('https://jobs.ashbyhq.com/xona-space'), { provider: 'ashby', slug: 'xona-space' });
  assert.deepEqual(deriveAts('https://jobs.lever.co/telesat'), { provider: 'lever', slug: 'telesat' });
  assert.deepEqual(deriveAts('https://jobs.smartrecruiters.com/TransatAT1'), { provider: 'smartrecruiters', slug: 'TransatAT1' });
  assert.deepEqual(deriveAts('https://gong.recruitee.com'), { provider: 'recruitee', slug: 'gong' });
});

test('deriveAts: workday encodes tenant|shard|site', () => {
  assert.deepEqual(deriveAts('https://cae.wd3.myworkdayjobs.com/career'), { provider: 'workday', slug: 'cae|wd3|career' });
  // tolerate a locale prefix and a non-3 shard
  assert.deepEqual(deriveAts('https://toyota.wd503.myworkdayjobs.com/en-US/Toyota_CA'), { provider: 'workday', slug: 'toyota|wd503|Toyota_CA' });
});

test('deriveAts: unknown/custom ATS → null', () => {
  assert.equal(deriveAts('https://careers.aircanada.com/ca/en'), null);
  assert.equal(deriveAts(''), null);
});

test('tallyRoles: counts target titles only', () => {
  const r = tallyRoles([
    { title: 'Senior Project Manager', loc: 'Toronto, Canada' },
    { title: 'Software Engineer', loc: 'Toronto, Canada' },   // not a target title
    { title: 'Business Analyst', loc: 'Ottawa' },
  ]);
  assert.equal(r.total, 3);
  assert.equal(r.target, 2);
  assert.equal(r.caTarget, 2);
});

test('tallyRoles: Canada filter — US-only excluded, blank location kept', () => {
  const r = tallyRoles([
    { title: 'Program Manager', loc: 'New York, US Only' },   // NONCA → excluded
    { title: 'Program Manager', loc: 'Netherlands, Remote' }, // bare remote, no CA → excluded
    { title: 'Program Manager', loc: '' },                    // unknown loc → kept (caOk)
    { title: 'Program Manager', loc: 'Remote - Canada' },     // CA → kept
  ]);
  assert.equal(r.target, 4);
  assert.equal(r.caTarget, 2);
});

test('tallyRoles: samples cap at 4', () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ title: `Project Manager ${i}`, loc: 'Toronto' }));
  const r = tallyRoles(rows);
  assert.equal(r.caTarget, 9);
  assert.equal(r.samples.length, 4);
});
