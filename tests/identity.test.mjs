/**
 * Unit tests for lib/identity.mjs — the single source of candidate identity
 * for every CV/cover renderer. Covers: candidate-block defaults, cv: display
 * overrides, linkedin URL cleaning, education/certs HTML escaping,
 * experience_order hints, and the missing-profile error path.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { loadIdentity } from '../lib/identity.mjs';

let n = 0;
function profileWith(yml) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hireloom-id-'));
  const p = path.join(dir, `profile-${n++}.yml`);
  writeFileSync(p, yml);
  return { p, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const BASE = `
candidate:
  full_name: "Jane Example"
  email: "jane@example.com"
  phone: "555-0100"
  location: "Toronto, ON"
  linkedin: "https://www.linkedin.com/in/jane-example/"
`;

describe('lib/identity.mjs — loadIdentity', () => {
  test('contact line defaults from the candidate block, linkedin cleaned', () => {
    const { p, cleanup } = profileWith(BASE);
    try {
      const id = loadIdentity(p);
      assert.equal(id.name, 'Jane Example');
      assert.equal(id.linkedin, 'linkedin.com/in/jane-example');
      assert.equal(id.contactText, 'jane@example.com | 555-0100 | Toronto, ON | linkedin.com/in/jane-example');
      assert.match(id.contactHtml, /jane@example\.com <span class="sep">\|<\/span> 555-0100/);
    } finally { cleanup(); }
  });

  test('cv: display overrides win over candidate fields', () => {
    const { p, cleanup } = profileWith(BASE + `
cv:
  contact_location: "Ajax, ON (open to relocation)"
  contact_linkedin: "linkedin.com/in/jane"
`);
    try {
      const id = loadIdentity(p);
      assert.match(id.contactText, /Ajax, ON \(open to relocation\)/);
      assert.match(id.contactText, /linkedin\.com\/in\/jane$/);
      assert.ok(!id.contactText.includes('Toronto'));
    } finally { cleanup(); }
  });

  test('education/certs render to HTML with escaping; empty when absent', () => {
    const { p, cleanup } = profileWith(BASE + `
cv:
  education:
    - degree: "BSc, Physics & Math"
      org: "U <of> T"
      date: "2010 – 2014"
  certifications:
    - title: "PMP"
      org: "PMI"
`);
    try {
      const id = loadIdentity(p);
      assert.match(id.eduHtml, /Physics &amp; Math/);
      assert.match(id.eduHtml, /U &lt;of&gt; T/);
      assert.match(id.certsHtml, /<div class="cert-title">PMP<\/div>/);
      const bare = loadIdentity(profileWith(BASE).p);
      assert.equal(bare.eduHtml, '');
      assert.equal(bare.certsHtml, '');
    } finally { cleanup(); }
  });

  test('experienceOrder: hints sort, "+" means AND, unmatched sink to the end', () => {
    const { p, cleanup } = profileWith(BASE + `
cv:
  experience_order:
    - "acme"
    - "program manager+globex"
    - "initech"
`);
    try {
      const order = loadIdentity(p).experienceOrder;
      assert.equal(order('Senior PM — Acme Corp'), 0);
      assert.equal(order('Program Manager — Globex'), 1);
      assert.equal(order('Engineer — Globex'), 3);       // "program manager" part missing → unmatched
      assert.equal(order('Analyst — Initech'), 2);
      assert.equal(order('Something Else'), 3);
    } finally { cleanup(); }
  });

  test('no hints → every title ranks equal (stable sort keeps input order)', () => {
    const { p, cleanup } = profileWith(BASE);
    try {
      const order = loadIdentity(p).experienceOrder;
      assert.equal(order('Anything'), 0);
      assert.equal(order('Else'), 0);
    } finally { cleanup(); }
  });

  test('missing profile throws a pointed error; missing name too', () => {
    assert.throws(() => loadIdentity('/nonexistent/profile.yml'), /identity: cannot read/);
    const { p, cleanup } = profileWith('candidate:\n  email: "x@y.z"\n');
    try {
      assert.throws(() => loadIdentity(p), /full_name missing/);
    } finally { cleanup(); }
  });

  test('cache is per-path: two profiles do not bleed into each other', () => {
    const a = profileWith(BASE);
    const b = profileWith(BASE.replace('Jane Example', 'Bob Other'));
    try {
      assert.equal(loadIdentity(a.p).name, 'Jane Example');
      assert.equal(loadIdentity(b.p).name, 'Bob Other');
      assert.equal(loadIdentity(a.p).name, 'Jane Example'); // cached, not clobbered
    } finally { a.cleanup(); b.cleanup(); }
  });
});
