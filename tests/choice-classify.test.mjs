// Citizenship / work-status classification for radio & button groups.
// Guards the autopilot's truthful work-authorization answers (the Samsara lesson:
// never claim a status he doesn't hold) and the Ashby "current status in Canada"
// radio that used to be left blank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResolver, checkboxSelfId } from '../engine/apply/autoapply-core.mjs';

const dir = mkdtempSync(join(tmpdir(), 'hl-choice-'));
writeFileSync(join(dir, 'profile.yml'), `candidate:
  full_name: "Ramy Sherif"
  email: "x@y.com"
  location: "Ajax, ON, Canada"
work_authorization:
  legally_authorized_to_work: "Yes"
  authorized_us: "No"
  require_sponsorship: "No"
  work_permit_type: "Canadian Citizen"
application_answers:
  citizenship: "Canadian citizen"
  nationality: "Canadian"
eeo_voluntary:
  gender: "Male"
`);
const R = createResolver({ projectDir: dir, profileFile: join(dir, 'profile.yml') });

test('"current status in Canada" radio → Canadian Citizen', () => {
  const c = R.classifyField({ label: 'What is your current status in Canada? (Please note: this position is remote within Canada only)', type: 'radio', options: [] });
  assert.equal(c.desired, 'Canadian Citizen');
});

test('US work-authorization question is never claimed (→ No)', () => {
  const c = R.classifyField({ label: 'Are you legally authorized to work in the United States?', type: 'radio' });
  assert.equal(c.desired, 'No');
});

test('Canada work-authorization → Yes', () => {
  const c = R.classifyField({ label: 'Are you authorized to work in Canada?', type: 'radio' });
  assert.equal(c.desired, 'Yes');
});

test('plain Citizenship / Nationality field → Canadian Citizen', () => {
  assert.equal(R.classifyField({ label: 'Citizenship', type: 'text' }).desired, 'Canadian Citizen');
  assert.equal(R.classifyField({ label: 'Nationality', type: 'text' }).desired, 'Canadian Citizen');
});

test('"current employment status" is NOT mistaken for citizenship', () => {
  const c = R.classifyField({ label: 'What is your current employment status?', type: 'radio' });
  assert.ok(!c || c.desired !== 'Canadian Citizen');
});

test('citizenship desired matches the offered "Canadian Citizen" option via bestOption', () => {
  const c = R.classifyField({ label: 'What is your current status in Canada?', type: 'radio' });
  const opt = R.bestOption(c.desired, ['Canadian Citizen', 'Permanent Resident', 'Open Work Permit', 'Closed Work Permit', 'Would need sponsorship']);
  assert.equal(opt, 'Canadian Citizen');
});

// ── Demographic checkbox self-ID (the Samsara-safe path) ──────────────────────
const SELF = {
  race_ethnicity: 'Middle Eastern',
  parent: 'Yes',
  neurodiverse: 'No',
  immigrant_or_refugee: 'No',
  disability_status: 'No, I do not have a disability',
};
const RACE_Q = 'What ethnicity(ies) do you identify with? Please select all that apply.';
const COMM_Q = 'Which of the following communities do you belong to? Please select all that apply.';

test('race checkbox: ticks Middle East Asian, nothing else', () => {
  assert.equal(checkboxSelfId(SELF, RACE_Q, 'Middle East Asian'), true);
  for (const o of ['Black', 'White', 'East Asian', 'South Asian', 'Hispanic or Latino', 'Indigenous', 'Other', 'Prefer not to say']) {
    assert.equal(checkboxSelfId(SELF, RACE_Q, o), false, `should NOT tick ${o}`);
  }
});

test('communities checkbox: ticks ONLY Parent (his true self-ID)', () => {
  assert.equal(checkboxSelfId(SELF, COMM_Q, 'Parent'), true);
  for (const o of ['Person with disability', 'Neurodiverse', 'Refugee or immigrant', 'None of the above', 'Other', 'Prefer not to say']) {
    assert.equal(checkboxSelfId(SELF, COMM_Q, o), false, `should NOT tick ${o}`);
  }
});

test('checkboxSelfId never ticks a non-self-ID group', () => {
  assert.equal(checkboxSelfId(SELF, 'Which tools have you used?', 'Power BI'), false);
});

test('checkboxSelfId respects an affirmed flag flipping to Yes', () => {
  assert.equal(checkboxSelfId({ ...SELF, neurodiverse: 'Yes' }, COMM_Q, 'Neurodiverse'), true);
});
