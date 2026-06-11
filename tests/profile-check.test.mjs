/**
 * Unit tests for engine/lib/profile-check.mjs — the doctor's profile.yml content
 * validation. Covers: the renderer-required candidate.full_name, the cv:
 * block contract (education/certifications/experience_order/contact_*
 * shapes), warn-vs-fail levels, and the second-brain prerequisite list.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'js-yaml';
import { checkProfileDoc, SECOND_BRAIN_PREREQS } from '../engine/lib/profile-check.mjs';

const VALID = load(`
candidate:
  full_name: "Jane Example"
  email: "jane@example.com"
cv:
  contact_location: "Toronto, ON (open to relocation)"
  education:
    - degree: "BSc, Physics"
      org: "University of Toronto"
      date: "2014 – 2018"
  certifications:
    - title: "PMP"
      org: "PMI"
  experience_order:
    - "acme"
    - "manager+globex"
`);

const fails = (findings) => findings.filter((f) => f.level === 'fail');
const warns = (findings) => findings.filter((f) => f.level === 'warn');

describe('checkProfileDoc', () => {
  test('fully valid document yields no findings', () => {
    assert.deepEqual(checkProfileDoc(VALID), []);
  });

  test('null / non-mapping document fails', () => {
    for (const doc of [null, undefined, 'just a string', 42, []]) {
      const findings = checkProfileDoc(doc);
      assert.equal(fails(findings).length, 1, `expected fail for ${JSON.stringify(doc)}`);
    }
  });

  test('missing candidate.full_name fails', () => {
    const doc = structuredClone(VALID);
    delete doc.candidate.full_name;
    assert.match(fails(checkProfileDoc(doc))[0].label, /full_name/);
    assert.match(fails(checkProfileDoc({ cv: doc.cv }))[0].label, /full_name/);
  });

  test('missing cv: block warns (renderers fall back), does not fail', () => {
    const findings = checkProfileDoc({ candidate: { full_name: 'Jane' } });
    assert.equal(fails(findings).length, 0);
    assert.equal(warns(findings).length, 1);
    assert.match(warns(findings)[0].label, /cv: block missing/);
  });

  test('cv: as a non-mapping fails', () => {
    const findings = checkProfileDoc({ candidate: { full_name: 'Jane' }, cv: ['oops'] });
    assert.match(fails(findings)[0].label, /must be a YAML mapping/);
  });

  test('empty education warns, malformed education fails', () => {
    const doc = structuredClone(VALID);
    doc.cv.education = [];
    assert.equal(warns(checkProfileDoc(doc)).length, 1);

    doc.cv.education = 'BSc Physics';
    assert.match(fails(checkProfileDoc(doc))[0].label, /education must be a list/);

    doc.cv.education = [{ org: 'no degree key' }];
    assert.match(fails(checkProfileDoc(doc))[0].label, /education\[0\] malformed/);
  });

  test('certifications absent is fine; malformed entries fail', () => {
    const doc = structuredClone(VALID);
    delete doc.cv.certifications;
    assert.deepEqual(checkProfileDoc(doc), []);

    doc.cv.certifications = [{ org: 'no title key' }];
    assert.match(fails(checkProfileDoc(doc))[0].label, /certifications\[0\] malformed/);

    doc.cv.certifications = 'PMP';
    assert.match(fails(checkProfileDoc(doc))[0].label, /certifications must be a list/);
  });

  test('experience_order must be non-empty strings when present', () => {
    const doc = structuredClone(VALID);
    delete doc.cv.experience_order;
    assert.deepEqual(checkProfileDoc(doc), []);

    for (const bad of [[''], [42], 'acme', [{ hint: 'acme' }]]) {
      doc.cv.experience_order = bad;
      assert.equal(fails(checkProfileDoc(doc)).length, 1, `expected fail for ${JSON.stringify(bad)}`);
    }
  });

  test('contact_* overrides must be non-empty strings when present', () => {
    const doc = structuredClone(VALID);
    doc.cv.contact_email = '';
    doc.cv.contact_phone = 5550100;
    const findings = fails(checkProfileDoc(doc));
    assert.equal(findings.length, 2);
    assert.match(findings[0].label, /contact_email/);
    assert.match(findings[1].label, /contact_phone/);
  });

  test('every finding carries a fix hint', () => {
    const doc = { candidate: {}, cv: { education: 'bad', certifications: 'bad', experience_order: [1] } };
    for (const f of checkProfileDoc(doc)) {
      assert.ok(f.fix && f.fix.length > 10, `finding "${f.label}" has no fix hint`);
    }
  });
});

describe('SECOND_BRAIN_PREREQS', () => {
  test('lists the build spec, the command, and the analyzers the spec shells out to', () => {
    assert.ok(SECOND_BRAIN_PREREQS.includes('second-brain/BUILD-SPEC.md'));
    assert.ok(SECOND_BRAIN_PREREQS.includes('engine/tracker/followup-cadence.mjs'));
    assert.ok(SECOND_BRAIN_PREREQS.includes('engine/tracker/analyze-patterns.mjs'));
    assert.ok(SECOND_BRAIN_PREREQS.includes('templates/states.yml'));
  });
});
