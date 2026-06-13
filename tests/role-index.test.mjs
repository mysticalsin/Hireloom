import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  parseTrackerRows, buildRoleIndex, matchEmailToRole, loadRoleIndex,
  domainMatchesCompany, companiesMatch, titlesSimilar,
  parseAppFolder, parseAecomFolder, loadLanes, ROLE_KEY_RE, LANE_SOURCE,
} from '../apps/web/lib/role-index.mjs';

// ── fixtures ─────────────────────────────────────────────────────────────────

const TRACKER_HEADER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`;

const PCC_TRACKER = TRACKER_HEADER + `| 10 | 2026-05-10 | PointClickCare | Project Coordinator, Contractor - 6 Months | N/A | Applied | ✅ | Pool | first PCC app |
| 11 | 2026-05-10 | PointClickCare | Associate Product Manager - Data Projects | N/A | Applied | ✅ | Pool | second PCC app |
| 45 | 2026-05-12 | PointClickCare | Sr. Project Manager (6 month contract) | 4.5/5 | Applied | ✅ | [45](reports/045-pointclickcare-2026-05-12.md) | third PCC app |
| 76 | 2026-05-26 | Capgemini | Program Delivery Lead | N/A | Applied | ✅ | Indeed | Indeed pipeline |
`;

// The real SMS Equipment pool row (the bug this module exists to fix).
const SMS_POOL_ROW = {
  rank: 47, n: 192,
  title: 'Business Systems, Continuous Improvement Project Manager ', // trailing space in the wild
  company: 'SMS Equipment Inc.', loc: 'Acheson, AB',
  url: 'https://www.google.com/search?q=SMS%20Equipment%20Inc.%20careers',
  indeed: 'https://ca.indeed.com/viewjob?jk=85e4ffc6dc072f49',
  ats: 'indeed', archetype: 'PROG_PM', tier: 0,
  cv: 'output/applications/pool-192/Resume.pdf', cover: 'output/applications/pool-192/Cover.pdf',
  folder: 'output/applications/pool-192', tailor: 'claude',
  note: 'Applied via Indeed/company site.', status: 'applied', appliedDate: '2026-05-29',
};

// ── parseTrackerRows ─────────────────────────────────────────────────────────

test('parseTrackerRows: ints, lowercased status, bold/date stripped, header skipped', () => {
  const md = TRACKER_HEADER + `| 5 | 2026-05-01 | Acme | PM | 4.0/5 | **Applied** 2026-05-02 nudged | ✅ | [5](reports/005-acme-2026-05-01.md) | notes here |
| 6 | 2026-05-02 | Beta | TPM | N/A | Submitted? | ❌ | Pool | |
`;
  const rows = parseTrackerRows(md);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].num, 5);
  assert.equal(typeof rows[0].num, 'number');
  assert.equal(rows[0].status, 'applied'); // bold + trailing date/extra stripped
  assert.equal(rows[0].company, 'Acme');
  assert.equal(rows[0].notes, 'notes here');
  assert.equal(rows[1].status, 'submitted?'); // labels survive, just lowercased
});

// ── buildRoleIndex: shapes ───────────────────────────────────────────────────

test('tracker role shape + reportLink parsed from markdown link (plain text → null)', () => {
  const { roles, byKey } = buildRoleIndex({ trackerContent: PCC_TRACKER });
  assert.equal(roles.length, 4);
  const r45 = byKey.t45;
  assert.equal(r45.num, 45);
  assert.equal(r45.source, 'tracker');
  assert.equal(r45.status, 'applied');
  assert.equal(r45.reportLink, 'reports/045-pointclickcare-2026-05-12.md');
  assert.equal(byKey.t76.reportLink, null); // 'Indeed' is not a link
});

test('pool role mapping: status default/case, appliedOn variants, indeed url swap, title trim', () => {
  const pool = { rows: [
    SMS_POOL_ROW,
    { rank: 1, n: 1, title: 'Technical Delivery PM', company: 'League', ats: 'greenhouse',
      url: 'https://job-boards.greenhouse.io/leagueinc/jobs/1', status: 'applied',
      appliedAt: '2026-05-27T12:23:38.884Z' },
    { rank: 2, n: 2, title: 'Delivery Lead', company: 'Orbit', ats: 'ashby', url: 'https://x', status: 'Discarded' },
    { rank: 3, n: 3, title: 'PM', company: 'Nimbus', ats: 'lever', url: 'https://y' },
  ] };
  const { byKey } = buildRoleIndex({ pool });
  const sms = byKey.p47;
  assert.equal(sms.role, 'Business Systems, Continuous Improvement Project Manager');
  assert.equal(sms.url, SMS_POOL_ROW.indeed); // indeed rows: .url is a Google-search fallback
  assert.equal(sms.appliedOn, '2026-05-29'); // appliedDate (date-only) variant
  assert.equal(byKey.p1.appliedOn, '2026-05-27'); // appliedAt (ISO) variant
  assert.equal(byKey.p1.url, 'https://job-boards.greenhouse.io/leagueinc/jobs/1');
  assert.equal(byKey.p2.status, 'discarded'); // 'Discarded' case drift normalized
  assert.equal(byKey.p3.status, 'pending'); // absent status = pending
  assert.equal(byKey.p3.appliedOn, null);
});

test('pool keys are unique by rank even when n collides (the p147 wrong-role bug)', () => {
  // The frozen 350-pool mis-numbers four rows: two distinct roles share an n
  // (147-150 each appear twice). Keying by n routed both to one key, so a click
  // on one directory row opened the OTHER role's page. Rank is unique → 1:1.
  const pool = { rows: [
    { rank: 2,   n: 147, title: 'Senior Project Manager', company: 'A.E.W. Limited Partnership', ats: 'lever', url: 'https://a' },
    { rank: 183, n: 147, title: 'Sales Operations Specialist', company: 'TouchBistro', ats: 'greenhouse', url: 'https://b' },
  ] };
  const { roles, byKey } = buildRoleIndex({ pool });
  assert.equal(roles.length, 2);                          // both survive (distinct company+title)
  assert.equal(byKey.p2.company, 'A.E.W. Limited Partnership');
  assert.equal(byKey.p183.company, 'TouchBistro');        // collision partner has its OWN key
  assert.equal(byKey.p2.poolN, 147);                      // n preserved (folder name / display)
  assert.equal(byKey.p183.poolN, 147);
  assert.ok(!('p147' in byKey));                          // the colliding n is no longer a key
});

// ── buildRoleIndex: tracker+pool join ────────────────────────────────────────

test('join merges the SMS-like duplicate: tracker key wins, pool attached, artifacts backfilled', () => {
  const trackerContent = TRACKER_HEADER +
    '| 130 | 2026-05-29 | SMS Equipment | Business Systems CI Project Manager | N/A | Applied | ✅ | Pool | applied off-pool |\n';
  const { roles, byKey } = buildRoleIndex({ trackerContent, pool: { rows: [SMS_POOL_ROW] } });
  assert.equal(roles.length, 1); // one role, not two
  const merged = byKey.t130;
  assert.equal(merged.source, 'tracker'); // tracker wins
  assert.equal(merged.pool.poolN, 192); // full pool role rides along
  assert.equal(byKey.p47, merged); // pool key aliases to the merged role
  assert.equal(merged.url, SMS_POOL_ROW.indeed); // backfilled (real posting, not the Google fallback)
  assert.equal(merged.rank, 47);
  assert.equal(merged.ats, 'indeed');
  assert.equal(merged.cvPath, SMS_POOL_ROW.cv);
  assert.equal(merged.folder, SMS_POOL_ROW.folder);
});

test('join needs title similarity: same company, unrelated title stays separate', () => {
  const trackerContent = TRACKER_HEADER +
    '| 130 | 2026-05-29 | SMS Equipment | Warehouse Site Supervisor | N/A | Applied | ✅ | Pool | different role |\n';
  const { roles, byKey } = buildRoleIndex({ trackerContent, pool: { rows: [SMS_POOL_ROW] } });
  assert.equal(roles.length, 2);
  assert.notEqual(byKey.p47, byKey.t130);
});

test('links.merges: from-role absorbed, removed from roles, key aliases to the merged role', () => {
  const trackerContent = TRACKER_HEADER +
    '| 130 | 2026-05-29 | SMS Equipment | Warehouse Site Supervisor | N/A | Applied | ✅ | Pool | manual link |\n';
  const links = { merges: [{ from: 'p47', into: 't130', at: '2026-06-12' }] };
  const { roles, byKey } = buildRoleIndex({ trackerContent, pool: { rows: [SMS_POOL_ROW] }, links });
  assert.equal(roles.length, 1);
  assert.equal(byKey.t130.absorbed.length, 1);
  assert.equal(byKey.t130.absorbed[0].key, 'p47');
  assert.equal(byKey.p47, byKey.t130);
  assert.ok(!roles.some(r => r.key === 'p47'));
});

// ── matchEmailToRole: the SMS bug ────────────────────────────────────────────

test('SMS pool row matched from its real interview invitation (the original miss)', () => {
  const index = buildRoleIndex({ trackerContent: PCC_TRACKER, pool: { rows: [SMS_POOL_ROW] } });
  const matched = matchEmailToRole(index, {
    from: 'SMS Equipment <careers@smsequip.com>',
    subject: 'Interview Invitation - Business Systems, Continuous Improvement Project Manager - Acheson, AB',
    text: '',
  });
  assert.ok(matched);
  assert.equal(matched.key, 'p47');
});

test('SMS matched from a bare address — pure domain path, no display name', () => {
  const index = buildRoleIndex({ pool: { rows: [SMS_POOL_ROW] } });
  const matched = matchEmailToRole(index, {
    from: 'careers@smsequip.com',
    subject: 'Interview Invitation',
    text: '',
  });
  assert.equal(matched?.key, 'p47');
});

// ── matchEmailToRole: domain-matching paths ──────────────────────────────────

test('PMI tracker row matched via the acronym path (inside-pmi → Philip Morris International)', () => {
  const trackerContent = TRACKER_HEADER +
    '| 88 | 2026-05-20 | Philip Morris International | Project Manager, Operations Excellence | N/A | Applied | ✅ | Pool | |\n';
  const index = buildRoleIndex({ trackerContent });
  const matched = matchEmailToRole(index, {
    from: 'PMI Careers <notification@careers.inside-pmi.com>',
    subject: 'An update on your application',
    text: '',
  });
  assert.equal(matched?.num, 88);
});

test('Compass tracker row matched from a role-less human email (domain tokens)', () => {
  const trackerContent = TRACKER_HEADER +
    '| 122 | 2026-05-27 | Compass Group Canada | Project Manager, Program Management | N/A | Applied | ❌ | Direct | |\n';
  const index = buildRoleIndex({ trackerContent });
  const matched = matchEmailToRole(index, {
    from: 'Devyn.Kelly@compass-canada.com',
    subject: 'Ramy Sherif and Kelly, Devyn',
    text: '',
  });
  assert.equal(matched?.num, 122);
});

test('domainMatchesCompany: containment path gated at 6 chars', () => {
  assert.equal(domainMatchesCompany('smsequip', 'SMS Equipment Inc.'), true);
  // 'lever' ⊂ 'clevertap' but the shorter side is 5 chars — must NOT match.
  assert.equal(domainMatchesCompany('lever', 'CleverTap'), false);
});

test('domainMatchesCompany: token path needs a distinctive token', () => {
  // compass-canada: 'canada' is stoplisted but 'compass' is distinctive.
  assert.equal(domainMatchesCompany('compass-canada', 'Compass Food Services Canada'), true);
  // careers-canada: ALL tokens stoplisted — identifies nobody.
  assert.equal(domainMatchesCompany('careers-canada', 'Careers Of Canada'), false);
});

test('domainMatchesCompany: acronym path (PMI), including compact endsWith', () => {
  assert.equal(domainMatchesCompany('inside-pmi', 'Philip Morris International'), true);
  assert.equal(domainMatchesCompany('insidepmi', 'Philip Morris International'), true); // 'insidepmi'.endsWith('pmi')
  assert.equal(domainMatchesCompany('inside-pmi', 'Compass Group Canada'), false);
});

// ── matchEmailToRole: ATS senders never domain-match ─────────────────────────

test('ATS domain never matches a company by domain (indeed.com digest vs "Indeed Flex")', () => {
  const trackerContent = TRACKER_HEADER +
    '| 90 | 2026-05-21 | Indeed Flex | Operations Project Manager | N/A | Applied | ✅ | Pool | |\n';
  const index = buildRoleIndex({ trackerContent });
  // Without the ATS guard, domain root 'indeed' token-matches 'Indeed Flex'
  // and every Indeed newsletter would file against that row.
  const matched = matchEmailToRole(index, {
    from: 'Indeed <donotreply@indeed.com>',
    subject: 'New jobs for you',
    text: '',
  });
  assert.equal(matched, null);
});

test('greenhouse-mail.io sender does not domain-match, even when the root would', () => {
  const trackerContent = TRACKER_HEADER +
    '| 91 | 2026-05-22 | Greenhouse Mailing Co | Delivery Manager | N/A | Applied | ✅ | Pool | |\n';
  const index = buildRoleIndex({ trackerContent });
  // Proof the GUARD is what blocks it: the domain root itself WOULD match.
  assert.equal(domainMatchesCompany('greenhouse-mail', 'Greenhouse Mailing Co'), true);
  const matched = matchEmailToRole(index, {
    from: 'no-reply@greenhouse-mail.io',
    subject: 'An update on your application',
    text: '',
  });
  assert.equal(matched, null);
});

test('ATS sender still matches via Layer 1 (company named in subject)', () => {
  const trackerContent = TRACKER_HEADER +
    '| 92 | 2026-05-23 | League | Technical Delivery Project Manager | N/A | Applied | ✅ | Pool | |\n';
  const index = buildRoleIndex({ trackerContent });
  const matched = matchEmailToRole(index, {
    from: 'no-reply@greenhouse-mail.io',
    subject: 'Your application to League',
    text: '',
  });
  assert.equal(matched?.num, 92);
});

// ── matchEmailToRole: matchApplication semantics preserved ───────────────────

test('same-company emails match the row whose role title the email names (PCC 3-row case)', () => {
  const index = buildRoleIndex({ trackerContent: PCC_TRACKER });
  const matched = matchEmailToRole(index, {
    from: 'PointClickCare <no-reply@hire.lever.co>',
    subject: 'Thank you for your interest, RAMY!',
    text: 'Thank you for your interest in PointClickCare and the position of Sr. Project Manager (6 month contract). Unfortunately the position you have applied to has now been filled.',
  });
  assert.equal(matched?.num, 45);
});

test('title match survives punctuation drift', () => {
  const index = buildRoleIndex({ trackerContent: PCC_TRACKER });
  const matched = matchEmailToRole(index, {
    from: 'no-reply@hire.lever.co',
    subject: 'PointClickCare — your application',
    text: 'regarding the Sr Project Manager 6 month contract opening',
  });
  assert.equal(matched?.num, 45);
});

test('no title named: prefers a row still in play over a closed one (incl. pool expired)', () => {
  const trackerContent = TRACKER_HEADER +
    '| 1 | 2026-05-01 | Acme | PM | N/A | Rejected | ✅ | Pool | |\n' +
    '| 2 | 2026-05-01 | Acme | TPM | N/A | Applied | ✅ | Pool | |\n';
  const index = buildRoleIndex({ trackerContent });
  const matched = matchEmailToRole(index, { from: 'jobs@acme.com', subject: 'Acme update', text: 'an update on your application' });
  assert.equal(matched?.num, 2);

  // Pool 'expired' counts as closed too.
  const poolIndex = buildRoleIndex({ pool: { rows: [
    { rank: 50, n: 50, title: 'Project Manager', company: 'Zebra Robotics', ats: 'ashby', url: 'https://x', status: 'expired' },
    { rank: 51, n: 51, title: 'Program Manager', company: 'Zebra Robotics', ats: 'ashby', url: 'https://y' },
  ] } });
  const m2 = matchEmailToRole(poolIndex, { from: 'people@zebrarobotics.com', subject: 'Hello from Zebra Robotics', text: '' });
  assert.equal(m2?.key, 'p51');
});

test('roleHint narrows candidates BEFORE the open-over-closed tiebreak', () => {
  // Row 11 is already closed; an email whose extracted role title names it
  // must still file against 11, not drift to an open sibling.
  const trackerContent = TRACKER_HEADER +
    '| 10 | 2026-05-10 | PointClickCare | Project Coordinator, Contractor - 6 Months | N/A | Applied | ✅ | Pool | |\n' +
    '| 11 | 2026-05-10 | PointClickCare | Associate Product Manager - Data Projects | N/A | Rejected | ✅ | Pool | |\n' +
    '| 45 | 2026-05-12 | PointClickCare | Sr. Project Manager (6 month contract) | N/A | Applied | ✅ | Pool | |\n';
  const index = buildRoleIndex({ trackerContent });
  const matched = matchEmailToRole(index, {
    from: 'PointClickCare <no-reply@hire.lever.co>',
    subject: 'An update from PointClickCare',
    text: 'We wanted to share an update with you.',
    roleHint: 'Associate Product Manager — Data Projects',
  });
  assert.equal(matched?.num, 11);
});

test('no company match returns null', () => {
  const index = buildRoleIndex({ trackerContent: PCC_TRACKER, pool: { rows: [SMS_POOL_ROW] } });
  assert.equal(matchEmailToRole(index, { from: 'x@y.com', subject: 'hello', text: '' }), null);
});

// ── join + match end-to-end: merged role is what the matcher returns ─────────

test('after a join, the email matches the MERGED role (tracker num, pool artifacts)', () => {
  const trackerContent = TRACKER_HEADER +
    '| 130 | 2026-05-29 | SMS Equipment | Business Systems CI Project Manager | N/A | Applied | ✅ | Pool | |\n';
  const index = buildRoleIndex({ trackerContent, pool: { rows: [SMS_POOL_ROW] } });
  const matched = matchEmailToRole(index, {
    from: 'SMS Equipment <careers@smsequip.com>',
    subject: 'Interview Invitation - Business Systems, Continuous Improvement Project Manager - Acheson, AB',
  });
  assert.equal(matched?.num, 130);
  assert.equal(matched?.pool?.poolN, 192);
});

// ── helper predicates ────────────────────────────────────────────────────────

test('companiesMatch strips corporate suffixes; titlesSimilar takes 0.6 token overlap', () => {
  assert.equal(companiesMatch('SMS Equipment', 'SMS Equipment Inc.'), true);
  assert.equal(companiesMatch('Acme', 'Zenith'), false);
  assert.equal(titlesSimilar('Business Systems CI Project Manager',
    'Business Systems, Continuous Improvement Project Manager'), true); // 4/5 overlap
  assert.equal(titlesSimilar('Warehouse Site Supervisor',
    'Business Systems, Continuous Improvement Project Manager'), false);
});

// ── loadRoleIndex ────────────────────────────────────────────────────────────

test('loadRoleIndex: reads the three files, tolerant of every one missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'role-index-'));
  try {
    // Completely empty root → empty index, no throw.
    const empty = loadRoleIndex({ rootDir: dir });
    assert.deepEqual(empty.roles, []);

    mkdirSync(join(dir, 'data'), { recursive: true });
    mkdirSync(join(dir, 'output'), { recursive: true });
    writeFileSync(join(dir, 'data/applications.md'), PCC_TRACKER);
    writeFileSync(join(dir, 'output/pool-apply-order.json'),
      JSON.stringify({ nextRank: 2, opened: [], rows: [SMS_POOL_ROW] }));
    // no data/role-links.json — must still load
    const index = loadRoleIndex({ rootDir: dir });
    assert.equal(index.roles.length, 5); // 4 tracker + 1 pool
    assert.equal(index.byKey.p47.company, 'SMS Equipment Inc.');
    assert.equal(index.byKey.t45.num, 45);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two-pass join: exact-title pool twin wins over an earlier fuzzy sibling (Kong #120)', () => {
  // Pool order: "Security Engineering" (n=9, 80% token overlap) precedes the
  // true twin "Engineering Operations" (n=10). One-pass fuzzy joined n=9 to
  // the tracker row and left the real twin standalone — the closed tracker
  // row then hid behind an open pool double in matchEmailToRole.
  const idx = buildRoleIndex({
    trackerContent: [
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 120 | 2026-05-29 | Kong | Senior Program Manager, Engineering Operations | N/A | Rejected | ✅ | Pool | closed |',
    ].join('\n'),
    pool: { rows: [
      { rank: 64, n: 9, title: 'Senior Program Manager, Security Engineering', company: 'Kong', url: 'https://x', ats: 'ashby', status: 'discarded' },
      { rank: 65, n: 10, title: 'Senior Program Manager, Engineering Operations', company: 'Kong', url: 'https://y', ats: 'ashby', status: 'applied' },
    ] },
  });
  assert.equal(idx.byKey['p65'].key, 't120', 'exact twin (rank 65) joins the tracker row');
  assert.equal(idx.byKey['p64'].key, 'p64', 'the different role (rank 64) stays standalone');
  const matched = matchEmailToRole(idx, {
    from: 'Kong Hiring Team <no-reply@ashbyhq.com>',
    subject: 'Reminder: Your Upcoming Interview with Kong',
    text: 'your interview for Senior Program Manager, Engineering Operations',
  });
  assert.equal(matched.num, 120, 'email resolves to the tracker row, not the pool double');
});

test('attach merge: incoming file paths overwrite, blanks defer to target (the user merge rules)', () => {
  const idx = buildRoleIndex({
    trackerContent: [
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 5 | 2026-05-20 | Acme | PM | 4.0/5 | Applied | ✅ | [005](reports/005-acme.md) | target |',
    ].join('\n'),
    pool: { rows: [
      { rank: 9, n: 33, title: 'Project Mgr', company: 'Acme Corp Industries', url: 'https://pool-url', ats: 'lever',
        cv: 'output/p33/cv.pdf', cover: 'output/p33/cover.pdf', folder: 'output/p33', status: 'applied', appliedDate: '2026-05-21' },
    ] },
    links: { merges: [{ from: 'p9', into: 't5', at: '2026-06-12' }] },
  });
  const r = idx.byKey['t5'];
  assert.equal(idx.byKey['p9'], r, 'absorbed key aliases to target');
  assert.equal(r.cvPath, 'output/p33/cv.pdf', 'incoming file path overwrites');
  assert.equal(r.url, 'https://pool-url', 'blank target field fills from absorbed');
  assert.equal(r.score, '4.0/5', 'set target field is kept');
  assert.equal(r.absorbed.length, 1);
  assert.ok(!idx.roles.some(x => x.key === 'p9'), 'absorbed role leaves the list');
});

// ── orphan-lane ingestion (the unified directory) ────────────────────────────

test('parseAppFolder: strips lead number / EXTRA prefix, splits company - role', () => {
  assert.deepEqual(parseAppFolder('01 - MDA Space - Transformation Process Manager'),
    { company: 'MDA Space', role: 'Transformation Process Manager' });
  assert.deepEqual(parseAppFolder('Bombardier - Methods Project Specialist (11727)'),
    { company: 'Bombardier', role: 'Methods Project Specialist (11727)' });
  assert.deepEqual(parseAppFolder('EXTRA - Acme - Project Manager'),
    { company: 'Acme', role: 'Project Manager' });
  assert.equal(parseAppFolder('NoSeparatorHere'), null);
});

test('parseAecomFolder: company is always AECOM, role keeps its dashes', () => {
  assert.deepEqual(parseAecomFolder('3 - Ioana Ardelean - Program Manager - Rail & Transit'),
    { company: 'AECOM', role: 'Program Manager - Rail & Transit', recruiter: 'Ioana Ardelean' });
  assert.equal(parseAecomFolder('too - short'), null);
});

test('ROLE_KEY_RE accepts every lane prefix, rejects junk', () => {
  for (const k of ['t1', 'p350', 'v12', 'a5', 'i40', 'x3']) assert.ok(ROLE_KEY_RE.test(k), k + ' valid');
  for (const k of ['tp151', 'z1', 't', '1', 'p1234567', 'av2']) assert.ok(!ROLE_KEY_RE.test(k), k + ' invalid');
  assert.equal(LANE_SOURCE.v, 'aviation');
  assert.equal(LANE_SOURCE.i, 'indeed');
});

test('lanes fold in: a matching lane row JOINS its canonical role, a new one stands alone', () => {
  const idx = buildRoleIndex({
    trackerContent: TRACKER_HEADER + '| 5 | 2026-05-20 | Capgemini | Program Delivery Lead | 4.0/5 | Applied | ✅ | [005](reports/5.md) | x |\n',
    pool: { rows: [{ rank: 9, n: 9, title: 'Project Mgr', company: 'GTAA' }] },
    // indeed row duplicates the tracker Capgemini role → must join t5 (carry laneN)
    indeed: [{ company: 'Capgemini', role: 'Program Delivery Lead', n: 41, status: 'applied' }],
    // aviation row is unique → its own canonical role
    aviation: [{ company: 'Porter Airlines', role: 'Business Analyst', folder: 'output/applications-aviation/03 - Porter' }],
  });
  const cap = idx.byKey['t5'];
  assert.equal(idx.byKey['i1'], cap, 'duplicate indeed row resolves to the tracker role');
  assert.equal(cap.laneN, 41, 'the indeed lane number rides onto the canonical role (for JD pairing)');
  assert.ok(cap.lanes.includes('indeed') && cap.lanes.includes('tracker'), 'role spans both lanes');
  const av = idx.roles.find(r => r.key === 'v1');
  assert.ok(av && av.company === 'Porter Airlines', 'a unique aviation row becomes its own role');
  assert.equal(av.folder, 'output/applications-aviation/03 - Porter', 'lane folder carried for Show-in-Finder');
});

test('overrides win last: status + fields applied by canonical key', () => {
  const idx = buildRoleIndex({
    pool: { rows: [{ rank: 1, n: 1, title: 'PM', company: 'Acme', status: 'pending' }] },
    overrides: [{ key: 'p1', status: 'Interview', notes: 'phone screen booked', comp: 'C$130K' }],
  });
  const r = idx.byKey['p1'];
  assert.equal(r.status, 'interview', 'override status applied (lowercased)');
  assert.equal(r.notes, 'phone screen booked', 'override notes applied');
  assert.equal(r.compOverride, 'C$130K', 'comp override stored separately');
});

test('loadLanes is tolerant of a missing output/ tree (returns empty lanes)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lanes-'));
  try {
    const lanes = loadLanes(dir);
    assert.deepEqual(lanes, { aviation: [], aecom: [], indeed: [], loose: [] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
