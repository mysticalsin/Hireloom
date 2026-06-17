/**
 * autoapply-core.mjs — Shared, no-LLM answer resolver.
 *
 * Single source of truth for how application-form fields get answered, used by
 * BOTH the CLI (auto-apply.mjs) and the dashboard autopilot (apps/web/
 * server.mjs) so the two paths behave identically.
 *
 * Resolution order (per field): identity (mergeIdentity) → profile post-processor
 * (applyProfileAnswers: EEO/education/work-auth/logistics + decline-scrubbing) →
 * per-role package answers → global Q&A bank (qa-bank.json) → role-pitch fallback
 * for genuine motivational essays. No API keys, no LLM.
 *
 * Usage:
 *   import { createResolver, extractFieldsInPage } from './autoapply-core.mjs';
 *   const R = createResolver({ projectDir });
 *   const fields  = await page.evaluate(extractFieldsInPage);
 *   let answers   = R.resolveAnswers(fields, pkg);
 *   answers       = R.mergeIdentity(answers, fields);
 *   R.applyProfileAnswers(answers, fields);
 *   const review  = R.validateApplication(answers, fields);
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

// ─── Shared helpers (pure) ─────────────────────────────────────────────────────

export const DECLINE_RE = /prefer not|decline|don'?t wish|do not wish|rather not|not to say|wish not to/i;
export const isDecline = (v) => DECLINE_RE.test(String(v || ''));
export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// If a "(Technical)" sibling of the given PDF exists, prefer it. Technical
// variants are only built for technical-archetype roles, so existence of the
// sibling means this role wants the technical CV/cover.
export function preferTechnical(p) {
  if (!p || /\(technical\)/i.test(p)) return p;
  const tech = p.replace(/\.pdf$/i, ' (Technical).pdf');
  try { if (tech !== p && existsSync(tech)) return tech; } catch {}
  return p;
}

// Pick the listed option that best matches a desired value (exact → substring →
// token-overlap). Returns null when nothing plausibly matches.
export function bestOption(desired, options) {
  const d = norm(desired);
  if (!d || !options?.length) return null;
  for (const o of options) if (norm(o) === d) return o;
  for (const o of options) { const no = norm(o); if (no && (no.includes(d) || d.includes(no))) return o; }
  const dt = new Set(d.split(' ').filter(Boolean));
  let best = null, bestScore = 0;
  for (const o of options) {
    const overlap = norm(o).split(' ').filter(t => dt.has(t)).length;
    if (overlap > bestScore) { bestScore = overlap; best = o; }
  }
  return bestScore > 0 ? best : null;
}

// Decide whether to TICK one demographic checkbox, using ONLY the saved EEO self-ID
// (`self` = the eeo_voluntary block). Truthful, never guessed — the Samsara-safe path:
// returns true only for an option the candidate genuinely affirms. "None of the above",
// "Prefer not to say", and any unrecognised option are always false (left for the user).
export function checkboxSelfId(self, question, optionLabel) {
  self = self || {};
  const q = norm(question), o = norm(optionLabel);
  if (!o || /prefer not|decline|wish not|do not wish/.test(o)) return false;
  const yes = (v) => /^(yes|true|y)\b/i.test(String(v || '').trim());
  // Race / ethnicity multi-select → only the affirmative race option (MENA synonyms).
  if (/race|ethnic/.test(q)) {
    if (/none of the above/.test(o)) return false;
    const wants = [self.race_ethnicity, 'middle east', 'middle eastern', 'north african', 'mena']
      .filter(Boolean).map(norm);
    return wants.some(w => w && (o.includes(w) || w.includes(o)));
  }
  // Gender-identity multi-select → only the candidate's saved gender, matched EXACTLY so
  // "Man" never spills into "Masculine-of-centre"/"Non-binary"; never auto-tick anything else.
  if (/gender/.test(q)) {
    const g = norm(self.gender);
    const want = (g === 'male' || g === 'man') ? 'man'
               : (g === 'female' || g === 'woman') ? 'woman' : g;
    return !!want && o === want;
  }
  // "Which communities/groups do you belong to / identify with?" → only true self-ID.
  if (/communit|belong to|identif|affinity|groups do you/.test(q)) {
    if (/none of the above/.test(o)) return false;          // he affirms Parent → never "none"
    if (/parent|guardian|caregiver/.test(o))   return yes(self.parent);
    if (/neurodiver/.test(o))                  return yes(self.neurodiverse);
    if (/refugee|immigrant|newcomer/.test(o))  return yes(self.immigrant_or_refugee);
    if (/disab/.test(o))                       return false;   // disability_status = "No, ..."
    if (/veteran/.test(o))                     return false;
    if (/lgbt|2slgbt|queer|trans|gender diverse|two.?spirit/.test(o)) return false;
    return false;                                            // unknown community → never auto-tick
  }
  return false;                                             // not a self-ID checkbox group we model
}

export function detectAts(url) {
  if (!url) return 'unknown';
  if (/greenhouse\.io/i.test(url))           return 'greenhouse';
  if (/ashbyhq\.com/i.test(url))             return 'ashby';
  if (/lever\.co/i.test(url))                return 'lever';
  if (/workday\.com|workdayjobs/i.test(url)) return 'workday';
  if (/smartrecruiters/i.test(url))          return 'smartrecruiters';
  if (/workable\.com/i.test(url))            return 'workable';
  if (/recruitee\.com/i.test(url))           return 'recruitee';
  return 'generic';
}

// In-page field extractor. Pass directly to page.evaluate(extractFieldsInPage)
// so both the CLI and dashboard read forms identically. Returns
// [{ id, name, type, label, options, required }].
export function extractFieldsInPage() {
  const fields = [];
  const seen = new Set();
  const findLabel = (el) => {
    if (el.id) {
      const lbl = document.querySelector(`label[for="${el.id}"]`);
      if (lbl) return lbl.textContent.replace(/\s+/g, ' ').trim();
    }
    const parent = el.closest('[class*="field"], [class*="question"], [class*="input"], li, .field-row, fieldset');
    if (parent) {
      const lbl = parent.querySelector('label, legend');
      if (lbl) return lbl.textContent.replace(/\s+/g, ' ').trim();
    }
    // Lever / some Greenhouse forms put the question text in a <div> (not a <label>),
    // a SIBLING of the field wrapper inside the OUTER question container — so the checks
    // above return "" and the field never classifies (work-auth/sponsorship then get
    // LLM-guessed, e.g. sponsorship → "Yes"). Climb to that container and read the first
    // label/title-classed node that doesn't contain the field. Only runs as a last resort,
    // so it can only ADD a label where there was none.
    const qc = el.closest('li, fieldset, [class*="question"], [class*="field-row"]');
    if (qc) {
      const hint = qc.querySelector('label, legend, [class*="label"], [class*="title"]');
      if (hint && !hint.contains(el)) {
        const t = hint.textContent.replace(/\s+/g, ' ').trim();
        if (t) return t;
      }
    }
    // Stacked custom forms (e.g. Gem / jobs.gem.com) give inputs no id/name/for-link and
    // render each caption as a plain <div>/<span> ABOVE the input wrapper — so every
    // branch above returns "", and the deterministic fill then maps values one field off
    // (first name ← full name, last name ← email, …). As a last resort before placeholder,
    // take the nearest element with SHORT, caption-like text that PRECEDES this input in
    // document order (previous siblings, climbing a few ancestors). Prefer a real
    // <label>/<legend>, else accept short non-control text. Runs ONLY when nothing above
    // matched, so it can solely ADD a label where there was none.
    let cur = el;
    for (let up = 0; up < 5 && cur; up++) {
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.querySelector && !sib.querySelector('input, textarea, select, button')) {
          const node = (sib.tagName === 'LABEL' || sib.tagName === 'LEGEND') ? sib
                     : (sib.querySelector('label, legend') || sib);
          const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
          if (t && t.length <= 80) return t;
        }
        sib = sib.previousElementSibling;
      }
      cur = cur.parentElement;
    }
    return el.placeholder || el.getAttribute('aria-label') || '';
  };
  const elements = document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]), textarea, select'
  );
  for (const el of elements) {
    const id   = el.id || el.name || `field_${fields.length}`;
    const name = el.name || el.id || '';
    // Never treat anti-bot fields as fillable — the LLM was dumping essay text
    // into hidden g-recaptcha-response/h-captcha-response inputs (harmless but
    // wasteful). Excluding here fixes BOTH the LLM scan and the resolver.
    if (/recaptcha|captcha|hcaptcha|turnstile|honeypot|\bnonce\b/i.test(`${id} ${name}`)) continue;
    if (seen.has(id + name)) continue;
    seen.add(id + name);
    const type = el.tagName === 'SELECT' ? 'select'
      : el.tagName === 'TEXTAREA' ? 'textarea'
      : (el.type || 'text').toLowerCase();
    const options = type === 'select'
      ? Array.from(el.options).map(o => o.text.trim()).filter(t => t && !/^(--|select|choose|pick)/i.test(t))
      : type === 'radio'
      ? Array.from(document.querySelectorAll(`[name="${el.name}"]`)).map(r => r.value)
      : [];
    const hlfid = `f${fields.length}`;            // stable per-scan locator handle
    try { el.setAttribute('data-hl-fid', hlfid); } catch {}
    fields.push({
      id, name, type, hlfid,
      label: findLabel(el),
      options,
      required: el.required || el.getAttribute('aria-required') === 'true',
    });
  }
  return fields;
}

// ─── Profile loader (regex-based, mirrors dashboard loadProfile) ───────────────

export function loadCandidateIdentity(profileFile) {
  if (!existsSync(profileFile)) {
    throw new Error(`profile not found at ${profileFile}. Copy config/profile.example.yml and fill in your details.`);
  }
  const yml = readFileSync(profileFile, 'utf8');
  const candidateBlock = yml.match(/^candidate:\s*\n([\s\S]*?)(?=^\S|\Z)/m);
  const scope = candidateBlock ? candidateBlock[1] : yml;
  const get = (key) => {
    const m = scope.match(new RegExp(`^\\s+${key}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm'));
    return m ? m[1].trim() : '';
  };
  const fullName = get('full_name');
  const email    = get('email');
  const phone    = get('phone');
  const location = get('location');
  const linkedinRaw = get('linkedin');
  const linkedin = linkedinRaw && !/^https?:\/\//i.test(linkedinRaw)
    ? `https://${linkedinRaw.replace(/^\/+/, '')}` : linkedinRaw;
  const [firstName, ...rest] = fullName.split(/\s+/);
  const lastName = rest.join(' ');
  const locParts = location.split(',').map(s => s.trim()).filter(Boolean);

  const getBlock = (name) => {
    const m = yml.match(new RegExp(`^${name}:\\s*\\n([\\s\\S]*?)(?=^\\S|\\Z)`, 'm'));
    if (!m) return {};
    const out = {};
    for (const raw of m[1].split('\n')) {
      const line = raw.replace(/\s+#.*$/, '');
      const kv = line.match(/^\s+([a-z0-9_]+):\s*"?([^"\n]*?)"?\s*$/i);
      if (kv && kv[2]) out[kv[1]] = kv[2].trim();
    }
    return out;
  };

  return {
    firstName: firstName || '', lastName: lastName || '',
    email, phone, linkedin, location,
    city: locParts[0] || '', country: locParts[locParts.length - 1] || '',
    education:  getBlock('education'),
    eeo:        getBlock('eeo_voluntary'),
    workAuth:   getBlock('work_authorization'),
    appAnswers: getBlock('application_answers'),
  };
}

function loadSalaryFallback(profileFile) {
  const yml = existsSync(profileFile) ? readFileSync(profileFile, 'utf8') : '';
  const block = yml.match(/^compensation:\s*\n([\s\S]*?)(?=^\S|\Z)/m)?.[1] || '';
  const range = block.match(/target_range:\s*"?([^"\n#]+)/)?.[1]?.trim();
  const cur   = block.match(/currency:\s*"?([^"\n#]+)/)?.[1]?.trim();
  return range ? `${range}${cur && !range.includes(cur) ? ' ' + cur : ''}`.trim() : 'Competitive / market rate';
}

// ─── Resolver factory ───────────────────────────────────────────────────────────
// Returns the full answer-resolution API, bound to one project's profile + bank.

export function createResolver({ projectDir = process.cwd(), profileFile, autoapplyDir } = {}) {
  profileFile  = profileFile  || join(projectDir, 'config', 'profile.yml');
  autoapplyDir = autoapplyDir || join(projectDir, 'output', 'autoapply');

  const CANDIDATE = loadCandidateIdentity(profileFile);
  const SALARY_FALLBACK = loadSalaryFallback(profileFile);
  let QA_BANK = [];
  try {
    const bf = join(autoapplyDir, 'qa-bank.json');
    if (existsSync(bf)) QA_BANK = JSON.parse(readFileSync(bf, 'utf8')).entries || [];
  } catch { /* bank optional */ }

  const fillPlaceholders = (answer, pkg) => String(answer)
    .replace(/\{company\}/g, pkg.company || 'your company')
    .replace(/\{role\}/g, pkg.role || 'this role')
    .replace(/\{salary\}/g, pkg.salary || SALARY_FALLBACK)
    .replace(/\{firstName\}/g, CANDIDATE.firstName);

  const matchBank = (label) => {
    const t = ` ${norm(label)} `;
    let best = null, bestScore = 0;
    for (const e of QA_BANK) {
      if (e.must && !e.must.every(k => t.includes(` ${norm(k)} `) || t.includes(norm(k)))) continue;
      const kws = [...(e.must || []), ...(e.any || [])];
      const score = kws.filter(k => t.includes(norm(k))).length;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best && bestScore > 0 ? best.answer : null;
  };

  const matchPackageAnswer = (label, pkg) => {
    if (!pkg.answers) return null;
    const t = norm(label);
    if (!t) return null;
    for (const [key, val] of Object.entries(pkg.answers)) {
      const k = norm(key);
      if (k && (t.includes(k) || k.includes(t))) return val;
    }
    return null;
  };

  const classifyField = (field) => {
    const t = norm(`${field.label} ${field.id} ${field.name}`);
    const e = CANDIDATE.eeo, w = CANDIDATE.workAuth, a = CANDIDATE.appAnswers, ed = CANDIDATE.education;
    if (/sponsor/.test(t))                                        return { kind: 'demographic', desired: w.require_sponsorship };
    if (/authoriz|legally|eligible to work|right to work|work permit/.test(t)) {
      // US-specific work-authorization question → NOT authorized (Canadian citizen,
      // no US status). Canada/generic question → Yes. Never claim US work authorization.
      if (/\bus\b|united states|\bamerica/.test(t) && !/canada/.test(t)) return { kind: 'demographic', desired: w.authorized_us || 'No' };
      return { kind: 'demographic', desired: w.legally_authorized_to_work };
    }
    // Citizenship / immigration-status questions — e.g. Ashby's "What is your current
    // status in Canada?" radio (Canadian Citizen / PR / Open|Closed Work Permit / Would
    // need sponsorship), or a plain "Citizenship" / "Nationality" field. The truthful
    // answer comes from work_permit_type ("Canadian Citizen"); bestOption picks the
    // offered option that matches. On a US-only status form there is no Canadian-Citizen
    // option → no match → left blank (never claims a US status he does not hold).
    if (/status in canada|work status|immigration status|citizenship status|residenc[ey] status|\bcitizenship\b|\bnationality\b|are you (a |an )?(canadian )?citizen/.test(t))
      return { kind: 'demographic', desired: w.work_permit_type || a.citizenship, fallbacks: [a.citizenship, a.nationality, 'Canadian'].filter(Boolean) };
    if (/hispanic|latino|latinx/.test(t))                         return { kind: 'demographic', desired: e.hispanic_latino };
    if (/race|ethnic/.test(t))                                    return { kind: 'demographic', desired: e.race_ethnicity, fallbacks: ['Middle East', 'North African', e.race_ethnicity_fallback, e.race_ethnicity_fallback2].filter(Boolean) };
    if (/transgender/.test(t))                                    return { kind: 'demographic', desired: e.transgender };
    if (/orientation/.test(t))                                    return { kind: 'demographic', desired: e.sexual_orientation };
    if (/pronoun/.test(t))                                        return { kind: 'demographic', desired: e.pronouns };
    if (/gender|\bsex\b/.test(t)) {
      // Modern Greenhouse/Ashby gender lists use "Man"/"Woman", not "Male"/"Female".
      const g = norm(e.gender);
      const syn = g === 'male' ? ['Man'] : g === 'female' ? ['Woman'] : [];
      return { kind: 'demographic', desired: e.gender, fallbacks: syn };
    }
    if (/veteran/.test(t))                                        return { kind: 'demographic', desired: e.veteran_status, fallbacks: ['No', 'I am not a veteran', 'Not a veteran'] };
    if (/disab/.test(t))                                          return { kind: 'demographic', desired: e.disability_status };
    if (/18 years|over 18|at least 18|are you 18|\bage\b/.test(t))return { kind: 'logistics', desired: a.over_18 };
    if (/relocat/.test(t))                                        return { kind: 'logistics', desired: a.willing_to_relocate };
    if (/notice/.test(t))                                         return { kind: 'logistics', desired: a.notice_period };
    if (/start date|available to start|earliest|availability/.test(t)) return { kind: 'logistics', desired: a.earliest_start_date };
    if (/consent|agree to.*background|background check|background screen|background investigation/.test(t)) return { kind: 'logistics', desired: a.background_check_consent };
    if (/criminal|convict|felony/.test(t))                        return { kind: 'logistics', desired: a.criminal_record };
    // Location fields. Check CITY / "currently located" / "city and country"
    // FIRST so a combined field gets the full "Toronto, ON, Canada", not just
    // "Canada". A standalone Country field (no city) gets the country only.
    // Excludes work-auth phrasings ("authorized to work in the country", sponsorship).
    if (/\bcity\b|located in|currently (located|based|residing)|where (are|do) you (located|live|reside)|^location|location \(/.test(t) && !/relocat/.test(t)) return { kind: 'logistics', desired: CANDIDATE.location };
    if (/\bcountry\b/.test(t) && !/\bcity\b|located|which countr|are you eligible|legally|authoriz|sponsor|work in the country|reside/.test(t)) return { kind: 'logistics', desired: CANDIDATE.country };
    const eduPerf = /perform|result|\bgrade\b|\bgpa\b|\bmarks\b|\bscore\b|when (was|will)|what date|how did you/.test(t);
    const highSchool = /high school|secondary school/.test(t);
    if (!eduPerf && !highSchool) {
      if (/discipline|major|field of study|concentration/.test(t)) return { kind: 'education', desired: ed.discipline };
      if (/degree/.test(t))                                        return { kind: 'education', desired: ed.degree };
      if (/\bschool\b|university|college|institution/.test(t))     return { kind: 'education', desired: ed.school };
    }
    return null;
  };

  // Identity fields by LABEL (not just exact id/name). Ashby uses a single "Name"
  // field with id "_systemfield_name", email "_systemfield_email", etc., so the
  // exact-key table in mergeIdentity misses them and they fall through to the LLM
  // (which then blanks them). This resolves name/email/phone/linkedin from the
  // visible label, type-guarded to text-ish inputs so it never fills a select.
  const IDL = {
    email: /\bemail\b|e mail/, linkedin: /linkedin/,
    phone: /\bphone\b|mobile|telephone|\bcell\b|\btel\b/,
    first: /first name|given name|forename/, last: /last name|surname|family name/,
    full: /full name|legal name|^name$|\byour name\b|\bname\b/,
    location: /^location\b|current (city|location)|where (are|do) you (based|located|residing|reside|live)|city.*(province|state)|town\/city/,
  };
  const TEXTISH = new Set(['text', 'email', 'tel', 'search', '', undefined]);
  const identityValueFor = (f) => {
    if (!TEXTISH.has(f.type)) return '';
    const t = norm(`${f.label} ${f.id} ${f.name}`);
    if (IDL.email.test(t))    return CANDIDATE.email;
    if (IDL.linkedin.test(t)) return CANDIDATE.linkedin;
    if (IDL.phone.test(t))    return CANDIDATE.phone;
    if (IDL.location.test(t) && !/relocat|preferred|willing/.test(t)) return CANDIDATE.location;
    if (IDL.first.test(t))    return CANDIDATE.firstName;
    if (IDL.last.test(t))     return CANDIDATE.lastName;
    if (IDL.full.test(t) && !/company|employer|file|user|\brefer|emergency|manager|supervisor/.test(t))
      return `${CANDIDATE.firstName} ${CANDIDATE.lastName}`.trim();
    return '';
  };
  const isIdentityField = (f) => !!identityValueFor(f);

  const ESSAY_INTENT = /\bwhy\b|tell us|tell me|describe|what (interests|excites|motivat|draws|attracts)|best fit|why.*fit|what (do you|else)|anything else|bring to|cover letter|in your own words|motivat|passionate|interested in (this|the|working)/;

  const resolveAnswers = (fields, pkg) => {
    const answers = {};
    for (const f of fields) {
      const ctx = `${f.label} ${f.id} ${f.name}`;
      const key = f.id;
      if (/recaptcha|captcha|hcaptcha|honeypot|\bnonce\b/i.test(`${f.id} ${f.name}`)) continue;

      if (f.type === 'file') {
        if (/cover.?letter|motivation/i.test(ctx)) answers[key] = 'FILE_UPLOAD_COVER_LETTER';
        else if (/resume|cv|curriculum|attach/i.test(ctx)) answers[key] = 'FILE_UPLOAD_RESUME';
        continue;
      }
      if (f.type === 'checkbox') {
        if (/consent|agree|privacy|terms|gdpr|acknowledge|i confirm|own words/i.test(ctx)) answers[key] = 'CHECK';
        continue;
      }

      let ans = matchPackageAnswer(f.label, pkg);
      if (ans == null) ans = matchBank(f.label);

      if (ans != null && ans !== '') {
        const filled = fillPlaceholders(ans, pkg);
        if (f.type === 'select' || f.type === 'radio') {
          const opt = bestOption(filled, f.options);
          if (opt) answers[key] = opt;
        } else {
          answers[key] = filled;
        }
        continue;
      }

      if ((f.type === 'textarea' || f.type === 'text') && f.required && pkg.why
          && !classifyField(f) && ESSAY_INTENT.test(norm(ctx))) {
        answers[key] = fillPlaceholders(pkg.why, pkg);
      }
    }
    return answers;
  };

  const mergeIdentity = (answers, fields) => {
    const fullName = `${CANDIDATE.firstName} ${CANDIDATE.lastName}`.trim();
    const identity = {
      first_name: CANDIDATE.firstName, firstname: CANDIDATE.firstName,
      last_name:  CANDIDATE.lastName,  lastname:  CANDIDATE.lastName,
      email:      CANDIDATE.email,     phone:     CANDIDATE.phone,
      phone_number: CANDIDATE.phone,   linkedin_profile: CANDIDATE.linkedin,
      linkedin:   CANDIDATE.linkedin,  'applicant[first_name]': CANDIDATE.firstName,
      'applicant[last_name]': CANDIDATE.lastName, 'applicant[email]': CANDIDATE.email,
      'applicant[phone]':     CANDIDATE.phone,
      name: fullName, full_name: fullName, fullname: fullName, your_name: fullName, legal_name: fullName,
      location: CANDIDATE.location, 'location-input': CANDIDATE.location,
      current_location: CANDIDATE.location, city: CANDIDATE.city,
      org: CANDIDATE.appAnswers.current_company || '', organization: CANDIDATE.appAnswers.current_company || '',
      current_company: CANDIDATE.appAnswers.current_company || '', employer: CANDIDATE.appAnswers.current_company || '',
    };
    for (const [key, val] of Object.entries(identity)) {
      if (val && fields.some(f => f.id === key || f.name === key)) answers[key] = val;
    }
    // Label-based pass for ATSes whose field ids don't match the table above
    // (Ashby _systemfield_*, custom forms). Only fills still-empty fields.
    for (const f of fields) {
      const cur = answers[f.id] ?? answers[f.name];
      if (cur != null && cur !== '') continue;
      const v = identityValueFor(f);
      if (v) answers[f.id] = v;
    }
    return answers;
  };

  const applyProfileAnswers = (answers, fields) => {
    const changes = [];
    const isChoice = (f) => f.type === 'select' || f.type === 'radio';
    const firstConcrete = (opts) => (opts || []).find(o => !isDecline(o) && norm(o));
    for (const field of fields) {
      const key = field.id;
      const cur = answers[field.id] ?? answers[field.name];
      const cls = classifyField(field);
      if (!cls || !cls.desired) {
        if (isDecline(cur) && isChoice(field) && (!cls || cls.kind !== 'demographic')) {
          const c = firstConcrete(field.options);
          if (c) { answers[key] = c; changes.push(`${field.label || key}: decline→${c}`); }
        }
        continue;
      }
      if (isChoice(field) && field.options?.length) {
        let opt = bestOption(cls.desired, field.options);
        if (!opt && Array.isArray(cls.fallbacks)) {
          for (const fb of cls.fallbacks) { opt = bestOption(fb, field.options); if (opt) break; }
        }
        if (opt) {
          if (norm(cur) !== norm(opt)) changes.push(`${field.label || key} → ${opt}`);
          answers[key] = opt;
        } else if (isDecline(cur) && cls.kind !== 'demographic') {
          const c = firstConcrete(field.options);
          if (c) { answers[key] = c; changes.push(`${field.label || key}: decline→${c}`); }
        }
      } else if (!cur || isDecline(cur)) {
        const instructional = /\b(if you|only if|write|please (write|describe|specify|note|provide))\b/i.test(field.label || '');
        if (cls.kind === 'demographic' && instructional) continue;
        answers[key] = cls.desired;
        changes.push(`${field.label || key} → ${cls.desired}`);
      }
    }
    return changes;
  };

  const validateApplication = (answers, fields) => {
    const issues = [];
    const get = (f) => answers[f.id] ?? answers[f.name];
    const hasEmail = Object.values(answers).some(v => String(v).includes('@'));
    if (fields.some(f => /email/i.test(f.label + f.id)) && !hasEmail) issues.push('email not filled');
    for (const f of fields) {
      const v = get(f);
      if (f.required && f.type !== 'file' && (v === undefined || v === null || v === '')) {
        issues.push(`required empty: ${f.label || f.id}`);
      }
      if (typeof v === 'string' && v.includes('—')) issues.push(`em-dash in: ${f.label || f.id}`);
      if (typeof v === 'string' && isDecline(v)) issues.push(`decline value in: ${f.label || f.id}`);
    }
    return { approved: issues.length === 0, reason: issues.slice(0, 6).join('; '), issues };
  };

  // Package loader (output/autoapply/{num}.json), path-normalized.
  const findPackage = (num) => {
    const intNum = String(parseInt(num, 10));
    for (const cand of [String(num), intNum]) {
      const p = join(autoapplyDir, `${cand}.json`);
      if (existsSync(p)) return { kind: 'json', path: p };
    }
    return null;
  };
  const readPackageJson = (jsonPath) => {
    let j;
    try { j = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch { return null; }
    const abs = (p) => (p && !p.startsWith('/') ? join(projectDir, p) : p) || '';
    return {
      url: (j.url || '').trim(),
      cvPath: preferTechnical(abs(j.cvPath)), coverPath: preferTechnical(abs(j.coverPath)),
      salary: j.salary || '', why: j.why || '', company: j.company || '', role: j.role || '',
      answers: j.answers || {},
    };
  };

  return {
    candidate: CANDIDATE, qaBank: QA_BANK, salaryFallback: SALARY_FALLBACK,
    fillPlaceholders, matchBank, matchPackageAnswer, classifyField, bestOption,
    identityValueFor, isIdentityField,
    resolveAnswers, mergeIdentity, applyProfileAnswers, validateApplication,
    detectAts, findPackage, readPackageJson, norm, isDecline,
  };
}
