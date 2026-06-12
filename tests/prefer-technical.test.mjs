// preferTechnical() — apply flows must auto-select the "(Technical)" CV/cover
// variant when one was built for the role (user rule, 2026-06-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preferTechnical } from '../engine/apply/autoapply-core.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pref-tech-'));
const base = join(dir, 'Ramy Sherif - Resume.pdf');
const tech = join(dir, 'Ramy Sherif - Resume (Technical).pdf');
const coverOnly = join(dir, 'Ramy Sherif - Cover Letter.pdf');
writeFileSync(base, 'x');
writeFileSync(tech, 'x');
writeFileSync(coverOnly, 'x');
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

test('upgrades to the (Technical) sibling when it exists', () => {
  assert.equal(preferTechnical(base), tech);
});

test('returns the input unchanged when no (Technical) sibling exists', () => {
  assert.equal(preferTechnical(coverOnly), coverOnly);
});

test('returns an already-(Technical) path unchanged', () => {
  assert.equal(preferTechnical(tech), tech);
});

test('passes through empty/null values', () => {
  assert.equal(preferTechnical(''), '');
  assert.equal(preferTechnical(null), null);
});

test('only rewrites .pdf paths', () => {
  const md = join(dir, 'notes.md');
  assert.equal(preferTechnical(md), md);
});
