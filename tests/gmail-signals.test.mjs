import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSignal, matchApplication } from '../apps/web/lib/gmail-signals.mjs';

// ── detectSignal ────────────────────────────────────────────────────────────

test('rejection: "has now been filled" under an ack-style subject (the PointClickCare miss, 2026-06-11)', () => {
  // Real Lever rejection that was auto-filed as a confirmation: the subject
  // reads like an ack and the template says "has NOW been filled", which the
  // exact substring 'position has been filled' doesn't match.
  const signal = detectSignal(
    'Thank you for your interest, RAMY!',
    'Dear RAMY, Thank you for your interest in PointClickCare and the position of Sr. Project Manager (6 month contract). Unfortunately the position you have applied to has now been filled. We appreciate',
    '',
    'PointClickCare <no-reply@hire.lever.co>'
  );
  assert.equal(signal.type, 'rejected');
});

test('rejection: template variants of position-filled', () => {
  for (const variant of [
    'the position has since been filled',
    'this position has now been filled',
    'the role you applied for: the position had already been filled by an internal candidate',
  ]) {
    assert.equal(detectSignal('Update on your application', variant, '', 'jobs@x.com').type, 'rejected', variant);
  }
});

test('NOT a rejection: "position has not been filled" / "not yet been filled"', () => {
  for (const variant of [
    'the position has not been filled yet — we are still reviewing applications and will be in touch',
    'the position has not yet been filled, thanks for your patience while we review',
  ]) {
    const signal = detectSignal('Update on your application', variant, '', 'jobs@x.com');
    assert.notEqual(signal.type, 'rejected', variant);
  }
});

test('strong rejection beats an ack subject', () => {
  const signal = detectSignal(
    'Thank you for applying to Acme',
    'After careful review we have decided to move forward with other candidates.',
    '', 'Acme <no-reply@acme.com>');
  assert.equal(signal.type, 'rejected');
});

test('auto-ack with "unfortunately" disclaimer stays a confirmation', () => {
  // Step 4 (weak rejection words) must NOT outrank an ack subject — generic
  // acks say "unfortunately we can't reply to everyone".
  const signal = detectSignal(
    'We received your application',
    'Thanks! Unfortunately we cannot reply to every applicant individually.',
    '', 'Acme <no-reply@acme.com>');
  assert.equal(signal.type, 'received');
});

test('job-alert newsletter is never a signal (the Capgemini #76 false flip)', () => {
  const signal = detectSignal(
    'New jobs posted from Capgemini Group',
    'Schedule: full-time. New opportunities matching your interview preferences.',
    '', 'Indeed <alert@indeed.com>');
  assert.equal(signal.type, 'other');
});

test('interview invite wins over ack-ish wording, strict language is confident', () => {
  const signal = detectSignal(
    'Next steps for your application',
    'We would like to schedule an interview with you next week.',
    '', 'recruiting@acme.com');
  assert.equal(signal.type, 'interview');
  assert.equal(signal.confident, true);
});

test('loose next-step language inside an ack subject flags but is not confident', () => {
  const signal = detectSignal(
    'Thank you for applying to Acme',
    'Our team will review and reach out about next steps in the interview process.',
    '', 'no-reply@acme.com');
  assert.equal(signal.type, 'interview');
  assert.equal(signal.confident, false);
});

// ── matchApplication ────────────────────────────────────────────────────────

const APPS = [
  { num: '10', company: 'PointClickCare', role: 'Project Coordinator, Contractor - 6 Months', status: 'applied' },
  { num: '11', company: 'PointClickCare', role: 'Associate Product Manager - Data Projects', status: 'applied' },
  { num: '45', company: 'PointClickCare', role: 'Sr. Project Manager (6 month contract)', status: 'applied' },
  { num: '76', company: 'Capgemini', role: 'Program Delivery Lead', status: 'applied' },
];

test('same-company emails match the row whose role title the email names', () => {
  // The PCC rejection was filed against #10 (first company match in file
  // order) when the email plainly named #45's role.
  const matched = matchApplication(APPS, {
    from: 'PointClickCare <no-reply@hire.lever.co>',
    subject: 'Thank you for your interest, RAMY!',
    text: 'Thank you for your interest in PointClickCare and the position of Sr. Project Manager (6 month contract). Unfortunately the position you have applied to has now been filled.',
  });
  assert.equal(matched.num, '45');
});

test('title match survives punctuation drift', () => {
  const matched = matchApplication(APPS, {
    from: 'no-reply@hire.lever.co',
    subject: 'PointClickCare — your application',
    text: 'regarding the Sr Project Manager 6 month contract opening',
  });
  assert.equal(matched.num, '45');
});

test('single company match needs no title', () => {
  const matched = matchApplication(APPS, {
    from: 'Capgemini Recruiting <careers@capgemini.com>',
    subject: 'Interview availability',
    text: '',
  });
  assert.equal(matched.num, '76');
});

test('no title named: prefers a row still in play over a closed one', () => {
  const apps = [
    { num: '1', company: 'Acme', role: 'PM', status: 'rejected' },
    { num: '2', company: 'Acme', role: 'TPM', status: 'applied' },
  ];
  const matched = matchApplication(apps, { from: 'jobs@acme.com', subject: 'Acme update', text: 'an update on your application' });
  assert.equal(matched.num, '2');
});

test('no company match returns null', () => {
  assert.equal(matchApplication(APPS, { from: 'x@y.com', subject: 'hello', text: '' }), null);
});
