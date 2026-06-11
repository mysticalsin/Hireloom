#!/usr/bin/env node
/**
 * collect-pool.mjs — Build a pool of NEW, Canada-eligible, qualified roles the
 * user hasn't applied to. Probes the whole company universe (portals.yml +
 * embedded name list + extras), broad-but-qualified title net, fixed CA filter,
 * dedups against applications.md. Writes output/new-pool.json + pool CSV.
 */
import { readFileSync, writeFileSync } from 'fs';

// ── company universe ──
const NAMES = readFileSync('batch/probe-ats.mjs', 'utf8').match(/const COMPANIES = `([\s\S]*?)`/)[1].split('\n').map(s => s.trim()).filter(Boolean);
const EXTRA = ['Coursera','Squarespace','Calendly','Gusto','Toast','ServiceNow','Dayforce','Ceridian','Nuvei','Interac','Symcor','Properly','Nylas','Vretta','Wiz','Zscaler','Gitpod','Ada','Hootsuite','Vidyard','Visier','Kinaxis','OpenText','SOTI','Coveo','Q4','D2L','Thinkific','Clio','BenchSci','Wave','Wattpad','Mistplay','Knix','Mejuri','Ritual','Versapay','Tucows','Trolley','Procurify','Loopio','Jane App','Miovision','Solink','Relay','Koho','Maple','Felix','Dialogue','League','Symend','Wagepoint','Rise','Humi','Helcim','Borrowell','PolicyMe','Mogo','Shakepay','GoBolt','Attabotics','Clearpath','Sanctuary AI','Waabi','Ada Support',
  // expanded NA tech/SaaS likely on GH/Lever/Ashby with Canada roles
  'Box','Smartsheet','Coupa','Anaplan','Clari','ZoomInfo','6sense','Highspot','Seismic','Amplitude','Mixpanel','Braze','Iterable','Attentive','Sprout Social','Sprinklr','Gainsight','ChurnZero','Totango',
  'SentinelOne','Sophos','Tenable','Rapid7','Cohesity','Rubrik','Veeam','Sysdig','Lacework','Abnormal Security','Material Security','HackerOne','Bugcrowd','1Password','Tailscale',
  'Ramp','Plaid','Chime','Wise','Bill.com','Carta','Addepar','BitGo','Modern Treasury','Mercury','Brex','Affirm','Marqeta','Alloy','Unit','Column','Lithic',
  'Webflow','Contentful','Sanity','Storyblok','Builder.io','Vercel','Netlify','Render','Railway','Supabase','PlanetScale','Neon','Cockroach Labs','Timescale','SingleStore',
  'Postman','Kong','Apollo GraphQL','Hasura','WorkOS','Stytch','Clerk','Frontegg','Descope',
  'Gusto','Rippling','Deel','Remote','Oyster','Velocity Global','Justworks','TriNet','Lattice','Culture Amp','15Five','Bob','Personio','Hibob',
  'Loom','Around','Mmhmm','Grain','Fathom','Otter','Fireflies','Avoma',
  'DoorDash','Instacart','Wonolo','Faire','Flexe','Convoy','Project44','FourKites','Flexport','Shippo','EasyPost','Stord',
  'Pinterest','Reddit','Discord','Twitch','Patreon','Substack','Ghost','Beehiiv','ConvertKit','Mailchimp','Customer.io',
  'Asana','Monday.com','ClickUp','Wrike','Smartsuite','Height','Shortcut','Linear','Productboard','Aha','Pendo','Amplitude',
  'Twilio','SendGrid','Vonage','Sinch','MessageBird','Bandwidth','Telnyx',
  'Snowflake','Databricks','Confluent','Fivetran','dbt Labs','Census','Hightouch','Airbyte','Dagster','Astronomer','Monte Carlo','Atlan','Select Star',
  'Notion','Coda','Almanac','Slab','Guru','Tettra','Slite',
  'Zendesk','Intercom','Front','Gladly','Kustomer','Gorgias','Help Scout','Forethought','Ada','Ultimate',
  'Lightspeed','Shopify','Wealthsimple','Clearco','Float','Neo Financial','Koho','Nuvei','PointClickCare','Telus','FreshBooks','Plusgrade','Magnet Forensics',
  // batch 3 — more NA tech/SaaS with CA/remote roles
  'Airwallex','Tipalti','Navan','Expensify','Melio','Spendesk','Payhawk','Marqeta','Alloy',
  'Fortinet','Palo Alto Networks','Darktrace','Axonius','JupiterOne','Cybereason','Claroty','Armis','Secureframe','Sprinto','Thoropass',
  'Workiva','BlackLine','FloQast','Planful','Pigment','Mosaic','Causal',
  'Papaya Global','Multiplier','Globalization Partners','Velocity Global',
  'Freshworks','Zoho','HappyFox','Algolia','Yext','Bloomreach','Lucidworks',
  'Plivo','Akamai','Imperva','UserTesting','Maze','Dovetail','Hotjar','FullStory','LogRocket',
  'Tray.io','Make','Paragon','Aha','Secureframe','Incident.io','Rootly','FireHydrant',
  'Render','Railway','Fly.io','Baseten','Together AI','Anyscale','Predibase',
  'Weights and Biases','Comet','Arize','Glean','Hebbia','Sierra','Decagon','Cresta','Observe.AI',
  'Culture Amp','15Five','Hibob','Personio','Metaview','BrightHire','Ashby','Mural','Lucidspark',
  'Clipboard Health','Sourcegraph','Replit','Modal','Fivetran','dbt Labs','Census','Hightouch','Monte Carlo','Atlan',
  'Ada','Forethought','Sprinklr','Sprout Social','Iterable','Braze','Attentive','Customer.io','Klaviyo',
  // batch 4
  'Webflow','Contentful','Sanity','Storyblok','Builder.io','Strapi','Hygraph','Kontent',
  'Postman','Kong','Apollo GraphQL','Hasura','WorkOS','Stytch','Clerk','Frontegg','Descope','Auth0','FusionAuth',
  'Supabase','Neon','PlanetScale','Timescale','SingleStore','Yugabyte','EdgeDB','Dgraph','Weaviate','Pinecone','Qdrant','Chroma','Zilliz',
  'Temporal','Inngest','Trigger.dev','Hookdeck','Svix','Knock','Courier','Resend','Loops','Postmark',
  'Vercel','Netlify','Render','Railway','Fly.io','Northflank','Porter','Coherence','Qovery',
  'Linear','Height','Shortcut','Plane','Huly','Tracker',
  'Retool','Appsmith','Budibase','ToolJet','Superblocks','Internal',
  'Census','Hightouch','RudderStack','Snowplow','Mixpanel','Heap','PostHog','June','Statsig','LaunchDarkly','Flagsmith','Split',
  'Vena Solutions','Top Hat','ApplyBoard','Article','ecobee','Hydrostor','Trexo Robotics','Symend','SADA','Tehama','Wysdom AI','Trufla','Hypercare','Pillway','Looka','HouseSigma','Goodlawyer','Granify','Optable','Tealbook','Konrad','Apply Digital','Rise People','WorkJam'];
let HARVEST = [];
try { HARVEST = JSON.parse(readFileSync('output/indeed-companies.json', 'utf8')); } catch {}
const allNames = [...new Set([...NAMES, ...EXTRA, ...HARVEST])];

// ── portals.yml known boards (slug+ats from careers_url) ──
const portals = readFileSync('portals.yml', 'utf8');
const known = {};
{
  const re = /- name:\s*([^\n]+)\n\s*careers_url:\s*([^\n]+)/g; let m;
  while ((m = re.exec(portals))) {
    const name = m[1].trim(); const url = m[2].trim();
    let ats, slug;
    let g;
    if ((g = url.match(/greenhouse\.io\/([^/?#\s]+)/))) { ats = 'greenhouse'; slug = g[1]; }
    else if ((g = url.match(/lever\.co\/([^/?#\s]+)/))) { ats = 'lever'; slug = g[1]; }
    else if ((g = url.match(/ashbyhq\.com\/([^/?#\s]+)/))) { ats = 'ashby'; slug = g[1]; }
    else if ((g = url.match(/([a-z0-9-]+)\.workable\.com/))) { ats = 'workable'; slug = g[1]; }
    else if ((g = url.match(/([a-z0-9-]+)\.recruitee\.com/))) { ats = 'recruitee'; slug = g[1]; }
    else if ((g = url.match(/smartrecruiters\.com\/([^/?#\s]+)/))) { ats = 'smartrecruiters'; slug = g[1]; }
    if (ats) known[name.toLowerCase()] = { ats, slug };
  }
}

// ── filters ──
const STRICT_RE = /\b(project coordinator|associate project manager|junior project manager|senior project manager|technical project manager|project manager|implementation (manager|specialist|consultant|lead)|delivery manager|senior program manager|technical program manager|program manager|senior business analyst|business analyst)\b/i;
const PRIORITY_RE = /\b(project manager|project coordinator)\b/i;
const ADJACENT_RE = new RegExp([
  'operations manager','senior operations manager','operations lead','business operations','biz ?ops','strategy (and|&) operations',
  'operational excellence','continuous improvement','process improvement','process manager','process analyst','scrum master',
  'agile coach','agile delivery','delivery lead','program operations','product operations','chief of staff','engagement manager',
  'onboarding (manager|lead|specialist|coordinator)','customer success manager','client success manager','customer success (associate|coordinator|specialist)',
  'professional services (manager|consultant)','solutions (consultant|manager)','change manage','transformation (manager|lead|specialist)',
  'portfolio manager','vendor manager','procurement manager','supply chain (manager|planner|lead|analyst)','workforce (planning|manager)',
  'capacity planning','revenue operations','sales operations','operations associate','operations analyst','operations specialist','operations coordinator',
  'program coordinator','program specialist','program analyst','program associate','program administrator','project specialist','project analyst',
  'project administrator','project lead','project associate','pmo (analyst|coordinator|lead|manager|specialist)','delivery coordinator','delivery associate',
  'implementation associate','implementation coordinator','associate program manager','junior program manager','business operations (associate|analyst)',
  'category manager','planner','expeditor','service delivery','quality (manager|coordinator|analyst)',
  // broadened (qualified step-down / ops-adjacent)
  'customer operations','support operations','partner operations','partnerships (manager|lead)','partner manager',
  'alliance manager','renewals manager','deal desk','gtm operations','go.?to.?market operations','marketplace operations',
  'trust (and|&) safety','community operations','people operations (coordinator|specialist|analyst|manager)','workplace (manager|coordinator|specialist)',
  'data operations','content operations','editorial operations','logistics (manager|coordinator|analyst)','fulfillment (manager|coordinator)',
  'inventory (manager|analyst|planner)','demand planning','launch (manager|coordinator)','deployment (manager|coordinator)',
  'integration (manager|coordinator)','enablement (manager|specialist)','operations program','client services','account manager',
  // broad catch-alls in the candidate's core domains (EXCLUDE_RE still drops eng/sales-rep/marketing/design/etc.)
  'operations','coordinator','program management','project management',
].map(s => '\\b' + s + '\\b').join('|'), 'i');
const EXCLUDE_RE = /\b(software|engineer|developer|\bswe\b|frontend|back ?end|full ?stack|devops|\bsre\b|data scientist|machine learning|\bml\b|designer|\bux\b|\bui\b|marketing|content|copywriter|social media|sales development|sales representative|sales executive|\bsdr\b|account executive|recruiter|talent acquisition|accountant|controller|\bcpa\b|tax\b|auditor|lawyer|legal counsel|attorney|nurse|clinical|physician|warehouse|driver|technician|electrician|mechanic|welder|forklift|product manager|product owner|product designer)\b/i;
const CONSTRUCTION_RE = /\b(construction|mechanical|electrical|hvac|civil|structural|geotechnical|estimat(or|ing)|millwright|trades?|superintendent|concrete|plumbing|roofing|glazing|drywall|framing|demolition|\bepc\b|commissioning|piping|welding|scaffold|carpentry|masonry|landscaping|renovation|residential|home ?builder|contracting|contractor|paving|excavation|restoration|fabrication|building envelope|capital project|millwork|formwork|rebar|tower crane|low voltage|fire protection|builders|architectural|horticultur|forestry|tool ?(&|and) ?die|machine shop|manufacturing|industrial|foundry|\bsteel\b|sheet metal|iron and metal|turner ?(&|and) ?townsend|mining|oilfield|petroleum|marine|aerospace)\b/i;
const HARDBAR_RE = /\b(p\.?\s?eng|professional engineer|geotechnical|civil engineer|structural engineer|\bcpa\b|\bcfa\b|chartered (professional )?accountant|\bj\.?d\.?\b|law degree|member of the bar|licensed attorney|\bllb\b|registered nurse|\brn\b|security clearance|secret clearance|top secret|(1[0-5]|[2-9][0-9])\+?\s*years|minimum (of )?(10|11|12|13|14|15)\s*years|at least (10|11|12|13|14|15)\s*years|bilingual \(english (and|\/|&) french\)|french[- ]speaking|french (is )?(a )?(required|must|essential)|maîtrise du français|must be fluent in french|fully bilingual)\b/i;

const CA_RE = /\b(canada|canadian|toronto|vancouver|montr[eé]al|calgary|edmonton|ottawa|waterloo|kitchener|mississauga|halifax|winnipeg|ontario|qu[eé]bec|british columbia|alberta|manitoba|nova scotia|saskatchewan)\b/i;
const NA_REMOTE_RE = /\b(north america|remote[\s,-]*(na|north america|americas|canada)|americas)\b/i;
const US_REMOTE_RE = /\b(remote[\s,(-]*u\.?s\.?\b|u\.?s\.?[\s-]*remote|remote[\s,(-]*united states)\b/i;
const US_PERMIT_RE = /\b(tn visa|tn status|canadian work permit|will sponsor|sponsorship (is )?(available|provided)|open to canada)\b/i;
const FOREIGN_RE = /\b(australia|germany|deutschland|france|netherlands|belgium|apac|emea|latam|dubai|\buae\b|london|\buk\b|united kingdom|england|prague|czechia|ireland|dublin|singapore|india|bengaluru|bangalore|mexico|tokyo|japan|brazil|spain|madrid|poland|berlin|munich|paris|amsterdam|sydney|melbourne|zurich|switzerland|portugal|lisbon|romania|philippines|manila|hong kong|korea|seoul|israel|tel aviv)\b/i;

function canadaEligible(loc, text) {
  const L = (loc || '').toLowerCase().trim();
  const full = (text || '').toLowerCase();
  const near = `${loc} ${full.slice(0, 300)}`;
  // bare "remote"/blank location → genuinely ambiguous; include only if the JD
  // explicitly names Canada / North America eligibility (still drops US-only).
  const jdSaysCA = CA_RE.test(full) || NA_REMOTE_RE.test(full);
  if (!L) return jdSaysCA;
  if (US_REMOTE_RE.test(L) && !CA_RE.test(L) && !NA_REMOTE_RE.test(L)) return US_PERMIT_RE.test(near); // "Remote - US" → drop
  if (CA_RE.test(L)) return true;
  if (NA_REMOTE_RE.test(L)) return true;
  if (FOREIGN_RE.test(L)) return US_PERMIT_RE.test(near);
  if (/\b(united states|u\.s\.|\busa\b|new york|san francisco|seattle|austin|boston|chicago|denver|atlanta|los angeles)\b/i.test(L)) return US_PERMIT_RE.test(near);
  if (/\bremote\b|anywhere|distributed|global/.test(L)) return jdSaysCA;   // remote-X → need explicit CA/NA in JD
  return CA_RE.test(L);
}

function archetype(t) {
  if (/business (systems )?analyst|systems analyst/i.test(t)) return 'BIZ_ANALYST';
  if (/implementation|onboarding|solutions (consultant|manager)|professional services/i.test(t)) return 'IMPL_DEL';
  if (/customer success|client success/i.test(t)) return 'IT_SVC';
  if (/project|program|delivery|pmo|scrum|agile|portfolio/i.test(t)) return 'PROG_PM';
  return 'GEN_PM_OPS'; // operations / strategy-ops / process / revops / procurement / supply chain / chief of staff
}

// ── probing ──
function slugs(name) {
  const n = name.toLowerCase().trim();
  const noSuffix = n.replace(/\b(inc|llc|ltd|corp|technologies|technology|software|labs|systems|solutions|health|financial|communications|robotics|the)\b/g, '').trim();
  return [...new Set([
    n.replace(/[^a-z0-9]+/g, ''), n.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    noSuffix.replace(/[^a-z0-9]+/g, ''), n.split(/\s+/)[0].replace(/[^a-z0-9]/g, ''),
    n.replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ''), n.replace(/\./g, '').replace(/[^a-z0-9]+/g, ''),
  ])].filter(s => s.length >= 2);
}
const TIMEOUT = 9000;
async function getJSON(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT);
  try { const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0' } }); return r.ok ? await r.json() : null; }
  catch { return null; } finally { clearTimeout(t); }
}
async function fetchBoard(ats, slug) {
  if (ats === 'greenhouse') { const d = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`); return d?.jobs?.map(j => ({ title: j.title || '', location: j.location?.name || '', url: j.absolute_url || '', text: (j.content || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ') })); }
  if (ats === 'lever') { const d = await getJSON(`https://api.lever.co/v0/postings/${slug}?mode=json`); return Array.isArray(d) ? d.map(j => ({ title: j.text || '', location: j.categories?.location || j.country || '', url: j.hostedUrl || '', text: (j.descriptionPlain || '') + ' ' + (j.additionalPlain || '') })) : null; }
  if (ats === 'ashby') { const d = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`); return d?.jobs?.map(j => ({ title: j.title || '', location: j.location || '', url: j.jobUrl || '', text: (j.descriptionPlain || '') + (j.isRemote ? ' remote' : '') + ' ' + (j.secondaryLocations || []).map(l => l.location).join(' ') })); }
  if (ats === 'workable') {
    try {
      const r = await fetch(`https://apply.workable.com/api/v3/accounts/${slug}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, body: '{}', signal: AbortSignal.timeout(TIMEOUT) });
      if (!r.ok) return null;
      const d = await r.json();
      return Array.isArray(d.results) ? d.results.map(j => ({ title: j.title || '', location: [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', ') + (j.telecommuting || j.remote ? ' remote' : ''), url: `https://apply.workable.com/${slug}/j/${j.shortcode}/`, text: (j.description || '').replace(/<[^>]+>/g, ' ') })) : null;
    } catch { return null; }
  }
  if (ats === 'recruitee') { const d = await getJSON(`https://${slug}.recruitee.com/api/offers/`); return Array.isArray(d?.offers) ? d.offers.map(j => ({ title: j.title || '', location: [j.city, j.country_code].filter(Boolean).join(', ') + (/remote/i.test(j.remote||'')||j.remote===true?' remote':''), url: j.careers_url || j.careers_apply_url || j.url || '', text: (j.description || '').replace(/<[^>]+>/g, ' ') })) : null; }
  if (ats === 'smartrecruiters') { const d = await getJSON(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`); return Array.isArray(d?.content) ? d.content.map(j => ({ title: j.name || '', location: [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', ') + (j.location?.remote ? ' remote' : ''), url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`, text: '' })) : null; }
  return null;
}
async function locate(name) {
  const k = known[name.toLowerCase()];
  if (k) { const jobs = await fetchBoard(k.ats, k.slug); if (jobs) return { ats: k.ats, slug: k.slug, jobs }; }
  for (const s of slugs(name)) for (const ats of ['greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'smartrecruiters']) { const jobs = await fetchBoard(ats, s); if (jobs && jobs.length) return { ats, slug: s, jobs }; }
  return null;
}

// ── dedup set (already applied/evaluated) ──
const apps = readFileSync('data/applications.md', 'utf8');
// keep seniority/level words so distinct-level roles aren't falsely deduped as "already applied"
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const appliedKeys = new Set();
for (const m of apps.matchAll(/^\|\s*\d+\s*\|[^|]*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm)) appliedKeys.add(norm(m[1]) + '::' + norm(m[2]));
// also exclude roles already in the packaged pool (so this run finds ADDITIONAL roles)
try { JSON.parse(readFileSync('output/pool-apply-order.json', 'utf8')).rows.forEach(r => appliedKeys.add(norm(r.company) + '::' + norm(r.title))); } catch {}
const appliedCompanies = new Set([...appliedKeys].map(k => k.split('::')[0]));

// ── run ──
const pool = []; const seen = new Set();
const queue = [...allNames];
let probed = 0, located = 0;
async function worker() {
  while (queue.length) {
    const name = queue.shift(); probed++;
    let board; try { board = await locate(name); } catch { board = null; }
    if (!board) continue; located++;
    for (const j of board.jobs) {
      const strict = STRICT_RE.test(j.title) && !/product manager/i.test(j.title);
      const adj = !strict && ADJACENT_RE.test(j.title);
      if (!strict && !adj) continue;
      if (EXCLUDE_RE.test(j.title)) continue;
      if (CONSTRUCTION_RE.test(j.title) || CONSTRUCTION_RE.test(name)) continue;  // hard-bar construction/trades
      const blob = `${j.title} ${j.text}`;
      if (HARDBAR_RE.test(blob)) continue;
      if (!canadaEligible(j.location, j.text)) continue;
      const key = norm(name) + '::' + norm(j.title);
      if (appliedKeys.has(key) || seen.has(key)) continue;     // already applied / dup
      seen.add(key);
      pool.push({ company: name, title: j.title, location: j.location || '(remote/unspecified)', url: j.url, ats: board.ats,
        tier: strict ? (PRIORITY_RE.test(j.title) ? 0 : 1) : 2, archetype: archetype(j.title), jd: (j.text || '').replace(/\s+/g, ' ').trim().slice(0, 2500) });
    }
  }
}
await Promise.all(Array.from({ length: 12 }, worker));

pool.sort((a, b) => a.tier - b.tier || a.company.localeCompare(b.company));
pool.forEach((p, i) => p.n = i + 1);
writeFileSync('output/new-pool.json', JSON.stringify(pool, null, 2));
const csvQ = s => { s = String(s ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
writeFileSync('output/new-pool.csv', [['n','company','title','location','ats','tier','archetype','url'].join(','), ...pool.map(p => [p.n, p.company, p.title, p.location, p.ats, ['PM/PC','strict','adjacent'][p.tier], p.archetype, p.url].map(csvQ).join(','))].join('\n') + '\n');

const byTier = [0, 1, 2].map(t => pool.filter(p => p.tier === t).length);
console.log(`\n════ POOL COLLECTED ════`);
console.log(`Companies probed: ${probed} | boards located: ${located}`);
console.log(`NEW qualified CA-eligible roles: ${pool.length}`);
console.log(`  PM/PC (tier0): ${byTier[0]} | other strict (tier1): ${byTier[1]} | adjacent (tier2): ${byTier[2]}`);
console.log(`Goal 150: ${pool.length >= 150 ? '✅ MET' : '⚠ SHORT by ' + (150 - pool.length) + ' — expand company list'}`);
console.log(`→ output/new-pool.json + output/new-pool.csv`);
