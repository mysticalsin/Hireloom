// role-index.mjs — unified role index over BOTH the tracker (data/applications.md)
// and the apply pool (output/pool-apply-order.json), plus email→role matching.
//
// Why this exists: SMS Equipment Inc. was pool-applied (rank 47, n 192,
// appliedDate 2026-05-29) but invisible to the Gmail matcher because only
// applications.md was consulted — the interview invitation had nothing to
// match against. The index is the single surface every matcher consults.
//
// Pure module: all builders take data as ARGUMENTS. The only fs lives in
// loadRoleIndex (clearly-named convenience loader at the bottom).

import { readFileSync } from 'fs';
import { join } from 'path';

// Corporate boilerplate stripped when normalizing a company NAME for
// comparison ("SMS Equipment Inc." ≡ "SMS Equipment"). Deliberately short —
// 'canada' is NOT here (it distinguishes "Compass Group Canada" from other
// Compass entities) even though it IS in the domain stoplist below.
export const COMPANY_SUFFIXES = ['inc', 'ltd', 'llc', 'corp', 'co', 'group', 'international', 'the'];

// Domain tokens too generic to identify a company on their own. A sender at
// careers-canada.example must not match every company with "Canada" in its
// name — at least one NON-stoplist token has to corroborate.
export const DOMAIN_STOPLIST = ['inc', 'ltd', 'llc', 'corp', 'co', 'group', 'canada', 'international',
  'the', 'solutions', 'technologies', 'careers', 'jobs', 'mail', 'email', 'hire', 'talent',
  'recruiting', 'notification', 'noreply'];

// Multi-tenant ATS mail domains: thousands of companies send from these, so
// the DOMAIN says nothing about WHICH company wrote. For these senders only
// Layer 1 (company name in from/subject) + role-title evidence may match.
export const ATS_DOMAINS = ['greenhouse-mail.io', 'lever.co', 'ashbyhq.com', 'bamboohr.com',
  'myworkday.com', 'smartrecruiters.com', 'icims.com', 'indeed.com'];

// Statuses that mean "no longer in play" for the open-over-closed tiebreak.
// Superset of gmail-signals matchApplication's list: pool rows carry
// 'expired' (posting died), which is just as closed as a rejection.
export const CLOSED_STATUSES = ['rejected', 'discarded', 'skip', 'offer', 'expired'];

// ── normalization helpers ───────────────────────────────────────────────────

// Lowercase, strip punctuation, collapse spaces — same normalizer the title
// matcher in gmail-signals uses, shared here by names, titles and haystacks.
export function normName(v) {
  return (v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const SUFFIX_SET = new Set(COMPANY_SUFFIXES);
const STOP_SET = new Set(DOMAIN_STOPLIST);
// For the ACRONYM only the legal boilerplate is dropped: 'group' and
// 'international' contribute letters (Philip Morris International → PMI,
// Compass Group Canada → CGC), so they must stay in.
const ACRONYM_EXCLUDE = new Set(['inc', 'ltd', 'llc', 'corp', 'co', 'the']);

export function normCompany(name) {
  return normName(name).split(' ').filter(t => t && !SUFFIX_SET.has(t)).join(' ');
}

// Share of the SMALLER token set that overlaps — "Business Systems CI Project
// Manager" vs "Business Systems, Continuous Improvement Project Manager" is
// 4/5 = 0.8, the same role despite the abbreviation.
function tokenOverlap(a, b) {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hits = 0;
  for (const t of A) if (B.has(t)) hits++;
  return hits / Math.min(A.size, B.size);
}

export function companiesMatch(a, b) {
  const x = normCompany(a), y = normCompany(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

export function titlesSimilar(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x) || tokenOverlap(x, y) >= 0.6;
}

// ── tracker parsing ─────────────────────────────────────────────────────────

// Tracker statuses are canonical (templates/states.yml) but arrive with
// markdown bold, stray trailing dates, and case drift — strip, don't alias.
function normalizeStatus(raw) {
  return (raw || '').replace(/\*\*/g, '').trim().toLowerCase()
    .replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
}

// Same column walk as engine/tracker/followup-cadence.mjs parseTracker, but
// pure: content in, rows out. Header/separator rows fail parseInt and drop.
export function parseTrackerRows(mdContent) {
  const rows = [];
  for (const line of (mdContent || '').split('\n')) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 9) continue;
    const num = parseInt(parts[1], 10);
    if (Number.isNaN(num)) continue;
    rows.push({
      num, date: parts[2], company: parts[3], role: parts[4],
      score: parts[5], status: normalizeStatus(parts[6]),
      pdf: parts[7], report: parts[8], notes: parts[9] || '',
    });
  }
  return rows;
}

// ── index building ──────────────────────────────────────────────────────────

// buildRoleIndex({ trackerContent, pool, links }) → { roles, byKey }
//   trackerContent: applications.md string
//   pool:  parsed output/pool-apply-order.json ({ rows: [...] }) or null
//   links: parsed data/role-links.json ({ merges: [{from, into, at}] }) or null
//
// A pool row and a tracker row for the same application JOIN into one role:
// the tracker key wins, the full pool role rides under .pool, and the apply
// artifacts (url/cvPath/coverPath/folder/rank/ats) backfill the top level so
// callers never need to know which layer a fact came from.
export function buildRoleIndex({ trackerContent = '', pool = null, links = null } = {}) {
  const roles = [];
  const byKey = {};

  for (const r of parseTrackerRows(trackerContent)) {
    const linkM = (r.report || '').match(/\]\(([^)]+)\)/); // markdown link → path; plain text ("Pool") → null
    const role = {
      key: 't' + r.num, num: r.num, company: r.company, role: r.role,
      status: r.status, date: r.date, score: r.score, notes: r.notes,
      reportLink: linkM ? linkM[1] : null, source: 'tracker',
    };
    roles.push(role);
    byKey[role.key] = role;
  }
  const trackerRoles = roles.slice();

  const poolRoles = [];
  for (const row of (pool?.rows || [])) {
    if (!row) continue;
    const n = row.n ?? row.rank;
    poolRoles.push({
      key: 'p' + n, poolN: n, rank: row.rank, company: row.company,
      role: (row.title || '').trim(), // pool titles carry trailing spaces in the wild
      status: (row.status || 'pending').toLowerCase(), // 'Discarded'/'discarded' case drift; absent = pending
      // Both appliedAt (ISO) and appliedDate (date-only) exist in the wild.
      appliedOn: row.appliedAt?.slice(0, 10) || row.appliedDate || null,
      // For indeed rows .url is a Google-search FALLBACK — the real posting
      // lives in .indeed.
      url: row.ats === 'indeed' ? (row.indeed || row.url) : row.url,
      ats: row.ats, loc: row.loc, archetype: row.archetype, tier: row.tier,
      cvPath: row.cv, coverPath: row.cover, folder: row.folder, note: row.note,
      source: 'pool',
    });
  }
  // Two-pass join: EXACT normalized-title matches claim their tracker row
  // first; fuzzy (token-overlap) joins only fill what's left. One-pass fuzzy
  // let Kong's "…Security Engineering" pool row (80% overlap, iterated first)
  // steal tracker #120 from its true twin "…Engineering Operations" — the
  // closed tracker row then hid behind an open pool double in the matcher.
  const joinPool = (p) => {
    const target = p._target;
    delete p._target;
    target.pool = p;
    for (const [k, v] of [['url', p.url], ['cvPath', p.cvPath], ['coverPath', p.coverPath],
      ['folder', p.folder], ['rank', p.rank], ['ats', p.ats]]) {
      if (target[k] == null) target[k] = v;
    }
    byKey[p.key] = target; // callers holding the pool key still resolve
  };
  const exactTitle = (a, b) => normName(a) === normName(b);
  const leftovers = [];
  for (const p of poolRoles) {
    const t = trackerRoles.find(t => !t.pool && companiesMatch(t.company, p.company) && exactTitle(t.role, p.role));
    if (t) { p._target = t; joinPool(p); } else leftovers.push(p);
  }
  for (const p of leftovers) {
    const t = trackerRoles.find(t => !t.pool && companiesMatch(t.company, p.company) && titlesSimilar(t.role, p.role));
    if (t) { p._target = t; joinPool(p); }
    else { roles.push(p); byKey[p.key] = p; }
  }

  // Manual merge links (user said "these two rows are the same application").
  // The absorbed role leaves the roles list but its key keeps resolving.
  // Field rules (user-specified): FILE PATHS from the incoming role OVERWRITE
  // the target's when present (one Show-in-Finder path, newest wins); every
  // other field defers to the target when set — blanks fill from the
  // absorbed role. Conflicting values stay visible via .absorbed.
  for (const m of (links?.merges || [])) {
    const fromRole = byKey[m.from], intoRole = byKey[m.into];
    if (!fromRole || !intoRole || fromRole === intoRole) continue;
    intoRole.absorbed = [...(intoRole.absorbed || []), fromRole];
    for (const k of ['cvPath', 'coverPath', 'folder']) {
      if (fromRole[k] != null) intoRole[k] = fromRole[k];
    }
    for (const k of ['url', 'rank', 'ats', 'loc', 'archetype', 'tier', 'reportLink', 'score', 'appliedOn']) {
      if (intoRole[k] == null && fromRole[k] != null) intoRole[k] = fromRole[k];
    }
    const i = roles.indexOf(fromRole);
    if (i !== -1) roles.splice(i, 1);
    for (const k of Object.keys(byKey)) if (byKey[k] === fromRole) byKey[k] = intoRole;
  }

  return { roles, byKey };
}

// ── email → role matching ───────────────────────────────────────────────────

export function senderDomain(from) {
  const m = (from || '').toLowerCase().match(/@([a-z0-9.-]+)/);
  return m ? m[1].replace(/\.+$/, '') : null;
}

// Registrable root label: drop the TLD, and a second-level public suffix when
// present (foo.co.uk → foo). careers.inside-pmi.com → inside-pmi.
const SECOND_LEVEL_TLDS = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac']);
export function domainRoot(domain) {
  const labels = (domain || '').split('.').filter(Boolean);
  if (labels.length < 2) return labels[0] || null;
  labels.pop();
  if (labels.length > 1 && SECOND_LEVEL_TLDS.has(labels[labels.length - 1])) labels.pop();
  return labels[labels.length - 1] || null;
}

function isAtsDomain(domain) {
  return ATS_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
}

// Does the sender's domain root identify this company? Three paths:
//  (a) compact containment — smsequip ⊂ smsequipment — gated on the shorter
//      side being >=6 chars (lever ⊂ clevertap must NOT match);
//  (b) every long (>=4) domain token is a company-name token AND at least one
//      is distinctive (compass-canada → Compass Group Canada; a root made
//      only of stoplist words identifies nobody);
//  (c) acronym — inside-pmi carries 'pmi' = Philip Morris International.
export function domainMatchesCompany(root, company) {
  if (!root) return false;
  const compactRoot = root.replace(/[-_]/g, '');
  const tokens = root.split(/[-_]/).filter(Boolean);
  const compactCompany = normCompany(company).replace(/ /g, '');
  if (!compactRoot || !compactCompany) return false;

  const shorter = Math.min(compactRoot.length, compactCompany.length);
  if (shorter >= 6 && (compactCompany.includes(compactRoot) || compactRoot.includes(compactCompany))) return true;

  const companyTokens = new Set(normName(company).split(' ').filter(Boolean));
  const long = tokens.filter(t => t.length >= 4);
  if (long.length && long.every(t => companyTokens.has(t)) && long.some(t => !STOP_SET.has(t))) return true;

  const acr = normName(company).split(' ').filter(t => t && !ACRONYM_EXCLUDE.has(t)).map(t => t[0]).join('');
  if (acr.length >= 3) {
    for (const t of [...tokens, compactRoot]) {
      if (t.length >= 3 && (t === acr || t.startsWith(acr) || t.endsWith(acr))) return true;
    }
  }
  return false;
}

// Pick the role an email belongs to — superset of gmail-signals
// matchApplication, run over the WHOLE index (tracker + pool):
//   Layer 1: company name contained in from/subject (raw, like the original,
//            plus normalized so "SMS Equipment Inc." matches "SMS Equipment");
//   Layer 2: sender-domain identification (NEW) — never for ATS domains;
//   then narrow multi-candidates by the role title the email names (subject +
//   body, then the caller-extracted roleHint), and only THEN prefer a role
//   still in play over a closed one.
export function matchEmailToRole(index, { from = '', subject = '', text = '', roleHint = '' } = {}) {
  const roles = index?.roles || [];
  const f = from.toLowerCase(), s = subject.toLowerCase();
  const nf = normName(from), ns = normName(subject);

  const candidates = roles.filter(r => {
    const raw = (r.company || '').toLowerCase().trim();
    if (raw && (f.includes(raw) || s.includes(raw))) return true;
    const nc = normCompany(r.company);
    return nc.length >= 3 && (nf.includes(nc) || ns.includes(nc));
  });

  const domain = senderDomain(from);
  if (domain && !isAtsDomain(domain)) {
    const root = domainRoot(domain);
    for (const r of roles) {
      if (!candidates.includes(r) && domainMatchesCompany(root, r.company)) candidates.push(r);
    }
  }
  if (candidates.length <= 1) return candidates[0] || null;

  // Title evidence narrows BEFORE the open-over-closed tiebreak — a rejection
  // naming a specific (already-closed) role must file against THAT role.
  let pool = candidates;
  const haystack = normName(subject + ' ' + text);
  const byTitle = pool.filter(r => {
    const t = normName(r.role);
    return t && haystack.includes(t);
  });
  if (byTitle.length) pool = byTitle;
  if (roleHint) {
    const byHint = pool.filter(r => titlesSimilar(r.role, roleHint));
    if (byHint.length) pool = byHint;
  }
  const open = pool.filter(r => !CLOSED_STATUSES.includes(r.status));
  return open[0] || pool[0];
}

// ── fs convenience loader (the ONLY I/O in this module) ─────────────────────

export function loadRoleIndex({ rootDir } = {}) {
  const read = (p) => { try { return readFileSync(p, 'utf-8'); } catch { return null; } };
  const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } };
  // Same fallback order as followup-cadence.mjs: data/applications.md, then
  // the legacy root-level applications.md. Everything is tolerant of absence.
  const trackerContent = read(join(rootDir, 'data/applications.md'))
    ?? read(join(rootDir, 'applications.md')) ?? '';
  const pool = readJson(join(rootDir, 'output/pool-apply-order.json'));
  const links = readJson(join(rootDir, 'data/role-links.json'));
  return buildRoleIndex({ trackerContent, pool, links });
}
