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
    return el.placeholder || el.getAttribute('aria-label') || '';
  };
  const elements = document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]), textarea, select'
  );
  for (const el of elements) {
    const id   = el.id || el.name || `field_${fields.length}`;
    const name = el.name || el.id || '';
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
    fields.push({
      id, name, type,
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
      const kv = line.match(/^\s+([a-z_]+):\s*"?([^"\n]*?)"?\s*$/i);
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
    if (/authoriz|legally|eligible to work|right to work|work permit/.test(t)) return { kind: 'demographic', desired: w.legally_authorized_to_work };
    if (/hispanic|latino|latinx/.test(t))                         return { kind: 'demographic', desired: e.hispanic_latino };
    if (/race|ethnic/.test(t))                                    return { kind: 'demographic', desired: e.race_ethnicity };
    if (/transgender/.test(t))                                    return { kind: 'demographic', desired: e.transgender };
    if (/orientation/.test(t))                                    return { kind: 'demographic', desired: e.sexual_orientation };
    if (/pronoun/.test(t))                                        return { kind: 'demographic', desired: e.pronouns };
    if (/gender|\bsex\b/.test(t))                                 return { kind: 'demographic', desired: e.gender };
    if (/veteran/.test(t))                                        return { kind: 'demographic', desired: e.veteran_status };
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
        const opt = bestOption(cls.desired, field.options);
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
    resolveAnswers, mergeIdentity, applyProfileAnswers, validateApplication,
    detectAts, findPackage, readPackageJson, norm, isDecline,
  };
}
