/**
 * tests/onboard.test.mjs — Unit tests for the onboarding wizard helpers.
 *
 * Run: npm test
 * Or:  node --test tests/onboard.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import {
  yamlQuote,
  validateOnboardPayload,
  serializeProfileYaml,
  extractProfileFromResume,
  kebabCase,
  parseProfileSummary,
} from '../dashboard-web/lib/onboard.mjs';
import { makeSafeResolver } from '../dashboard-web/lib/path-safety.mjs';

// ── yamlQuote ────────────────────────────────────────────────────────────────

describe('yamlQuote', () => {
  test('wraps a plain string in double quotes', () => {
    assert.equal(yamlQuote('hello'), '"hello"');
  });
  test('escapes embedded double quotes', () => {
    assert.equal(yamlQuote('she said "hi"'), '"she said \\"hi\\""');
  });
  test('escapes backslashes', () => {
    assert.equal(yamlQuote('C:\\path'), '"C:\\\\path"');
  });
  test('escapes newlines, carriage returns, tabs', () => {
    assert.equal(yamlQuote('a\nb\rc\td'), '"a\\nb\\rc\\td"');
  });
  test('handles null and undefined as empty string', () => {
    assert.equal(yamlQuote(null), '""');
    assert.equal(yamlQuote(undefined), '""');
  });
  test('coerces numbers to strings', () => {
    assert.equal(yamlQuote(42), '"42"');
  });
  test('preserves unicode and accented characters', () => {
    assert.equal(yamlQuote('Montréal · São Paulo'), '"Montréal · São Paulo"');
  });
});

// ── validateOnboardPayload ──────────────────────────────────────────────────

describe('validateOnboardPayload', () => {
  const valid = () => ({
    basics: { full_name: 'Jane Smith', email: 'jane@example.com', phone: '', location: '', linkedin: '', headline: '' },
    target_roles: ['Engineering Manager'],
    compensation: {},
    deal_breakers: [],
    narrative: { superpowers: [], proof_points: [] },
  });

  test('accepts a minimal valid payload', () => {
    assert.deepEqual(validateOnboardPayload(valid()), []);
  });
  test('rejects null/undefined payload', () => {
    assert.deepEqual(validateOnboardPayload(null), ['payload required']);
    assert.deepEqual(validateOnboardPayload(undefined), ['payload required']);
  });
  test('rejects payload with no basics', () => {
    assert.deepEqual(validateOnboardPayload({}), ['basics required']);
  });
  test('rejects empty full_name', () => {
    const p = valid(); p.basics.full_name = '';
    assert.ok(validateOnboardPayload(p).includes('full_name invalid'));
  });
  test('rejects single-character name (length < 2)', () => {
    const p = valid(); p.basics.full_name = 'X';
    assert.ok(validateOnboardPayload(p).includes('full_name invalid'));
  });
  test('rejects 101-char name (length > 100)', () => {
    const p = valid(); p.basics.full_name = 'X'.repeat(101);
    assert.ok(validateOnboardPayload(p).includes('full_name invalid'));
  });
  test('rejects malformed email', () => {
    const p = valid(); p.basics.email = 'notanemail';
    assert.ok(validateOnboardPayload(p).includes('email invalid'));
  });
  test('rejects empty target_roles', () => {
    const p = valid(); p.target_roles = [];
    assert.ok(validateOnboardPayload(p).includes('pick at least one target role'));
  });
  test('rejects non-array target_roles', () => {
    const p = valid(); p.target_roles = 'Engineer';
    assert.ok(validateOnboardPayload(p).includes('pick at least one target role'));
  });
  test('rejects > 50 target_roles', () => {
    const p = valid(); p.target_roles = Array.from({ length: 51 }, (_, i) => `Role ${i}`);
    assert.ok(validateOnboardPayload(p).includes('too many target_roles'));
  });
  test('rejects role entry with invalid type', () => {
    const p = valid(); p.target_roles = [123];
    assert.ok(validateOnboardPayload(p).includes('invalid role entry'));
  });
  test('rejects non-array deal_breakers', () => {
    const p = valid(); p.deal_breakers = 'no relocation';
    assert.ok(validateOnboardPayload(p).includes('deal_breakers must be array'));
  });
  test('rejects too-long phone field', () => {
    const p = valid(); p.basics.phone = 'X'.repeat(301);
    assert.ok(validateOnboardPayload(p).includes('phone too long'));
  });
  test('rejects too-many superpowers', () => {
    const p = valid(); p.narrative.superpowers = Array.from({ length: 11 }, (_, i) => `s${i}`);
    assert.ok(validateOnboardPayload(p).includes('too many superpowers'));
  });
  test('rejects > 4000-char best_achievement', () => {
    const p = valid(); p.narrative.best_achievement = 'X'.repeat(4001);
    assert.ok(validateOnboardPayload(p).includes('best_achievement too long'));
  });
  test('rejects > 20 proof_points', () => {
    const p = valid(); p.narrative.proof_points = Array.from({ length: 21 }, () => ({ name: 'x' }));
    assert.ok(validateOnboardPayload(p).includes('too many proof_points'));
  });
});

// ── serializeProfileYaml ────────────────────────────────────────────────────

describe('serializeProfileYaml', () => {
  test('produces a header comment + candidate block', () => {
    const yml = serializeProfileYaml({
      basics: { full_name: 'Jane', email: 'j@x.com' },
      target_roles: ['Engineer'],
    });
    assert.match(yml, /^# Career-Ops Profile Configuration/);
    assert.match(yml, /candidate:\s*\n\s+full_name: "Jane"/);
    assert.match(yml, /target_roles:\s*\n\s+primary:\s*\n\s+- "Engineer"/);
  });
  test('strips http(s):// from linkedin', () => {
    const yml = serializeProfileYaml({
      basics: { full_name: 'X', email: 'x@y.com', linkedin: 'https://linkedin.com/in/foo' },
      target_roles: ['Y'],
    });
    assert.match(yml, /linkedin: "linkedin\.com\/in\/foo"/);
  });
  test('splits "City, ST" into city + country', () => {
    const yml = serializeProfileYaml({
      basics: { full_name: 'X', email: 'x@y.com', location: 'Toronto, ON' },
      target_roles: ['Y'],
    });
    assert.match(yml, /city: "Toronto"/);
    assert.match(yml, /country: "ON"/);
  });
  test('emits empty arrays for missing optional sections', () => {
    const yml = serializeProfileYaml({
      basics: { full_name: 'X', email: 'x@y.com' },
      target_roles: ['Y'],
    });
    assert.match(yml, /superpowers: \[\]/);
    assert.match(yml, /proof_points: \[\]/);
  });
  test('emits superpowers list when present', () => {
    const yml = serializeProfileYaml({
      basics: { full_name: 'X', email: 'x@y.com' },
      target_roles: ['Y'],
      narrative: { superpowers: ['fast', 'sharp'] },
    });
    assert.match(yml, /superpowers:\s*\n\s+- "fast"\s*\n\s+- "sharp"/);
  });
  test('emits deal_breakers section when non-empty', () => {
    const yml = serializeProfileYaml({
      basics: { full_name: 'X', email: 'x@y.com' },
      target_roles: ['Y'],
      deal_breakers: ['No relocation'],
    });
    assert.match(yml, /deal_breakers:\s*\n\s+- "No relocation"/);
  });
  test('omits deal_breakers section when empty', () => {
    const yml = serializeProfileYaml({
      basics: { full_name: 'X', email: 'x@y.com' },
      target_roles: ['Y'],
      deal_breakers: [],
    });
    assert.doesNotMatch(yml, /deal_breakers:/);
  });
  test('escapes quotes inside values', () => {
    const yml = serializeProfileYaml({
      basics: { full_name: 'Jane "JJ" Smith', email: 'j@x.com' },
      target_roles: ['Y'],
    });
    assert.match(yml, /full_name: "Jane \\"JJ\\" Smith"/);
  });
  test('survives null/undefined nested fields', () => {
    const yml = serializeProfileYaml({
      basics: { full_name: 'X', email: 'x@y.com' },
      target_roles: ['Y'],
      narrative: null,
      compensation: null,
      deal_breakers: null,
    });
    assert.match(yml, /candidate:/);
    assert.match(yml, /currency: "USD"/);  // default
  });
});

// ── extractProfileFromResume ────────────────────────────────────────────────

describe('extractProfileFromResume', () => {
  test('extracts a basic resume', () => {
    const text = `Jane Smith
San Francisco, CA · jane@example.com · (415) 555-0123 · linkedin.com/in/janesmith

Senior AI Engineer with 8 years of experience.`;
    const p = extractProfileFromResume(text);
    assert.equal(p.full_name, 'Jane Smith');
    assert.equal(p.email, 'jane@example.com');
    assert.equal(p.phone, '(415) 555-0123');
    assert.equal(p.linkedin, 'linkedin.com/in/janesmith');
    assert.equal(p.location, 'San Francisco, CA');
  });
  test('rejects sentence-length headlines (the old bug)', () => {
    const text = `Jane Smith
jane@example.com

Senior Engineering Manager with 12 years of experience building distributed systems.`;
    const p = extractProfileFromResume(text);
    // The sentence ends in "." → must NOT be picked as headline.
    assert.equal(p.headline, '');
  });
  test('accepts a clean role-descriptor headline', () => {
    const text = `Tony Walteur
tony@x.com

Strategic Operator · AI Ecosystem Architect · Partnership Leader
8+ years experience...`;
    const p = extractProfileFromResume(text);
    assert.equal(p.headline, 'Strategic Operator · AI Ecosystem Architect · Partnership Leader');
  });
  test('returns empty profile for empty input', () => {
    const p = extractProfileFromResume('');
    assert.equal(p.full_name, '');
    assert.equal(p.email, '');
  });
  test('returns empty profile for non-string input', () => {
    assert.deepEqual(extractProfileFromResume(null).full_name, '');
    assert.deepEqual(extractProfileFromResume(123).full_name, '');
  });
  test('handles markdown headers', () => {
    const text = `# Jane Smith\n\njane@x.com\n\n## Experience`;
    const p = extractProfileFromResume(text);
    assert.equal(p.full_name, 'Jane Smith');
  });
  test('skips contact-line numbers when extracting location', () => {
    const text = `Jane\nNew York, NY | jane@x.com | (555) 123-4567`;
    const p = extractProfileFromResume(text);
    assert.equal(p.location, 'New York, NY');
  });
  test('only accepts names with at least one space', () => {
    // Single word like "Jane" should NOT be extracted as a name (would catch
    // section headers like "Experience", "Education", etc.).
    const text = `Experience\n\njane@x.com`;
    const p = extractProfileFromResume(text);
    assert.equal(p.full_name, '');
  });
});

// ── kebabCase ───────────────────────────────────────────────────────────────

describe('kebabCase', () => {
  test('lowercases and hyphenates', () => {
    assert.equal(kebabCase('Tony Walteur'), 'tony-walteur');
  });
  test('strips punctuation', () => {
    assert.equal(kebabCase("Jane O'Neill, Jr."), 'jane-oneill-jr');
  });
  test('handles unicode by stripping accents', () => {
    assert.equal(kebabCase('María José'), 'maria-jose');
  });
  test('handles empty / null input', () => {
    assert.equal(kebabCase(''), '');
    assert.equal(kebabCase(null), '');
    assert.equal(kebabCase(undefined), '');
  });
  test('collapses multiple spaces', () => {
    assert.equal(kebabCase('A   B    C'), 'a-b-c');
  });
});

// ── parseProfileSummary ─────────────────────────────────────────────────────

describe('parseProfileSummary', () => {
  test('returns exists:false on empty input', () => {
    assert.deepEqual(parseProfileSummary(''), {
      exists: false, full_name: '', email: '', target_roles: [], substantive: false,
    });
    assert.deepEqual(parseProfileSummary(null).exists, false);
    assert.deepEqual(parseProfileSummary(undefined).exists, false);
  });

  test('extracts candidate fields', () => {
    const yml = `candidate:
  full_name: "Tony Walteur"
  email: "tony@x.com"
target_roles:
  primary: []
`;
    const s = parseProfileSummary(yml);
    assert.equal(s.full_name, 'Tony Walteur');
    assert.equal(s.email, 'tony@x.com');
  });

  test('extracts all target_roles.primary entries', () => {
    const yml = `candidate:
  full_name: "X"
  email: "x@y.com"
target_roles:
  primary:
    - "Role A"
    - "Role B"
    - "Role C"
  archetypes: []
`;
    const s = parseProfileSummary(yml);
    assert.deepEqual(s.target_roles, ['Role A', 'Role B', 'Role C']);
  });

  test('does not include archetype names in target_roles', () => {
    const yml = `target_roles:
  primary:
    - "Real Role"
  archetypes:
    - name: "Decoy A"
    - name: "Decoy B"
`;
    const s = parseProfileSummary(yml);
    assert.deepEqual(s.target_roles, ['Real Role']);
  });

  test('marks substantive=true when name + at least one role present', () => {
    const yml = `candidate:
  full_name: "Tony"
  email: "t@x.com"
target_roles:
  primary:
    - "Role"
`;
    assert.equal(parseProfileSummary(yml).substantive, true);
  });

  test('marks substantive=false when name missing', () => {
    const yml = `candidate:
  email: "t@x.com"
target_roles:
  primary:
    - "Role"
`;
    assert.equal(parseProfileSummary(yml).substantive, false);
  });

  test('marks substantive=false when target_roles empty', () => {
    const yml = `candidate:
  full_name: "Tony"
target_roles:
  primary: []
`;
    assert.equal(parseProfileSummary(yml).substantive, false);
  });

  test('handles profile with no target_roles section at all', () => {
    const yml = `candidate:
  full_name: "Tony"
  email: "t@x.com"
narrative:
  headline: "Test"
`;
    const s = parseProfileSummary(yml);
    assert.equal(s.full_name, 'Tony');
    assert.deepEqual(s.target_roles, []);
    assert.equal(s.substantive, false);
  });

  test('handles malformed YAML without crashing', () => {
    const s = parseProfileSummary('this is not yaml at all\n   :::\n');
    assert.equal(s.exists, true); // string was non-empty
    assert.equal(s.full_name, '');
    assert.deepEqual(s.target_roles, []);
  });
});

// ── makeSafeResolver (path-traversal defense) ──────────────────────────────

describe('makeSafeResolver', () => {
  let baseDir;
  let resolve;

  test('setup: create temp base dir', () => {
    baseDir = mkdtempSync(path.join(os.tmpdir(), 'safety-'));
    mkdirSync(path.join(baseDir, 'sub'), { recursive: true });
    writeFileSync(path.join(baseDir, 'real.md'), 'ok');
    resolve = makeSafeResolver(baseDir);
  });

  test('accepts a clean .md basename', () => {
    const p = resolve('real.md');
    assert.ok(p);
    assert.equal(path.basename(p), 'real.md');
  });
  test('accepts reports/ prefixed paths (strips them)', () => {
    const p = resolve('reports/real.md');
    assert.equal(path.basename(p), 'real.md');
  });
  test('rejects ../ traversal attempts', () => {
    assert.equal(resolve('../etc/passwd'), null);
    assert.equal(resolve('../../config/profile.yml'), null);
    assert.equal(resolve('reports/../../etc/passwd'), null);
  });
  test('rejects absolute paths to other locations', () => {
    assert.equal(resolve('/etc/passwd'), null);
    assert.equal(resolve('C:\\Windows\\system32'), null);
  });
  test('rejects unsafe characters', () => {
    assert.equal(resolve('foo bar.md'), null);
    assert.equal(resolve('foo;rm.md'), null);
    assert.equal(resolve('foo<script>.md'), null);
  });
  test('rejects non-md extensions', () => {
    assert.equal(resolve('config.yml'), null);
    assert.equal(resolve('script.sh'), null);
    assert.equal(resolve('binary'), null);
  });
  test('rejects empty / null / non-string input', () => {
    assert.equal(resolve(''), null);
    assert.equal(resolve(null), null);
    assert.equal(resolve(undefined), null);
    assert.equal(resolve(123), null);
  });
  test('rejects . and ..', () => {
    assert.equal(resolve('.'), null);
    assert.equal(resolve('..'), null);
  });
  test('rejects URL fragments and query strings (after stripping)', () => {
    // The resolver strips #/? — the cleaned basename must still be valid
    const p = resolve('real.md#section');
    assert.ok(p, 'basename "real.md" is valid even with a fragment');
  });
  test('teardown: clean temp dir', () => {
    rmSync(baseDir, { recursive: true, force: true });
  });
});
