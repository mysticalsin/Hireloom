#!/usr/bin/env node
/**
 * kimi-apply.mjs — Kimi-powered application filler with a HARD stop before submit.
 *
 * Fills an application end-to-end across multiple pages:
 *   • deterministic fields (identity / EEO / work-auth / logistics) → local resolver
 *   • free-text essay fields ("Why this company?", "Describe your experience") → Kimi
 *   • attaches the tailored CV + cover from a pre-made package
 *   • auto-advances Next/Continue pages, but STOPS at the final Submit for the
 *     human to review and click (per Hireloom's Ethical Use rule).
 *
 * Usage:
 *   node engine/apply/kimi-apply.mjs --num 3
 *   node engine/apply/kimi-apply.mjs --url <applyUrl> --cv "<resume.pdf>" --cover "<cover.pdf>" [--jd <jd.txt>]
 *
 * Env (.env): KIMI_API_KEY, KIMI_BASE_URL, KIMI_MODEL, PW_CHROMIUM_PATH
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';
import { createResolver, extractFieldsInPage, isDecline, preferTechnical } from './autoapply-core.mjs';

const PROJECT_DIR = process.cwd();

// ── tiny .env loader (no dep) ──
function loadEnv() {
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
loadEnv();

const KEY   = process.env.KIMI_API_KEY || '';
const BASE  = (process.env.KIMI_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
const MODEL = process.env.KIMI_MODEL || 'moonshotai/kimi-k2.6';
const EXE   = process.env.PW_CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '';
// Skip auto-attaching CV/cover (Greenhouse pre-fills a stored resume and the script
// fights it). Instead, open the package folder so the user drags the files in.
const MANUAL_UPLOAD = process.argv.includes('--manual-upload') || process.env.MANUAL_UPLOAD === '1';

// ── args ──
const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : ''; };
const numArg = arg('--num');
let URL = arg('--url'), CV = arg('--cv'), COVER = arg('--cover'), JDFILE = arg('--jd');
let companyRole = '';
if (numArg) {
  const pkg = JSON.parse(readFileSync(join('output/autoapply', `${numArg}.json`), 'utf8'));
  URL = URL || pkg.url;
  const { loadIdentity } = await import('../lib/identity.mjs');
  const candName = pkg.cvPath && pkg.coverPath ? '' : loadIdentity().name;
  CV = CV || pkg.cvPath || `output/uploads/${numArg}/${candName} - Resume.pdf`;
  COVER = COVER || pkg.coverPath || `output/uploads/${numArg}/${candName} - Cover Letter.pdf`;
  JDFILE = JDFILE || join('output/autoapply/jds', `${numArg}.txt`);
  companyRole = `${pkg.company} — ${pkg.role}`;
}
CV = preferTechnical(CV);
COVER = preferTechnical(COVER);
if (!URL) { console.error('Need --url or --num'); process.exit(1); }
if (!KEY) { console.error('KIMI_API_KEY not set in .env'); process.exit(1); }

const log = (...a) => console.log(...a);
const R = createResolver({ projectDir: PROJECT_DIR });
const CAND = R.candidate;
const CAND_NAME = `${CAND.firstName} ${CAND.lastName}`.trim() || 'the candidate';
const CV_MD = (() => { try { return readFileSync('cv.md', 'utf8').slice(0, 6000); } catch { return ''; } })();
const JD = (() => { try { return JDFILE && existsSync(JDFILE) ? readFileSync(JDFILE, 'utf8').slice(0, 6000) : ''; } catch { return ''; } })();

// ── Kimi call ──
async function callKimi(system, user, maxTokens = 500) {
  const body = JSON.stringify({
    model: MODEL,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.4, max_tokens: maxTokens,
  });
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body,
  });
  if (!r.ok) throw new Error(`Kimi ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.choices?.[0]?.message?.content || '').trim();
}

// Candidate facts block — given to Kimi so it MAPS real facts to fields rather
// than inventing. Objects (eeo/workAuth/etc.) are serialized verbatim from profile.yml.
const FACTS = [
  `Name: ${CAND.firstName} ${CAND.lastName}`,
  `Email: ${CAND.email}`,
  `Phone: ${CAND.phone}`,
  `Location: ${CAND.location} (City: ${CAND.city}; Country: ${CAND.country})`,
  `LinkedIn: ${CAND.linkedin}`,
  `Education: ${JSON.stringify(CAND.education)}`,
  `Work authorization: ${JSON.stringify(CAND.workAuth)}`,
  `EEO / voluntary: ${JSON.stringify(CAND.eeo)}`,
  `Logistics / common answers: ${JSON.stringify(CAND.appAnswers)}`,
  `Salary target: ${R.salaryFallback}`,
].join('\n');

// Kimi fills an ENTIRE page of fields in one call. It reasons over each field's
// label + available options + the candidate's real facts/resume, and returns a
// JSON map {fieldId: value}. For select/radio it must copy one option verbatim.
async function kimiFillPage(fields) {
  const compact = fields.map(f => ({
    id: f.id, label: (f.label || '').slice(0, 200), type: f.type,
    options: (f.options || []).slice(0, 50),
  }));
  const sys = `You fill job application forms AS the candidate ${CAND_NAME}, first person. RULES:
- Use ONLY the candidate FACTS and RESUME. NEVER invent employers, titles, dates, degrees, or metrics.
- select/radio fields: choose EXACTLY ONE string copied verbatim from that field's "options". If none truly fit, use "".
- text/tel/email/number: short factual answers come from FACTS (name, email, phone, city, salary, dates, yes/no logistics).
- textarea / essay questions ("why us", "describe...", "tell us..."): 3-5 honest sentences grounded in the RESUME + JOB; if the resume lacks the asked experience, say so briefly and pivot to transferable strengths.
- Respect any character limit stated in a label (e.g. "150 characters").
- NEVER pick a "prefer not to say"/decline option — use the real fact from EEO.
- If you cannot ground an answer, use "".
- No markdown, no em-dashes (use "-").
Return ONLY a JSON object mapping each field id to its value. No prose, no code fences.`;
  const usr = `CANDIDATE FACTS:\n${FACTS}\n\nRESUME:\n${CV_MD}\n\nJOB:\n${companyRole}\n${JD || '(JD not provided)'}\n\nFIELDS (JSON):\n${JSON.stringify(compact)}`;
  const raw = await callKimi(sys, usr, 2200);
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try {
    const obj = JSON.parse(m[0]);
    for (const k of Object.keys(obj)) if (typeof obj[k] === 'string') obj[k] = obj[k].replace(/—/g, '-');
    return obj;
  } catch { return {}; }
}

// "Apply"/"Apply Now"/"Start" OPEN the application (advance). Only true final
// verbs STOP. This avoids mistaking a posting page's "Apply" for the submit.
// "apply now"/"apply" REMOVED from NEXT_RE (2026-06-11): on some ATSes (Samsara)
// the filled form's "Apply Now" button IS the submit. Treat those labels as
// submit-grade — never auto-click.
const NEXT_RE   = /^(next|continue|save (and|&) continue|proceed|review)\b/i;
const SUBMIT_RE = /^(submit|submit application|send application|finish|complete application|apply now|apply)\b/i;

// React-select / ARIA comboboxes (Greenhouse, Ashby, Lever dropdown questions)
// don't register a value when you merely TYPE into them — the form stays "empty"
// until you click an option from the popped-up listbox. This pass detects those
// widgets among the answered fields and performs the real open→filter→click.
async function selectComboboxes(frame, fields, answers) {
  for (const f of fields) {
    if (f.type === 'select' || f.type === 'radio' || f.type === 'checkbox' ||
        f.type === 'file' || f.type === 'textarea') continue;
    const raw = answers[f.id] ?? answers[f.name];
    if (raw == null || raw === '') continue;
    const want = String(raw).trim();
    if (!want) continue;

    const sel = `[id="${String(f.id).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
    const loc = frame.locator(sel).first();
    if (await loc.count().catch(() => 0) === 0) continue;

    // Only act on real comboboxes — not plain text/email/number inputs.
    const isCombo = await loc.evaluate(el => {
      if (el.tagName === 'SELECT') return false;
      return el.getAttribute('role') === 'combobox' ||
             el.getAttribute('aria-autocomplete') === 'list' ||
             el.getAttribute('aria-haspopup') === 'listbox' ||
             !!el.closest('.select__control,[class*="select__control"],[class*="select-shell"],[class*="combobox"],[role="combobox"]');
    }).catch(() => false);
    if (!isCombo) continue;

    const optSel = '[role="option"], .select__option, [class*="-option"], [class*="option__"]';
    await loc.click({ timeout: 3000 }).catch(() => {});
    await frame.waitForTimeout(250);

    let opts = frame.locator(optSel);
    if (await opts.count().catch(() => 0) === 0) {
      // menu didn't open on click alone — type to trigger/filter it
      await loc.fill('').catch(() => {});
      await loc.pressSequentially(want.slice(0, 40), { delay: 15 }).catch(() => {});
      await frame.waitForTimeout(450);
      opts = frame.locator(optSel);
    }
    const oc = await opts.count().catch(() => 0);
    if (oc === 0) { await loc.press('Escape').catch(() => {}); continue; } // not a real menu — leave it

    const wl = want.toLowerCase();
    let clicked = false;
    const texts = [];
    for (let i = 0; i < oc; i++) texts.push(((await opts.nth(i).textContent().catch(() => '')) || '').trim());
    let idx = texts.findIndex(t => t.toLowerCase() === wl);
    if (idx < 0) idx = texts.findIndex(t => t && (t.toLowerCase().includes(wl) || wl.includes(t.toLowerCase())));
    // No matching option → close the dropdown and LEAVE IT BLANK for the user.
    // ("Accept highlighted" was NOT safe: with no match the highlight sits on
    // the first option alphabetically — it selected "Agender" for gender=Male.)
    if (idx >= 0) { await opts.nth(idx).click({ timeout: 2500 }).catch(() => {}); clicked = true; }
    else { await loc.press('Escape').catch(() => {}); }

    await frame.waitForTimeout(200);
    log(`  ▾ dropdown "${(f.label || f.id).slice(0, 35)}" → ${clicked ? `clicked "${want.slice(0, 30)}"` : `⚠ no option matched "${want.slice(0, 30)}" — LEFT BLANK, fill by hand`}`);
  }
}

(async () => {
  const ctx = await chromium.launchPersistentContext('.apply-profile', {
    headless: false, ...(EXE ? { executablePath: EXE } : {}),
    viewport: null,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  log(`\n▶ ${companyRole || URL}`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const MAX_PAGES = 8;
  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    log(`\n── page ${pageNum} ──`);

    // 1. fill every fillable frame on this page
    for (const frame of page.frames()) {
      let fields = [];
      try { fields = await frame.evaluate(extractFieldsInPage); } catch { continue; }
      if (!fields.length) continue;

      // Kimi-first: Kimi reasons over every field (label + options + facts).
      let kimiMap = {};
      try { kimiMap = await kimiFillPage(fields); }
      catch (e) { log(`  ⚠ Kimi page fill failed: ${e.message} — falling back to local resolver`); }

      // Deterministic resolver as a backstop for anything Kimi left blank.
      let det = R.resolveAnswers(fields, { cvPath: CV, coverPath: COVER });
      det = R.mergeIdentity(det, fields);
      R.applyProfileAnswers(det, fields);

      const answers = {};
      for (const f of fields) {
        const k = kimiMap[f.id];
        const fallback = det[f.id] ?? det[f.name];
        let val = (k !== undefined && k !== '' && !isDecline(k)) ? k : fallback;
        // hard-enforce any character limit stated in the label (Kimi often overshoots)
        const lim = (f.label || '').match(/(\d{2,4})\s*characters?/i);
        if (lim && typeof val === 'string' && val.length > +lim[1]) val = val.slice(0, +lim[1]).trim();
        if (val !== undefined && val !== '' && !isDecline(val)) {
          answers[f.id] = val;
          const src = (k !== undefined && k !== '' && !isDecline(k)) ? 'kimi' : 'local';
          if (f.type === 'textarea' || (f.label || '').length > 25)
            log(`  ✎[${src}] "${(f.label || f.id).slice(0, 45)}" → ${String(val).slice(0, 55)}`);
        }
      }

      // write values into the frame (safe: native setter + change; selects/radios matched)
      await frame.evaluate(({ items }) => {
        const setNative = (el, val) => {
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        for (const it of items) {
          const el = document.getElementById(it.id) || document.querySelector(`[name="${it.name}"]`) || document.querySelector(`[id="${it.id}"]`);
          if (!el && it.type !== 'radio') continue;
          // file inputs are filled separately via setInputFiles — never setNative (browser forbids it)
          if (it.type === 'file' || (el && el.tagName === 'INPUT' && el.type === 'file')) continue;
          if (el && el.tagName === 'SELECT') {
            const opt = Array.from(el.options).find(o => o.text.trim() === String(it.value)) ||
                        Array.from(el.options).find(o => o.text.trim().toLowerCase() === String(it.value).toLowerCase());
            if (opt) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); }
          } else if (it.type === 'radio') {
            const radios = Array.from(document.querySelectorAll(`[name="${it.name}"]`));
            const r = radios.find(x => (x.value || '').toLowerCase() === String(it.value).toLowerCase());
            if (r && !r.checked) r.click();
          } else if (!el.value) {
            setNative(el, String(it.value));
          }
        }
      }, { items: fields.filter(f => (answers[f.id] ?? answers[f.name]) !== undefined)
                          .map(f => ({ id: f.id, name: f.name, type: f.type, value: answers[f.id] ?? answers[f.name] })) });

      // react-select/ARIA comboboxes need a real open→click, not just typed text
      await selectComboboxes(frame, fields, answers).catch(() => {});
    }

    // 2. attach CV + cover to file inputs (first empty → resume, next → cover)
    if (MANUAL_UPLOAD) {
      log(`  📎 manual-upload mode — skipping auto-attach; drag the files in yourself.`);
    } else {
      const fileInputs = page.locator('input[type="file"]');
      const fc = await fileInputs.count();
      let attached = 0;
      for (let i = 0; i < fc; i++) {
        const fi = fileInputs.nth(i);
        const val = await fi.inputValue().catch(() => '');
        if (val) continue;
        const f = attached === 0 ? CV : COVER;
        if (f && existsSync(f)) { await fi.setInputFiles(f).catch(() => {}); attached++; }
      }
      if (attached) log(`  📎 attached ${attached} file(s)`);
    }

    // 3. find the forward button and decide: advance vs STOP-at-submit
    await page.waitForTimeout(800);
    const btns = page.locator('button, input[type="submit"], input[type="button"], a[role="button"]');
    const n = await btns.count();
    let nextBtn = null, submitSeen = false;
    for (let i = 0; i < n; i++) {
      const b = btns.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      const t = ((await b.textContent().catch(() => '')) || (await b.getAttribute('value').catch(() => '')) || '').trim();
      if (!t) continue;
      if (SUBMIT_RE.test(t)) { submitSeen = true; }
      else if (NEXT_RE.test(t) && !nextBtn) { nextBtn = b; }
    }

    // A visible Submit button means the form is already on this page (Greenhouse
    // job-boards embed it). The "Apply" link here just scrolls to that form — it
    // does NOT advance a page, so treating it as Next caused an infinite re-fill
    // loop. Submit-present always wins → STOP for review.
    if (submitSeen) {
      log(`\n🛑 Reached the SUBMIT step. Form is filled — STOPPING for your review.`);
      log(`   Review every field, then click Submit yourself. Browser stays open.`);
      break;
    }
    if (nextBtn) {
      const label = ((await nextBtn.textContent().catch(() => '')) || '').trim();
      log(`  ➡ advancing via "${label}"`);
      await nextBtn.click({ timeout: 10_000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      continue;
    }
    log(`\n⏸ No clear Next/Submit button found — stopping for you to take over.`);
    break;
  }

  log(`\n✅ Done filling. Browser left open for your review + manual Submit.\n`);
  await new Promise(() => {}); // keep open until you Ctrl-C / close
})();
