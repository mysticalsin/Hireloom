import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSignal, matchApplication, extractVerificationCodes } from '../apps/web/lib/gmail-signals.mjs';

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

test('rejection: "successful in filling our role" (the Hootsuite miss, 2026-06-12)', () => {
  // Real Hootsuite rejection auto-flipped a row to Interview: no known
  // rejection phrasing matched, while "our interview process" in the body hit
  // the loose interview list and the subject didn't read as an ack.
  const signal = detectSignal(
    'Your Hootsuite Application - Customer Success Manager | Responsable du Succès Client',
    'Hi Ramy, Thank you for taking the time to apply for the Customer Success Manager position at Hootsuite.',
    'There has been a lot of interest in this position, and we have been successful in filling our role. Unfortunately, we were unable to review your application when you applied as we had other candidates further along in our interview process.',
    'no-reply.hiring@hootsuite.com');
  assert.equal(signal.type, 'rejected');
});

test('rejection: filling-phrasing variants', () => {
  for (const variant of [
    'we were successful in filling this position',
    'we have successfully filled the role with another candidate',
    'we are in the process of filling our position internally',
  ]) {
    assert.equal(detectSignal('Application update', variant, '', 'jobs@x.com').type, 'rejected', variant);
  }
});

test('loose interview language WITHOUT an ack subject is unknown, never confident (Hootsuite guard)', () => {
  // Old behavior: loose + non-ack subject → confident interview → silent
  // tracker write. New behavior: that combination is a response whose meaning
  // the classifier can't pin down — the user reads the email and decides.
  const signal = detectSignal(
    'Your Acme Application - Customer Success Manager',
    'Thanks for your patience while our team works through the interview process.',
    '', 'no-reply.hiring@acme.com');
  assert.equal(signal.type, 'unknown');
});

test('human sender with unclassifiable body is unknown, automated sender stays other', () => {
  const human = detectSignal(
    'Quick question about your background',
    'Hi Ramy, I came across your profile while reviewing — do you have experience managing vendor transitions?',
    '', '"Kelly, Devyn" <devyn.kelly@compass-canada.com>');
  assert.equal(human.type, 'unknown');
  const robot = detectSignal(
    'Quick question about your background',
    'Hi Ramy, I came across your profile while reviewing — do you have experience managing vendor transitions?',
    '', 'no-reply@compass-canada.com');
  assert.equal(robot.type, 'other');
});

test('strict scheduling language from a human stays confident interview (the Compass invite)', () => {
  const signal = detectSignal(
    'Initial Discussion | Project Manager, Program Management | Compass Group Canada',
    'Thank you for expressing interest in the Project Manager, Program Management role.',
    'After reviewing your profile, we would love to connect. You can book some time in my calendar using this link: https://calendly.com/devyn-kelly-compass-canada/30min',
    'Devyn.Kelly@compass-canada.com');
  assert.equal(signal.type, 'interview');
  assert.equal(signal.confident, true);
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

// ── extractRoleFromEmail ────────────────────────────────────────────────────
// Fixtures are REAL subjects from data/gmail-cache.json (import is hoisted —
// appended here so the pre-existing lines above stay untouched).
import { extractRoleFromEmail, deriveCompanyFromText } from '../apps/web/lib/gmail-signals.mjs';

test('R5: "Your COMPANY Application - ROLE | bilingual dup" (Hootsuite)', () => {
  const r = extractRoleFromEmail(
    'Your Hootsuite Application - Customer Success Manager | Responsable du Succès Client', '');
  assert.equal(r.company, 'Hootsuite');
  assert.equal(r.role, 'Customer Success Manager');
  assert.equal(r.partial, false);
});

test('R1: 3-segment pipe "Event | ROLE | Company" (the Compass invite)', () => {
  const r = extractRoleFromEmail(
    'Initial Discussion | Project Manager, Program Management | Compass Group Canada', '');
  assert.equal(r.role, 'Project Manager, Program Management');
  assert.equal(r.company, 'Compass Group Canada');
  // The Re: reply on the same thread extracts identically.
  const re = extractRoleFromEmail(
    'Re: Initial Discussion | Project Manager, Program Management | Compass Group Canada', '');
  assert.equal(re.role, 'Project Manager, Program Management');
});

test('R2: "Interview Invitation - ROLE - City, PROV" keeps internal commas, drops the location', () => {
  const r = extractRoleFromEmail(
    'Interview Invitation - Business Systems, Continuous Improvement Project Manager - Acheson, AB', '');
  assert.equal(r.role, 'Business Systems, Continuous Improvement Project Manager');
});

test('R3: req-id paren dropped, real paren in the title kept, zero-width chars tolerated (OCS)', () => {
  // Exact cache subject: zero-width spaces wrap the id, trailing space and all.
  const r = extractRoleFromEmail(
    'Your application for Manager Service Delivery - OCS (Supply Chain) (​25350​) ', '');
  assert.equal(r.role, 'Manager Service Delivery - OCS (Supply Chain)');
});

test('R4: "[our] ROLE role at COMPANY" (Stripe) and bare "ROLE at COMPANY" (Quandri)', () => {
  const stripe = extractRoleFromEmail(
    'Your application for our Technical Program Manager, Extensibility Programs role at Stripe', '');
  assert.equal(stripe.role, 'Technical Program Manager, Extensibility Programs');
  assert.equal(stripe.company, 'Stripe');
  const quandri = extractRoleFromEmail(
    'Your Application for Customer Success Manager at Quandri', '');
  assert.equal(quandri.role, 'Customer Success Manager');
  assert.equal(quandri.company, 'Quandri');
});

test('R6: "thank you for applying" needs the position/role tail; bare Tenstorrent stays null', () => {
  const pos = extractRoleFromEmail(
    'Thank you for applying for the Senior Project Manager position', '');
  assert.equal(pos.role, 'Senior Project Manager');
  // Company-only ack: no role tail in the subject, no "position of" in the snippet.
  const neg = extractRoleFromEmail('Thank you for applying to Tenstorrent',
    'Hi Ramy, Thank you for your interest in Tenstorrent. Our team will review your application.');
  assert.equal(neg.role, null);
});

test('R6 snippet companion: "the position of ROLE (req-id)" in the body', () => {
  // Real OCS ack snippet; the subject names nothing useful.
  const r = extractRoleFromEmail('Thank you for your interest, RAMY!',
    'Dear Sherif, Ramy, We want to thank you for your interest in the position of Manager Service Delivery - OCS (Supply Chain) (25350), and for taking the time to a');
  assert.equal(r.role, 'Manager Service Delivery - OCS (Supply Chain)');
});

test('R7: calendar "Interview with COMPANY - ROLE" with truncation + time tail (the Kong invite)', () => {
  const r = extractRoleFromEmail(
    'Invitation from an unknown sender: Interview with Kong - Senior Program Manager, Engineering... @ Tue 9 Jun 2026 12:30pm', '');
  assert.equal(r.company, 'Kong');
  assert.equal(r.role, 'Senior Program Manager, Engineering');
  assert.equal(r.partial, true);
});

test('Canceled: prefix is stripped AND surfaced as a flag (the Acheson cancellation)', () => {
  const r = extractRoleFromEmail(
    'Canceled: Interview Invitation - Business Systems, Continuous Improvement Project Manager - Acheson, AB', '');
  assert.equal(r.canceled, true);
  assert.equal(r.role, 'Business Systems, Continuous Improvement Project Manager');
});

test('no template matched: null role, no canceled flag', () => {
  const r = extractRoleFromEmail('Reminder: Your Upcoming Interview with Kong', '');
  assert.equal(r.role, null);
  assert.equal(r.canceled, undefined);
});

test('rejection: "direction that better fits our needs" beats the Stripe ack subject (the 2026-06-04 miss)', () => {
  const signal = detectSignal(
    'Your application for our Technical Program Manager, Extensibility Programs role at Stripe',
    'Thank you for taking the time to apply.',
    'After careful consideration, we have decided to go in a direction that better fits our needs at this time.',
    'Stripe <no-reply@stripe.com>');
  assert.equal(signal.type, 'rejected');
});

// ── Workday relay acks (the Generac collapse, 2026-06-17) ────────────────────
// generac@myworkday.com sent three application acks whose subjects only differ
// by role. R8 extracts the role from "Your application for ROLE is on its way";
// deriveCompanyFromText pulls the employer out of the body ("...interest in
// Generac"), since the relay sender is never the company.

test('R8: "Your application for ROLE is on its way" (the Workday submit-confirm)', () => {
  for (const [subj, role] of [
    ['Your application for Senior Global Supply Manager, Contract Manufacturing is on its way',
      'Senior Global Supply Manager, Contract Manufacturing'],
    ['Your application for Senior Sales Operations Analyst is on its way', 'Senior Sales Operations Analyst'],
    ['Your application for Program Manager is on its way', 'Program Manager'],
  ]) {
    const r = extractRoleFromEmail(subj, '');
    assert.equal(r.role, role, subj);
  }
});

test('snippet companion recovers role AND company from "applying to ROLE and for your interest in COMPANY"', () => {
  const r = extractRoleFromEmail('Your application is on its way',
    'Hello Ramy , Thank you for applying to the Program Manager and for your interest in Generac. We are excited');
  assert.equal(r.role, 'Program Manager');
  assert.equal(r.company, 'Generac');
});

test('deriveCompanyFromText pulls the employer from a relay ack body', () => {
  assert.equal(deriveCompanyFromText(
    'Your application for Program Manager is on its way',
    'Hello Ramy , Thank you for applying to the Program Manager and for your interest in Generac. We are excited to get to know you.',
    ''), 'Generac');
  // "Thank you for your interest in StackAdapt!" subject form.
  assert.equal(deriveCompanyFromText('Thank you for your interest in StackAdapt!', '', ''), 'StackAdapt');
  // No recognizable employer phrasing → '' (caller falls back).
  assert.equal(deriveCompanyFromText('Re: your stuff', 'hi there', ''), '');
});

// ── StackAdapt / Aritzia confirmations are acks, not next-steps (Bugs 2 & 3) ──

test('StackAdapt confirmation classifies as received, never an interview flag', () => {
  const signal = detectSignal(
    'Thank you for your interest in StackAdapt!',
    "Hello Ramy! Thanks for applying for the Data Analyst, Business Intelligence position at StackAdapt—we're so excited you're interested in joining our team! We've received your application",
    '', 'StackAdapt <no-reply@stackadapt.com>');
  assert.equal(signal.type, 'received');
});

test('Aritzia ack with the "Thanks you" vendor typo still classifies as received', () => {
  const signal = detectSignal(
    'Aritzia Thanks you for your Application!',
    'Thank you for your application. Our team will review it and be in touch.',
    '', '"My Workday @ Aritzia" <myworkday@aritzia.com>');
  assert.equal(signal.type, 'received');
});

// ── verification / security-code emails (2026-06-17) ─────────────────────────
// Greenhouse sends ALL security codes from one address, so when they fell
// through to 'received' acks (the code is alphanumeric, the old extractor only
// read numeric) they cross-pollinated applications — a StackAdapt code rendered
// inside Ada's conversation. They must classify as 'verification' (→ dropped).

test('Greenhouse alphanumeric security code → verification (not a "received" ack)', () => {
  const signal = detectSignal(
    'Security code for your application to Ada',
    'Hi Ramy, Copy and paste this code into the security code field on your application: FFmPTiwD After you enter the code, resubmit your application.',
    'Hi Ramy, Copy and paste this code into the security code field on your application: FFmPTiwD After you enter the code, resubmit your application.',
    'Greenhouse <no-reply@us.greenhouse-mail.io>');
  assert.equal(signal.type, 'verification');
});

test('security-code subject classifies as verification even when the code cannot be parsed', () => {
  const signal = detectSignal(
    'Security code for your application to StackAdapt',
    'Please use the code provided in your portal.', '',
    'Greenhouse <no-reply@us.greenhouse-mail.io>');
  assert.equal(signal.type, 'verification');
});

test('extractVerificationCodes reads an alphanumeric Greenhouse code', () => {
  const codes = extractVerificationCodes(
    'Copy and paste this code into the security code field on your application: A7u13ANi',
    'Security code for your application to Plooto');
  assert.equal(codes[0]?.value, 'A7u13ANi');
});

test('extractVerificationCodes still reads a numeric OTP', () => {
  const codes = extractVerificationCodes('Your verification code is 482913', 'Verify your email');
  assert.equal(codes[0]?.value, '482913');
});

// ── Workday submit-confirm acks (the Generac "Myworkday" cards, 2026-06-17) ───
// "Your application for X is on its way" is a pure receipt. Its body often
// describes the process ("we'll be in touch about next steps"), which used to
// loose-match the interview list and stack non-confident interview flags in
// Needs Review (3 Generac roles collapsed into one "Myworkday" card).

test('Workday "is on its way" submit-confirm → received, not a loose interview flag', () => {
  const signal = detectSignal(
    'Your application for Senior Global Supply Manager, Contract Manufacturing is on its way',
    'Hello Ramy, Thank you for applying to the Senior Global Supply Manager, Contract Manufacturing and for your interest in Generac. We will be in touch about next steps.',
    '', 'generac@myworkday.com');
  assert.equal(signal.type, 'received');
});

test('a genuine interview invite is still classified as interview (no over-suppression)', () => {
  const signal = detectSignal(
    'Interview Invitation - Project Manager',
    'We would like to schedule an interview with you for next week.',
    '', 'recruiter@acme.com');
  assert.equal(signal.type, 'interview');
});
