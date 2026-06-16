// Citizenship / work-status classification for radio & button groups.
// Guards the autopilot's truthful work-authorization answers (the Samsara lesson:
// never claim a status he doesn't hold) and the Ashby "current status in Canada"
// radio that used to be left blank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResolver } from '../engine/apply/autoapply-core.mjs';

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
