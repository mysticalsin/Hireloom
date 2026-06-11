#!/usr/bin/env node
/**
 * probe-ats.mjs — Locate each company's ATS board, find Canada-eligible target
 * roles, and report. Adds new Greenhouse/Lever/Ashby companies to portals.yml;
 * flags Workable/Recruitee as "needs handler" (no form handler yet).
 *
 * Output: output/ats-probe-report.json + console summary.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';

const COMPANIES = `1Password
7shifts
AbCellera
Absorb Software
Achievers
Ada
Addepar
Affirm
Airbyte
Airtable
AlayaCare
Algolia
AltaML
Amplemarket
Anduril
Anthropic
Apollo Insurance
Apply Digital
ApplyBoard
Arctic Wolf
Arista Networks
Article
Arteria AI
Asana
Aspect Biosystems
AssemblyAI
Atlassian
Attabotics
Autodesk
Axon
Bench Accounting
BenchSci
Benevity
BetterUp
BigID
Bill.com
BIM Track
BitGo
Bitwarden
Block
BlueCat
Bolt
Borrowell
Brex
Brim Financial
Buildkite
Canva
CarbonCure
Carta
Celestica
Checkr
Chime
Choco
Chronosphere
ChurnZero
CircleCI
Clearco
Clearpath Robotics
ClickHouse
ClickUp
Clio
Cloudflare
Clutch
Cockroach Labs
Coconut Software
Cohere
Confluent
Contentful
Cority
Coveo
CrowdRiff
CrowdStrike
Cursor
Anysphere
D2L
Dapper Labs
Databricks
Datadog
Deel
DeepL
Dialogue Health
Dialpad
Diligent
Discord
Doctolib
DoorDash
Drata
Drop
Dropbox
Druva
ecobee
Elastic
ElevenLabs
eSentire
Faire
Fastly
Felix Health
Figma
Flexport
Flipp
Float
FreshBooks
Front
Fullscript
FundThrough
Gainsight
Gem
General Fusion
Geotab
GitLab
GoBolt
Gong
Goodlawyer
Grafana Labs
Grammarly
Granify
Greenhouse Software
HashiCorp
Helcim
HelloFresh
Hex Technologies
Highspot
Hootsuite
Hopper
HouseSigma
HubSpot
Hugging Face
Human Interest
Humi
Hydrostor
Hypercare
Influitive
Instacart
Intercom
Jane App
Jobber
Kinaxis
Kira Systems
Klaviyo
Klipfolio
Klue
Knak
Knix
Koho
Konrad
LangChain
Later
Lattice
LaunchDarkly
League
Lever
Lightspeed
Linear
Linktree
Loblaw Digital
Lone Wolf Real Estate
Looka
Lookout
Loop
Loop Insurance
Loopio
Lucid Software
Magic Leap
Magnet Forensics
Mapbox
Maple
Mejuri
Mercury
Meta
Miovision
Miro
Mistplay
Modal Labs
Mogo
Mojio
Monday.com
MongoDB
Motive
MURAL
Mux
Neo Financial
Netlify
New Relic
Newton
NexHealth
Notion
NVIDIA
Okta
OpenAI
OpenText
Optable
Outreach
PagerDuty
Palantir
PandaDoc
Pelmorex
Pendo
Perplexity
Persona
Pillway
Pinecone
Pinterest
Plaid
PlanetScale
Pleo
Plooto
Plusgrade
PointClickCare
PolicyMe
PostHog
Procore
Procurify
Prodigy Education
Productboard
Q4 Inc
Quandri
Ramp
Reddit
Relay
Remote.com
Replicate
Replit
Retool
Rewind
Rippling
Rise People
Ritual
Robinhood
Rogers Communications
SADA
Salesloft
Samsara
Sanctuary AI
Scale AI
Sentry
ServiceTitan
Shakepay
Shopify
Slack
Snowflake
Snyk
Solink
Sonder
SOTI
Sourcegraph
Square
StackAdapt
Stripe
Substack
Super.com
Surbana Jurong
SUSE
Svante
Symend
Tailscale
Tealbook
Tehama
TELUS
Tenstorrent
Tesla
Thales
Thinkific
Top Hat
TouchBistro
Trexo Robotics
Trolley
Trufla
Trulioo
Tucows
Tulip Retail
Turo
Twilio
Unilever
Unity
Unqork
Untether AI
Uplight
Vanta
Vena Solutions
Vercel
Verkada
Versapay
Vidyard
Visier
Voiceflow
Waabi
Wagepoint
Wattpad
Wave Financial
Wealthsimple
Webflow
WeTransfer
Wise
Workato
Workday
WorkJam
Workleap
Wrike
Wysdom AI
Zapier
Zendesk
Zoom`.split('\n').map(s => s.trim()).filter(Boolean);

// ── target titles (PM/PC prioritized) ──
const TITLE_RE = /\b(project coordinator|associate project manager|junior project manager|senior project manager|technical project manager|project manager|implementation (manager|specialist|consultant|lead)|delivery manager|senior program manager|technical program manager|program manager|senior business analyst|business analyst)\b/i;
const PRIORITY_RE = /\b(project manager|project coordinator)\b/i;
// Adjacent roles the candidate is plausibly qualified for — tune these patterns to the user's profile.
const ADJACENT_RE = new RegExp([
  // manager/lead tier
  'operations manager','senior operations manager','operations lead','business operations','biz ?ops',
  'strategy (and|&) operations','operational excellence','continuous improvement','process improvement',
  'process manager','scrum master','agile coach','agile delivery','delivery lead','program operations',
  'product operations','chief of staff','engagement manager','onboarding (manager|lead)','customer success manager',
  'client success manager','professional services (manager|consultant)','solutions (consultant|manager)',
  'change manage','transformation (manager|lead)','portfolio manager','vendor manager','procurement manager',
  'supply chain (manager|planner|lead)','workforce (planning|manager)','capacity planning','revenue operations',
  // less-senior tier (he’ll step down for an off-direction role)
  'operations associate','operations analyst','operations specialist','operations coordinator',
  'process analyst','program coordinator','program specialist','program analyst','program associate','program administrator',
  'project specialist','project coordinator','project analyst','project administrator','project lead','project associate',
  'pmo (analyst|coordinator|lead|manager|specialist)','delivery coordinator','delivery associate',
  'implementation associate','implementation coordinator','onboarding (specialist|coordinator)',
  'associate program manager','junior program manager','associate project manager','junior project manager',
  'business operations associate','business operations analyst','customer success associate','customer success coordinator',
].map(s => '\\b' + s + '\\b').join('|'), 'i');
// Off-direction / hard-bar exclusions for the adjacent pass.
const EXCLUDE_RE = /\b(software|engineer|developer|\bswe\b|frontend|back ?end|full ?stack|devops|\bsre\b|data scientist|machine learning|\bml\b|designer|\bux\b|\bui\b|marketing|content|copywriter|social media|sales development|sales representative|sales executive|\bsdr\b|account executive|recruiter|talent acquisition|accountant|controller|\bcpa\b|tax\b|auditor|lawyer|legal counsel|attorney|nurse|clinical|physician|warehouse|driver|technician|electrician|mechanic|welder|forklift|product manager|product owner)\b/i;
// roles the user is HARD-BARRED for (cert/experience/lang) — drop
const HARDBAR_RE = /\b(p\.?\s?eng|professional engineer|geotechnical|civil engineer|structural engineer|\bcpa\b|\bcfa\b|chartered (professional )?accountant|\bj\.?d\.?\b|law degree|member of the bar|licensed attorney|\bllb\b|registered nurse|\brn\b|\bmd\b license|security clearance|secret clearance|top secret|(1[0-5]|[1-9][0-9])\+?\s*years|minimum (of )?(10|11|12|13|14|15)\s*years|at least (10|11|12|13|14|15)\s*years|bilingual \(english and french\)|french (is )?(a )?(required|must)|maîtrise du français|must be fluent in french)\b/i;

const CA_RE = /\b(canada|canadian|toronto|vancouver|montr[eé]al|calgary|edmonton|ottawa|waterloo|kitchener|mississauga|halifax|winnipeg|ontario|qu[eé]bec|british columbia|alberta|manitoba|nova scotia|\bon\b|\bbc\b|\bab\b|\bqc\b)\b/i;
const NA_REMOTE_RE = /\b(north america|remote[- ]?(na|north america|americas|canada)|americas)\b/i;
const US_PERMIT_RE = /\b(tn visa|tn status|canadian work permit|will sponsor|sponsorship (is )?(available|provided)|open to canada)\b/i;
const US_ONLY_RE = /\b(united states|u\.s\.|\busa\b|new york|san francisco|seattle|austin|boston|chicago|los angeles|denver|atlanta|remote[- ]?us|us[- ]?remote|us only)\b/i;

function slugs(name) {
  let n = name.toLowerCase().trim();
  const base = n.replace(/[^a-z0-9]+/g, '');
  const hy = n.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const noSuffix = n.replace(/\b(inc|llc|ltd|corp|technologies|technology|software|labs|systems|solutions|health|financial|communications|robotics|the)\b/g, '').trim();
  const out = new Set([
    base, hy,
    noSuffix.replace(/[^a-z0-9]+/g, ''), noSuffix.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    n.split(/\s+/)[0].replace(/[^a-z0-9]/g, ''),
    n.replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ''),
    n.replace(/\./g, '').replace(/[^a-z0-9]+/g, ''),
  ]);
  return [...out].filter(s => s.length >= 2);
}

const TIMEOUT = 8000;
async function getJSON(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0 jobscan' } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

// returns { ats, slug, jobs:[{title, location, url, text}] } or null
async function probe(slug) {
  // Greenhouse
  let d = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
  if (d && Array.isArray(d.jobs)) return { ats: 'greenhouse', slug, jobs: d.jobs.map(j => ({ title: j.title || '', location: j.location?.name || '', url: j.absolute_url || '', text: (j.content || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ') })) };
  // Lever
  d = await getJSON(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  if (Array.isArray(d)) return { ats: 'lever', slug, jobs: d.map(j => ({ title: j.text || '', location: j.categories?.location || j.country || '', url: j.hostedUrl || '', text: (j.descriptionPlain || '') + ' ' + (j.additionalPlain || '') })) };
  // Ashby
  d = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
  if (d && Array.isArray(d.jobs)) return { ats: 'ashby', slug, jobs: d.jobs.map(j => ({ title: j.title || '', location: j.location || j.address?.postalAddress?.addressRegion || '', url: j.jobUrl || '', text: (j.descriptionPlain || '') + ' ' + (j.isRemote ? 'remote ' : '') + (j.secondaryLocations || []).map(l => l.location).join(' ') })) };
  // Workable
  d = await getJSON(`https://${slug}.workable.com/spi/v3/jobs`);
  if (d && Array.isArray(d.results)) return { ats: 'workable', slug, jobs: d.results.map(j => ({ title: j.title || '', location: [j.location?.city, j.location?.country].filter(Boolean).join(', '), url: j.url || j.shortlink || '', text: (j.description || '').replace(/<[^>]+>/g, ' ') })) };
  // Recruitee
  d = await getJSON(`https://${slug}.recruitee.com/api/offers/`);
  if (d && Array.isArray(d.offers)) return { ats: 'recruitee', slug, jobs: d.offers.map(j => ({ title: j.title || '', location: [j.city, j.country_code].filter(Boolean).join(', '), url: j.careers_url || j.url || '', text: (j.description || '').replace(/<[^>]+>/g, ' ') })) };
  return null;
}

async function locate(name) {
  for (const s of slugs(name)) {
    const r = await probe(s);
    if (r) return r;   // first valid board wins
  }
  return null;
}

const FOREIGN_RE = /\b(australia|aus\b|germany|deutschland|france|french|netherlands|belgium|apac|emea|latam|dubai|\buae\b|london|\buk\b|united kingdom|england|prague|czechia|ireland|dublin|singapore|india|bengaluru|bangalore|mexico|tokyo|japan|brazil|spain|madrid|barcelona|poland|gdansk|berlin|munich|paris|amsterdam|sydney|melbourne|zurich|switzerland|portugal|lisbon|romania|philippines|manila|hong kong|korea|seoul|israel|tel aviv|elternzeit|maternity cover)\b/i;
// Gate on the LOCATION field (reliable), not the JD blob (which name-drops Canada
// in offices/remote-policy text and false-passes foreign roles).
function canadaEligible(loc, text) {
  const L = (loc || '').toLowerCase();
  const near = `${loc} ${(text || '').slice(0, 400)}`.toLowerCase();   // only the top of the JD
  if (CA_RE.test(L)) return true;                                       // location is Canada
  if (NA_REMOTE_RE.test(L)) return true;                                // location is remote-NA/Canada
  if (FOREIGN_RE.test(L)) return US_PERMIT_RE.test(near) ? true : false; // explicit foreign → drop
  if (US_ONLY_RE.test(L)) return US_PERMIT_RE.test(near) ? true : false; // US-only → drop unless CA permit
  if (/\bremote\b|anywhere/.test(L)) return NA_REMOTE_RE.test(near) || CA_RE.test(near); // bare remote → need CA/NA evidence
  return CA_RE.test(L);                                                  // blank/unknown → only if CA in location
}

function matchRoles(board) {
  const out = [];
  for (const j of board.jobs) {
    if (!TITLE_RE.test(j.title)) continue;
    if (/\bproduct manager\b/i.test(j.title)) continue;          // off-direction, not a target
    const blob = `${j.title} ${j.text}`;
    if (HARDBAR_RE.test(blob)) continue;                          // hard-barred (cert/exp/lang)
    if (!canadaEligible(j.location, j.text)) continue;
    out.push({ title: j.title, location: j.location || '(unspecified)', url: j.url, priority: PRIORITY_RE.test(j.title) });
  }
  out.sort((a, b) => (b.priority - a.priority) || a.title.localeCompare(b.title));
  return out;
}

// Broader adjacent-qualified roles (for companies with no strict target match).
function adjacentRoles(board) {
  const out = [];
  for (const j of board.jobs) {
    if (!ADJACENT_RE.test(j.title)) continue;
    if (EXCLUDE_RE.test(j.title)) continue;                       // off-direction
    const blob = `${j.title} ${j.text}`;
    if (HARDBAR_RE.test(blob)) continue;                          // hard-barred
    if (!canadaEligible(j.location, j.text)) continue;
    out.push({ title: j.title, location: j.location || '(unspecified)', url: j.url });
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

// ── existing portals ──
const portals = readFileSync('portals.yml', 'utf8');
const existing = {};
{
  const re = /- name:\s*([^\n]+)\n\s*careers_url:\s*([^\n]+)/g; let m;
  while ((m = re.exec(portals))) existing[m[1].trim().toLowerCase()] = m[2].trim();
}

const report = { reverified: [], added: [], needsHandler: [], adjacent: [], skipped: { notLocated: [], noMatch: [], usOnly: [] } };
const newYaml = [];

// concurrency pool
const queue = [...COMPANIES];
async function worker() {
  while (queue.length) {
    const name = queue.shift();
    const inPortals = existing[name.toLowerCase()] !== undefined;
    let board;
    try { board = await locate(name); } catch { board = null; }
    if (!board) { if (!inPortals) report.skipped.notLocated.push(name); else report.reverified.push({ name, note: 'in portals; board not re-located (left as-is)' }); continue; }
    const roles = matchRoles(board);
    if (!roles.length) {
      // distinguish US-only vs genuinely none
      const hadTitle = board.jobs.some(j => TITLE_RE.test(j.title) && !/product manager/i.test(j.title) && !HARDBAR_RE.test(j.title + ' ' + j.text));
      if (hadTitle) report.skipped.usOnly.push(name); else report.skipped.noMatch.push(`${name} (${board.ats})`);
      // even with no strict match, surface ADJACENT roles he's qualified for
      const adj = adjacentRoles(board);
      if (adj.length) report.adjacent.push({ name, ats: board.ats, slug: board.slug, roles: adj });
      continue;
    }
    const entry = { name, ats: board.ats, slug: board.slug, roles };
    if (board.ats === 'workable' || board.ats === 'recruitee') { report.needsHandler.push(entry); continue; }
    if (inPortals) { report.reverified.push({ name, ats: board.ats, matches: roles.length }); continue; }
    report.added.push(entry);
    const urlBase = board.ats === 'greenhouse' ? `https://job-boards.greenhouse.io/${board.slug}`
      : board.ats === 'lever' ? `https://jobs.lever.co/${board.slug}`
      : `https://jobs.ashbyhq.com/${board.slug}`;
    newYaml.push(`\n  - name: ${name}\n    careers_url: ${urlBase}\n    api_provider: ${board.ats}\n    notes: "Auto-added 2026-05-26 via ATS probe. ${roles.length} Canada-eligible target role(s)."\n    enabled: true`);
  }
}
await Promise.all(Array.from({ length: 10 }, worker));

// Only write to portals.yml when explicitly told to (--write). Default = review-only.
const WRITE = process.argv.includes('--write');
if (WRITE && newYaml.length) {
  appendFileSync('portals.yml', '\n  # -- Auto-added via ATS probe (2026-05-26) --' + newYaml.join('\n') + '\n');
  console.log(`\n✍  WROTE ${newYaml.length} new entries to portals.yml`);
} else if (newYaml.length) {
  console.log(`\n(review-only — ${newYaml.length} entries NOT written to portals.yml. Re-run with --write to add.)`);
}

const totalCandidates = [...report.added, ...report.reverified.filter(r => r.matches)].reduce((a, r) => a + (r.matches || r.roles?.length || 0), 0);
writeFileSync('output/ats-probe-report.json', JSON.stringify({ ...report, totalCandidates }, null, 2));

// CSV for review
const csvQ = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = [['company', 'ats_found', 'slug', 'matching_roles_count', 'sample_role_titles', 'canada_eligible', 'status']];
const csvAdd = (e, status) => csv.push([e.name, e.ats || '', e.slug || '', e.roles ? e.roles.length : (e.matches || 0), (e.roles || []).slice(0, 4).map(x => `${x.title} [${x.location}]`).join(' | '), 'yes', status]);
report.added.forEach(e => csvAdd(e, 'NEW (pending add)'));
report.needsHandler.forEach(e => csvAdd(e, 'NEEDS HANDLER (not added)'));
report.reverified.filter(e => e.matches).forEach(e => csvAdd(e, 'reverified (already in)'));
writeFileSync('output/probe-results.csv', csv.map(r => r.map(csvQ).join(',')).join('\n') + '\n');

console.log('\n════════ ATS PROBE COMPLETE ════════');
console.log(`(a) Reverified (already in portals):   ${report.reverified.length}`);
console.log(`(b) Newly added (GH/Lever/Ashby):      ${report.added.length}`);
console.log(`(c) Skipped — not located on any ATS:  ${report.skipped.notLocated.length}`);
console.log(`    Skipped — no matching roles:       ${report.skipped.noMatch.length}`);
console.log(`    Skipped — US-only (not CA-elig.):  ${report.skipped.usOnly.length}`);
console.log(`(d) NEEDS HANDLER (Workable/Recruitee):${report.needsHandler.length}`);
console.log(`(e) Total candidate roles found:       ${totalCandidates}`);
console.log('\nNEWLY ADDED:');
report.added.forEach(e => console.log(`  + ${e.name} [${e.ats}/${e.slug}] — ${e.roles.length} role(s): ${e.roles.slice(0,3).map(r=>r.title).join('; ')}`));
console.log('\nNEEDS HANDLER (NOT added — Workable/Recruitee):');
report.needsHandler.forEach(e => console.log(`  ⚠ ${e.name} [${e.ats}/${e.slug}] — ${e.roles.length} role(s)`));
const adjCount = report.adjacent.reduce((a, e) => a + e.roles.length, 0);
console.log(`\n(f) ADJACENT-qualified roles at no-strict-match companies: ${report.adjacent.length} companies, ${adjCount} roles`);
report.adjacent.forEach(e => console.log(`  ~ ${e.name} [${e.ats}/${e.slug}] — ${e.roles.length}: ${e.roles.slice(0,3).map(r=>r.title+' ['+r.location+']').join('; ')}`));
console.log('\nFull report → output/ats-probe-report.json');
