#!/usr/bin/env node
/**
 * apply-session.mjs — ONE long-lived apply window you position once, driven by
 * commands across a session. Solves the "don't relaunch a new window per role"
 * problem: it opens the persistent `.apply-profile` Chromium a single time and
 * then listens on a file-based command channel for `goto` / `fill` instructions.
 *
 * Cadence it supports (matches the user's real workflow):
 *   • Indeed:  goto <google careers search> → user finds page + clears logins →
 *              user says "fill" → Kimi fills the CURRENT page → user submits → next
 *   • ATS:     goto <form url> → fill → user corrects + submits → next
 *
 * The window NEVER relaunches between roles. The fill logic is the same as
 * kimi-apply.mjs (Kimi-first, deterministic backstop, hard STOP before submit).
 *
 * Command channel (so a controlling agent can drive it across turns):
 *   write  .apply-session/cmd.json   { id, cmd: "goto"|"fill"|"status"|"quit", ... }
 *   read   .apply-session/out.json   { id, ok, msg }     (response to last cmd)
 *   read   .apply-session/status.json{ state, url, lastAction, ts }  (heartbeat)
 *
 * Start once:  node engine/apply/apply-session.mjs    (leave running in the background)
 * Env (.env):  KIMI_API_KEY, KIMI_BASE_URL, KIMI_MODEL, PW_CHROMIUM_PATH
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'fs';
import { chromium } from 'playwright';
import { createResolver, extractFieldsInPage, isDecline, preferTechnical, norm, checkboxSelfId } from './autoapply-core.mjs';

const PROJECT_DIR = process.cwd();
const SDIR = '.apply-session';
const CMD = `${SDIR}/cmd.json`;
const OUT = `${SDIR}/out.json`;
const STATUS = `${SDIR}/status.json`;

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
if (!KEY) { console.error('KIMI_API_KEY not set in .env'); process.exit(1); }

// Window geometry: APPLY_WINDOW="x,y,w,h" docks the window (e.g. right half of the
// screen) instead of fullscreen. Unset → maximized (previous default).
const _win = (process.env.APPLY_WINDOW || '').split(',').map(n => parseInt(n, 10));
const WIN_ARGS = (_win.length === 4 && _win.every(Number.isFinite))
  ? [`--window-position=${_win[0]},${_win[1]}`, `--window-size=${_win[2]},${_win[3]}`]
  : ['--start-maximized'];

const log = (...a) => console.log(...a);
const R = createResolver({ projectDir: PROJECT_DIR });
const CAND = R.candidate;
const SELF = (CAND && CAND.eeo) || {};   // saved EEO self-ID for demographic checkbox groups
const CAND_NAME = `${CAND.firstName} ${CAND.lastName}`.trim() || 'the candidate';
const CV_MD = (() => { try { return readFileSync('cv.md', 'utf8').slice(0, 6000); } catch { return ''; } })();

// Per-fill context (set by each `fill` command).
let CTX = { cv: '', cover: '', jd: '', companyRole: '' };

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
  const usr = `CANDIDATE FACTS:\n${FACTS}\n\nRESUME:\n${CV_MD}\n\nJOB:\n${CTX.companyRole}\n${CTX.jd || '(JD not provided)'}\n\nFIELDS (JSON):\n${JSON.stringify(compact)}`;
  const raw = await callKimi(sys, usr, 2200);
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try {
    const obj = JSON.parse(m[0]);
    for (const k of Object.keys(obj)) if (typeof obj[k] === 'string') obj[k] = obj[k].replace(/—/g, '-');
    return obj;
  } catch { return {}; }
}

// "apply now"/"apply" REMOVED from NEXT_RE (2026-06-11): on some ATSes (Samsara)
// the filled form's "Apply Now" button IS the submit — auto-clicking it submitted
// a live application. Ambiguous labels now stop the session; the user clicks them.
const NEXT_RE   = /^(next|continue|save (and|&) continue|proceed|review)\b/i;
const SUBMIT_ALSO_RE = /^(apply now|apply)\b/i; // treat as submit-grade: never auto-click
const SUBMIT_RE = /^(submit|submit application|send application|finish|complete application)\b/i;

// Pick the index of the live option that best matches ANY desired value (primary
// first, then fallbacks): exact → city/first-segment → substring → token-overlap.
// Returns -1 when nothing plausibly matches, so we LEAVE THE FIELD BLANK rather
// than guess (the Samsara "Agender" lesson — never select an unverified option).
function pickOption(wants, texts) {
  const N = texts.map(norm);
  for (const raw of wants) {
    const want = String(raw || '').trim();
    const wl = norm(want);
    if (!wl) continue;
    let i = N.findIndex(t => t === wl);                       // exact
    if (i >= 0) return i;
    const seg = norm(want.split(',')[0]);                    // city from "Ajax, ON, Canada"
    if (seg && seg !== wl) { i = N.findIndex(t => t === seg); if (i >= 0) return i; }
    i = N.findIndex(t => t && (t.includes(wl) || wl.includes(t)));  // substring either way
    if (i >= 0) return i;
    if (seg) { i = N.findIndex(t => t.includes(seg)); if (i >= 0) return i; } // option contains city
    const dt = new Set(wl.split(' ').filter(Boolean));       // token overlap
    let best = -1, bestScore = 0;
    N.forEach((t, j) => { const ov = t.split(' ').filter(x => dt.has(x)).length; if (ov > bestScore) { bestScore = ov; best = j; } });
    if (best >= 0 && bestScore >= 1) return best;
  }
  return -1;
}

const ESC = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
// Locate a field robustly: prefer the data-hl-fid stamp (works for id-less React
// comboboxes like Ashby's location typeahead), then fall back to id / name.
async function fieldLoc(frame, f) {
  const sels = [];
  if (f.hlfid) sels.push(`[data-hl-fid="${ESC(f.hlfid)}"]`);
  if (f.id)    sels.push(`[id="${ESC(f.id)}"]`);
  if (f.name)  sels.push(`[name="${ESC(f.name)}"]`);
  for (const s of sels) {
    const l = frame.locator(s).first();
    if (await l.count().catch(() => 0) > 0) return l;
  }
  return null;
}

// Read option texts from the listbox THIS combobox controls — scoped so a
// DIFFERENT open dropdown's options can't bleed in. The bleed is what selected
// a phone country-code ("Lebanon+961") for Disability Status on Greenhouse forms.
// Returns { opts, count, scoped }. scoped=false means we fell back to a global
// option scan (only safe for non-demographic fields).
async function scopedOptions(frame, loc) {
  const OPT = '[role="option"], .select__option, [class*="-option"], [class*="option__"]';
  const sel = await loc.evaluate(el => {
    document.querySelectorAll('[data-hl-lb]').forEach(n => n.removeAttribute('data-hl-lb'));
    const tag = (n) => { if (!n) return null; n.setAttribute('data-hl-lb', '1'); return '[data-hl-lb="1"]'; };
    const ctrl = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (ctrl) { const lb = document.getElementById(ctrl); if (lb) return tag(lb); }
    // react-select: the open menu lives inside this select's own container
    const cont = el.closest('[class*="select-shell"], [class*="select__container"]')
              || (el.closest('[class*="select__control"]') || {}).parentElement;
    const menu = cont && cont.querySelector('[class*="select__menu"], [class*="menu-list"], [role="listbox"]');
    if (menu && menu.offsetParent !== null) return tag(menu);
    // exactly one visible listbox in the whole frame → unambiguous, safe to use
    const open = Array.from(document.querySelectorAll('[role="listbox"], [class*="select__menu"]')).filter(n => n.offsetParent !== null);
    if (open.length === 1) return tag(open[0]);
    return null; // ambiguous → caller decides (strict demographic = blank)
  }).catch(() => null);

  if (sel) { const opts = frame.locator(`${sel} ${OPT}`); return { opts, count: await opts.count().catch(() => 0), scoped: true }; }
  const opts = frame.locator(OPT);
  return { opts, count: await opts.count().catch(() => 0), scoped: false };
}

// STRICT matcher for demographic / yes-no fields: exact, or same yes/no polarity,
// or ALL desired tokens present as WHOLE words. No loose token-overlap and no
// substring — so gender "Male" never matches "Female" and "No, I do not have a
// disability" never flips to the "Yes" option. Returns -1 → leave BLANK + flag.
function pickOptionStrict(wants, texts) {
  const N = texts.map(norm);
  for (const raw of wants) {
    const wl = norm(String(raw || '')); if (!wl) continue;
    let i = N.findIndex(t => t === wl); if (i >= 0) return i;                 // exact
    const w0 = wl.split(' ')[0];
    if (w0 === 'yes' || w0 === 'no') {                                        // yes/no polarity
      const same = N.map((t, j) => ({ t, j })).filter(o => o.t.split(' ')[0] === w0);
      if (same.length === 1) return same[0].j;
      const keys = new Set(wl.split(' ').filter(x => x.length > 3 && !['have', 'will', 'future', 'your'].includes(x)));
      const scored = same.map(o => ({ j: o.j, s: o.t.split(' ').filter(x => keys.has(x)).length })).sort((a, b) => b.s - a.s);
      if (scored.length && scored[0].s > 0 && (scored.length < 2 || scored[0].s > scored[1].s)) return scored[0].j;
      return -1;                                                             // ambiguous yes/no → blank
    }
    const dt = wl.split(' ').filter(Boolean);                                // categorical: whole-word containment
    let best = -1, bestExtra = Infinity;
    N.forEach((t, j) => {
      const ot = new Set(t.split(' ').filter(Boolean));
      if (dt.every(x => ot.has(x))) { const extra = ot.size - dt.length; if (extra < bestExtra) { bestExtra = extra; best = j; } }
    });
    if (best >= 0) return best;
  }
  return -1;
}

async function selectComboboxes(frame, fields, answers, altMap = {}, demoIds = new Set()) {
  for (const f of fields) {
    if (f.type === 'select' || f.type === 'radio' || f.type === 'checkbox' ||
        f.type === 'file' || f.type === 'textarea') continue;
    const primary = answers[f.id] ?? answers[f.name];
    const wants = (altMap[f.id] && altMap[f.id].length) ? altMap[f.id]
                : (primary != null && primary !== '' ? [primary] : []);
    if (!wants.length) continue;
    const want0 = String(wants[0]).trim();
    if (!want0) continue;

    const loc = await fieldLoc(frame, f);
    if (!loc) continue;

    const isCombo = await loc.evaluate(el => {
      if (el.tagName === 'SELECT') return false;
      return el.getAttribute('role') === 'combobox' ||
             el.getAttribute('aria-autocomplete') === 'list' ||
             el.getAttribute('aria-haspopup') === 'listbox' ||
             !!el.closest('.select__control,[class*="select__control"],[class*="select-shell"],[class*="combobox"],[role="combobox"]');
    }).catch(() => false);
    if (!isCombo) continue;

    const strict = demoIds.has(f.id); // demographic → strict matching + scope required

    // Skip a combobox that already holds a value — re-running in the top-up pass
    // was ADDING a second wrong chip to multi-selects (race → White + Hispanic).
    const filled = await loc.evaluate(el => {
      const cont = el.closest('[class*="select-shell"], [class*="select__container"]')
                || (el.closest('[class*="select__control"]') || {}).parentElement;
      if (cont && cont.querySelector('[class*="multi-value"], [class*="single-value"], [class*="multiValue"], [class*="singleValue"]')) return true;
      return !!(el.value && String(el.value).trim());
    }).catch(() => false);
    if (filled) continue;

    await loc.click({ timeout: 3000 }).catch(() => {});
    await frame.waitForTimeout(300);
    let { opts, count, scoped } = await scopedOptions(frame, loc);
    if (count === 0 && strict) {
      // Demographic menus are static but can render slowly — wait + re-read.
      // NEVER type to filter a demographic: typing "Middle Eastern" over-filters
      // the race multi-select to zero and hides the MENA-inclusive "White /
      // Caucasian (…the Middle East…)" option before the "White" fallback is tried.
      await frame.waitForTimeout(500);
      ({ opts, count, scoped } = await scopedOptions(frame, loc));
    } else if (count === 0) {
      // Type to filter (places-style autocompletes: Ashby/Greenhouse location).
      const typeStr = want0.includes(',') ? want0.split(',')[0].trim() : want0;
      await loc.fill('').catch(() => {});
      await loc.pressSequentially(typeStr.slice(0, 40), { delay: 15 }).catch(() => {});
      await frame.waitForTimeout(600);
      ({ opts, count, scoped } = await scopedOptions(frame, loc));
    }
    // For a demographic field we MUST read this field's own listbox. If we can't
    // isolate it, refuse to match against a global option soup — that bleed is
    // exactly what put a phone code in Disability Status. Blank + flag instead.
    if (count === 0 || (strict && !scoped)) {
      await loc.press('Escape').catch(() => {});
      if (strict) log(`  ▾ "${(f.label || f.id).slice(0, 32)}" → ⚠ couldn't isolate options — LEFT BLANK (no demographic guessing)`);
      continue;
    }

    const texts = [];
    for (let i = 0; i < count; i++) texts.push(((await opts.nth(i).textContent().catch(() => '')) || '').trim());
    const idx = strict ? pickOptionStrict(wants.map(String), texts) : pickOption(wants.map(String), texts);
    if (idx >= 0) {
      await opts.nth(idx).click({ timeout: 2500 }).catch(() => {});
      log(`  ▾ "${(f.label || f.id).slice(0, 32)}" → "${(texts[idx] || '').slice(0, 28)}"${strict ? ' [strict]' : ''}`);
    } else {
      await loc.press('Escape').catch(() => {});
      log(`  ▾ "${(f.label || f.id).slice(0, 32)}" → ⚠ no${strict ? ' safe' : ''} match for [${wants.join(' / ').slice(0, 50)}] — saw {${texts.slice(0, 8).map(t => norm(t).slice(0, 16)).join(' | ')}} — LEFT BLANK`);
    }
    await frame.waitForTimeout(200);
  }
}

// Radio GROUPS (single-select), e.g. Ashby's "What is your current status in
// Canada?" → Canadian Citizen / PR / Open|Closed Work Permit / Would need sponsorship.
// Ashby renders each option as its OWN <input type=radio> with value="on", wrapped in
// a <fieldset> whose text is the real question (no <legend>). The generic extractor
// therefore saw N disconnected radios, never the question, and these BASICS (work-auth,
// citizenship) were left blank. This pass clusters radios by their fieldset/radiogroup,
// reconstructs the question + option LABELS, classifies the question, and clicks the
// truthful option BY LABEL (the value="on" attribute is unmatchable). Demographic groups
// (gender) use strict matching so nothing is ever guessed. Runs after comboboxes; the
// already-checked guard makes it idempotent across the two fill passes.
async function selectChoiceGroups(frame) {
  let groups = [];
  try {
    groups = await frame.evaluate(() => {
      const lblOf = (inp) => {
        if (inp.id) {
          const sel = (window.CSS && CSS.escape) ? CSS.escape(inp.id) : inp.id;
          const l = document.querySelector(`label[for="${sel}"]`);
          if (l) return l.textContent.replace(/\s+/g, ' ').trim();
        }
        const w = inp.closest('label');
        if (w) return w.textContent.replace(/\s+/g, ' ').trim();
        const p = inp.parentElement;
        return p ? p.textContent.replace(/\s+/g, ' ').trim() : (inp.value || '');
      };
      const byKey = new Map();
      for (const r of document.querySelectorAll('input[type="radio"]')) {
        const fs = r.closest('fieldset,[role="radiogroup"],[role="group"]');
        const key = fs || r;                       // fieldset element, else lone radio
        if (!byKey.has(key)) byKey.set(key, { fs, inputs: [] });
        byKey.get(key).inputs.push(r);
      }
      const out = [];
      for (const g of byKey.values()) {
        if (g.inputs.length < 2) continue;          // a real choice group has ≥2 options
        const options = g.inputs.map(lblOf);
        const gid = `hlcg${out.length}`;
        g.inputs.forEach((r, i) => { try { r.setAttribute('data-hl-cg', `${gid}:${i}`); } catch {} });
        let q = '';
        if (g.fs) {
          q = (g.fs.textContent || '').replace(/\s+/g, ' ').trim();
          for (const o of options) if (o) q = q.split(o).join(' ');   // strip option labels → leaves the question
          q = q.replace(/\s+/g, ' ').trim();
        }
        out.push({ gid, question: q, options, checked: g.inputs.findIndex(r => r.checked) });
      }
      return out;
    });
  } catch { return; }

  for (const g of groups) {
    if (g.checked >= 0) continue;                   // already answered (idempotent)
    const opts = (g.options || []).filter(Boolean);
    if (!g.question || opts.length < 2) continue;
    const cls = R.classifyField({ label: g.question, id: '', name: '', type: 'radio', options: opts });
    if (!cls || !cls.desired) continue;             // unclassified → leave for the user
    const wants = [cls.desired, ...(cls.fallbacks || [])].filter(Boolean).map(String);
    const strict = cls.kind === 'demographic';      // demographics never guessed
    const idx = strict ? pickOptionStrict(wants, opts) : pickOption(wants, opts);
    if (idx < 0) {
      log(`  ◯ "${g.question.slice(0, 44)}" → ⚠ no${strict ? ' safe' : ''} match for [${wants.join('/').slice(0, 32)}] — LEFT BLANK`);
      continue;
    }
    // In-page click (not a Playwright actionability click): Ashby radios are visually
    // hidden behind a styled span, so click the input, then its label as a fallback.
    const ok = await frame.evaluate(({ sel }) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.click();
      if (el.checked) return true;
      const lab = (el.id && document.querySelector(`label[for="${(window.CSS && CSS.escape) ? CSS.escape(el.id) : el.id}"]`)) || el.closest('label') || el.parentElement;
      if (lab) lab.click();
      return !!el.checked;
    }, { sel: `[data-hl-cg="${g.gid}:${idx}"]` }).catch(() => false);
    log(`  ${ok ? '◉' : '◯'} "${g.question.slice(0, 44)}" → ${opts[idx]}${ok ? '' : ' (click did not register — verify)'}`);
  }
}

// Demographic CHECKBOX groups (multi-select), e.g. Ashby's "What ethnicity(ies) do you
// identify with?" / "Which communities do you belong to?". Same fieldset clustering as
// radios; ticks ONLY the boxes the saved self-ID affirms (Middle East Asian; Parent).
// High-stakes (the Samsara class) → strictly truthful, conservative, and still verified
// visually before submit.
async function selectCheckboxGroups(frame) {
  let groups = [];
  try {
    groups = await frame.evaluate(() => {
      const lblOf = (inp) => {
        if (inp.id) {
          const sel = (window.CSS && CSS.escape) ? CSS.escape(inp.id) : inp.id;
          const l = document.querySelector(`label[for="${sel}"]`);
          if (l) return l.textContent.replace(/\s+/g, ' ').trim();
        }
        const w = inp.closest('label');
        if (w) return w.textContent.replace(/\s+/g, ' ').trim();
        const p = inp.parentElement;
        return p ? p.textContent.replace(/\s+/g, ' ').trim() : '';
      };
      const byKey = new Map();
      for (const c of document.querySelectorAll('input[type="checkbox"]')) {
        const fs = c.closest('fieldset,[role="group"],[role="radiogroup"]');
        const key = fs || c;
        if (!byKey.has(key)) byKey.set(key, { fs, inputs: [] });
        byKey.get(key).inputs.push(c);
      }
      const out = [];
      for (const g of byKey.values()) {
        if (g.inputs.length < 2) continue;          // skip lone checkboxes (consent/agree toggles)
        const options = g.inputs.map(lblOf);
        const gid = `hlcb${out.length}`;
        g.inputs.forEach((c, i) => { try { c.setAttribute('data-hl-cb', `${gid}:${i}`); } catch {} });
        let q = '';
        if (g.fs) {
          q = (g.fs.textContent || '').replace(/\s+/g, ' ').trim();
          for (const o of options) if (o) q = q.split(o).join(' ');
          q = q.replace(/\s+/g, ' ').trim();
        }
        out.push({ gid, question: q, options, checked: g.inputs.map(c => c.checked) });
      }
      return out;
    });
  } catch { return; }

  for (const g of groups) {
    if (!g.question) continue;
    for (let i = 0; i < g.options.length; i++) {
      if (g.checked[i]) continue;
      if (!checkboxSelfId(SELF, g.question, g.options[i])) continue;
      const ok = await frame.evaluate(({ sel }) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        if (!el.checked) {
          el.click();
          if (!el.checked) {
            const lab = (el.id && document.querySelector(`label[for="${(window.CSS && CSS.escape) ? CSS.escape(el.id) : el.id}"]`)) || el.closest('label') || el.parentElement;
            if (lab) lab.click();
          }
        }
        return !!el.checked;
      }, { sel: `[data-hl-cb="${g.gid}:${i}"]` }).catch(() => false);
      log(`  ${ok ? '☑' : '☐'} "${g.question.slice(0, 40)}" → ${g.options[i]}${ok ? '' : ' (did not register — verify)'}`);
    }
  }
}

// One frame's fill: extract → (LLM page-fill if useKimi) → deterministic resolve →
// write text/select/radio → comboboxes. Returns the field-id list it saw. Called
// twice per page: pass 1 with the LLM, then a deterministic-only pass 2 (after files
// attach and any resume-parser autofill settles) that tops up fields left empty.
async function fillFrame(frame, useKimi) {
  let fields = [];
  try { fields = await frame.evaluate(extractFieldsInPage); } catch { return []; }
  if (!fields.length) return [];

  let kimiMap = {};
  if (useKimi) {
    try { kimiMap = await kimiFillPage(fields); }
    catch (e) { log(`  ⚠ LLM page fill failed: ${e.message} — using local resolver`); }
  }

  let det = R.resolveAnswers(fields, { cvPath: CTX.cv, coverPath: CTX.cover });
  det = R.mergeIdentity(det, fields);
  R.applyProfileAnswers(det, fields);

  const answers = {};
  for (const f of fields) {
    const k = kimiMap[f.id];
    const fallback = det[f.id] ?? det[f.name];
    // Ring-1 doctrine: for KNOWN fields (identity + classified EEO / work-auth /
    // education / logistics / location) the deterministic FACT wins over the LLM.
    // The model only classifies-from-a-menu and writes essays — it never authors
    // identity. (This is why Ashby name/email blanked before: the LLM fumbled them
    // and overrode the resolver, which actually knew the answer.)
    const cls = R.classifyField(f);
    const detAuthoritative = (cls && cls.desired) || R.isIdentityField(f);
    let val, src;
    if (detAuthoritative && fallback !== undefined && fallback !== '' && !isDecline(fallback)) {
      val = fallback; src = 'local';
    } else if (k !== undefined && k !== '' && !isDecline(k)) {
      val = k; src = 'kimi';
    } else { val = fallback; src = 'local'; }
    const lim = (f.label || '').match(/(\d{2,4})\s*characters?/i);
    if (lim && typeof val === 'string' && val.length > +lim[1]) val = val.slice(0, +lim[1]).trim();
    if (val !== undefined && val !== '' && !isDecline(val)) {
      answers[f.id] = val;
      if (useKimi && (f.type === 'textarea' || (f.label || '').length > 25))
        log(`  ✎[${src}] "${(f.label || f.id).slice(0, 45)}" → ${String(val).slice(0, 55)}`);
    }
  }

  // Detect react-select / ARIA comboboxes UP FRONT. Typing text into these does NOT
  // register (React ignores it) and reverts on blur — so we never setNative them;
  // selectComboboxes() does the real open→filter→click.
  const comboIds = new Set();
  for (const f of fields) {
    if (['select', 'radio', 'checkbox', 'file', 'textarea'].includes(f.type)) continue;
    const v = answers[f.id] ?? answers[f.name];
    if (v == null || v === '') continue;
    const loc = await fieldLoc(frame, f);
    if (!loc) continue;
    const isCombo = await loc.evaluate(el => {
      if (el.tagName === 'SELECT') return false;
      return el.getAttribute('role') === 'combobox' ||
             el.getAttribute('aria-autocomplete') === 'list' ||
             el.getAttribute('aria-haspopup') === 'listbox' ||
             !!el.closest('.select__control,[class*="select__control"],[class*="select-shell"],[class*="combobox"],[role="combobox"]');
    }).catch(() => false);
    if (isCombo) comboIds.add(f.id);
  }

  await frame.evaluate(({ items }) => {
    const setNative = (el, val) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      // React 16+ tracks input value via a hidden _valueTracker. Setting .value
      // directly leaves the tracker stale, so React keeps its OLD (empty) state and
      // validation reports "required field missing" even though the DOM shows the
      // value (the Ashby name/phone bug — fixed by hand-retyping a char). Resetting
      // the tracker to '' makes React detect the change on the input event and sync
      // its state, so submit-validation passes without a manual retype.
      try { if (el._valueTracker) el._valueTracker.setValue(''); } catch {}
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    };
    for (const it of items) {
      if (it.combo) continue; // combobox → handled by selectComboboxes (open→click), never type
      const el = document.querySelector(`[data-hl-fid="${it.hlfid}"]`) ||
                 document.getElementById(it.id) || document.querySelector(`[name="${it.name}"]`);
      if (!el && it.type !== 'radio') continue;
      if (it.type === 'file' || (el && el.tagName === 'INPUT' && el.type === 'file')) continue;
      if (el && el.tagName === 'SELECT') {
        const opt = Array.from(el.options).find(o => o.text.trim() === String(it.value)) ||
                    Array.from(el.options).find(o => o.text.trim().toLowerCase() === String(it.value).toLowerCase());
        if (opt) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); }
      } else if (it.type === 'radio') {
        // Real radio GROUPS are handled by selectChoiceGroups (click-by-label). Here we
        // only match by the value attribute, so skip value="on"/empty (Ashby's) — matching
        // those would click the FIRST radio in the group regardless of the intended option.
        const wantV = String(it.value).toLowerCase();
        if (!wantV || wantV === 'on') continue;
        const radios = Array.from(document.querySelectorAll(`[name="${it.name}"]`));
        const r = radios.find(x => (x.value || '').toLowerCase() === wantV);
        if (r && !r.checked) r.click();
      } else if (!el.value) {
        let v = String(it.value);
        // A <input type=number> (e.g. Ashby "salary expectations") silently rejects a
        // non-numeric value like "$100,000 CAD" and stays blank. Coerce to digits; if
        // there are none, skip rather than fill garbage.
        if (el.type === 'number' || el.inputMode === 'numeric') {
          const d = v.replace(/[^\d.]/g, '');
          if (!d) continue;
          v = d;
        }
        setNative(el, v);
      }
    }
  }, { items: fields.filter(f => (answers[f.id] ?? answers[f.name]) !== undefined)
                      .map(f => ({ id: f.id, name: f.name, hlfid: f.hlfid, type: f.type, value: answers[f.id] ?? answers[f.name], combo: comboIds.has(f.id) })) });

  // Fallback chain for demographic comboboxes (race: Middle Eastern → Two or more
  // races → White) so the picker can try alternates against the LIVE option list
  // when the primary isn't offered (US-EEO forms have no MENA row).
  const altMap = {};
  const demoIds = new Set(); // demographic fields → strict, scope-required matching
  for (const f of fields) {
    const cls = R.classifyField(f);
    if (cls && cls.kind === 'demographic') demoIds.add(f.id);
    if (cls && Array.isArray(cls.fallbacks) && cls.fallbacks.length) {
      const primary = answers[f.id] ?? answers[f.name] ?? cls.desired;
      altMap[f.id] = [primary, ...cls.fallbacks].filter(Boolean);
    }
  }
  await selectComboboxes(frame, fields, answers, altMap, demoIds).catch(() => {});
  await selectChoiceGroups(frame).catch(() => {});
  await selectCheckboxGroups(frame).catch(() => {});

  return fields.map(f => f.id || f.name || '');
}

// Attach resume + cover by PURPOSE, not blind input order. Resume → the first
// file input (works across ATSes). Cover → ONLY a dedicated cover field: a file
// input whose label says "cover", or a click-to-reveal "Attach" button under a
// "Cover Letter" label (Greenhouse → native file chooser). Never the generic
// "Upload anything" slot. No cover field → cover is left off (correct: many
// forms don't ask for one).
async function attachFiles(page) {
  if (CTX.cv && existsSync(CTX.cv)) {
    let resumeDone = false;
    for (const fr of page.frames()) {
      const fi = fr.locator('input[type="file"]').first();
      if (await fi.count().catch(() => 0) === 0) continue;
      if (await fi.setInputFiles(CTX.cv).then(() => true).catch(() => false)) {
        resumeDone = true; log(`  📎 resume attached`);
      }
      break;
    }
    if (!resumeDone) log(`  ⚠ resume not attached — attach by hand`);
  }

  if (!(CTX.cover && existsSync(CTX.cover))) return;
  let coverDone = false;

  // 1) a file input whose surrounding label/context says "cover"
  for (const fr of page.frames()) {
    const found = await fr.evaluate(() => {
      const els = Array.from(document.querySelectorAll('input[type="file"]'));
      for (const el of els) {
        let ctx = ` ${el.getAttribute('aria-label') || ''} ${el.name || ''} ${el.id || ''}`;
        let n = el;
        for (let up = 0; up < 5 && n; up++) { n = n.parentElement; if (n) { const lb = n.querySelector('label,legend,h2,h3,h4,[class*="label"]'); if (lb) ctx += ' ' + lb.textContent; } }
        if (/cover|motivation/i.test(ctx)) { el.setAttribute('data-hl-cover-input', '1'); return true; }
      }
      return false;
    }).catch(() => false);
    if (found) {
      const fi = fr.locator('input[type="file"][data-hl-cover-input="1"]').first();
      if (await fi.setInputFiles(CTX.cover).then(() => true).catch(() => false)) {
        coverDone = true; log(`  📎 cover attached (labelled field)`);
      }
      break;
    }
  }

  // 2) click-to-reveal "Attach" button under a short "Cover Letter" label
  if (!coverDone) {
    const tagged = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label,legend,h2,h3,h4,div,span'))
        .filter(e => { const tx = (e.textContent || '').trim(); return tx.length < 40 && /cover letter/i.test(tx); });
      for (const lbl of labels) {
        let c = lbl.closest('[class*="field"], fieldset, section, div') || lbl.parentElement;
        for (let up = 0; up < 3 && c; up++) {
          const btn = Array.from(c.querySelectorAll('button,[role="button"]')).find(b => /^\s*attach\s*$/i.test(b.textContent || ''));
          if (btn) { btn.setAttribute('data-hl-cover-attach', '1'); return true; }
          c = c.parentElement;
        }
      }
      return false;
    }).catch(() => false);
    if (tagged) {
      const btn = page.locator('[data-hl-cover-attach="1"]').first();
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null),
        btn.click({ timeout: 4000 }).catch(() => {}),
      ]);
      if (chooser && await chooser.setFiles(CTX.cover).then(() => true).catch(() => false)) {
        coverDone = true; log(`  📎 cover attached (Attach button → file chooser)`);
      }
    }
  }

  if (!coverDone) log(`  ⓘ no dedicated cover field — cover left off (fine if the form has none)`);
}

// Fill the CURRENT page forward (auto-advance Next pages) and STOP at submit.
// Returns a short status string. Does NOT close the browser.
async function fillForward(page) {
  const MAX_PAGES = 8;
  const seenSigs = new Set(); // field-id signature per filled page — repeat = loop
  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    log(`\n── page ${pageNum} ──`);
    const pageFieldIds = [];

    // Pass 1 — LLM + deterministic.
    for (const frame of page.frames()) {
      const ids = await fillFrame(frame, true);
      pageFieldIds.push(...ids);
    }

    // Attach resume + cover by dedicated field (see attachFiles): resume → first
    // file input; cover → a labelled cover input or a Greenhouse "Attach" button,
    // never the generic "Upload anything" slot.
    await attachFiles(page);

    // Pass 2 — some ATSes (Ashby "Autofill from resume") parse the uploaded resume
    // and repopulate Name/Email/Phone AFTER our fill, sometimes WIPING a field.
    // Wait for that to settle, then run a deterministic-only top-up: fills any KNOWN
    // field left empty and retries comboboxes (e.g. location). No LLM call here.
    if (CTX.cv || CTX.cover) {
      await page.waitForTimeout(1600);
      log(`  ↻ top-up pass (post-autofill settle)`);
      for (const frame of page.frames()) await fillFrame(frame, false);
    }

    // Loop guard: if we've already filled a page with this exact field set,
    // we're in a re-render loop (validation errors, or a post-submit page that
    // re-shows the form). Never click anything again — hand over.
    const sig = pageFieldIds.filter(Boolean).sort().join('|');
    if (sig && seenSigs.has(sig)) {
      log(`\n⚠ Same form fields seen twice — stopping before clicking anything. Take over manually.`);
      return 'stopped — page repeated (validation loop?), take over manually';
    }
    if (sig) seenSigs.add(sig);

    await page.waitForTimeout(800);
    const btns = page.locator('button, input[type="submit"], input[type="button"], a[role="button"]');
    const n = await btns.count().catch(() => 0);
    let nextBtn = null, submitSeen = false;
    for (let i = 0; i < n; i++) {
      const b = btns.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      const t = ((await b.textContent().catch(() => '')) || (await b.getAttribute('value').catch(() => '')) || '').trim();
      if (!t) continue;
      if (SUBMIT_RE.test(t) || SUBMIT_ALSO_RE.test(t)) { submitSeen = true; }
      else if (NEXT_RE.test(t) && !nextBtn) { nextBtn = b; }
    }

    if (submitSeen) {
      log(`\n🛑 Reached the SUBMIT step. Form is filled — STOPPING for your review.`);
      return 'filled — at SUBMIT step, review every field then submit yourself';
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
    return 'filled — no Next/Submit button found, take over manually';
  }
  return 'filled — reached max pages';
}

// ── command channel ──
function writeJsonAtomic(file, obj) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, file);
}
function readCmd() {
  try { return JSON.parse(readFileSync(CMD, 'utf8')); } catch { return null; }
}

// Portals where a SAVED LOGIN matters → use the persistent .apply-profile
// window so the candidate stays signed in across roles. Everything else
// (Greenhouse/Lever/Ashby/company sites) gets a FRESH ephemeral window per goto:
// same-window ATS state was carrying the PREVIOUS role's resume into the next
// form (Greenhouse "reuse last resume", 2026-06-11), so those start cold every
// time. Workday is a per-company candidate ACCOUNT (one login → many roles in the
// same tenant), so it belongs with the persistent set — a fresh window per role
// would force a re-login on every application (2026-06-16).
const PERSIST_RE = /(^|\.)(indeed|linkedin|glassdoor|ziprecruiter)\.|workday/i;

(async () => {
  mkdirSync(SDIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext('.apply-profile', {
    headless: false, ...(EXE ? { executablePath: EXE } : {}),
    viewport: null,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', ...WIN_ARGS],
  });
  let ppage = ctx.pages()[0] || await ctx.newPage();
  await ppage.goto('about:blank').catch(() => {});
  let page = ppage;          // the ACTIVE page all commands operate on
  let eph = null;            // ephemeral browser for the current direct-ATS role

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const safeUrl = () => { try { return page && !page.isClosed() ? page.url() : '(no page)'; } catch { return '(no page)'; } };

  async function freshWindow() {
    if (eph) await eph.close().catch(() => {});
    eph = await chromium.launch({
      headless: false, ...(EXE ? { executablePath: EXE } : {}),
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', ...WIN_ARGS],
    });
    const ectx = await eph.newContext({ viewport: null });
    page = await ectx.newPage();
    log('  🪟 fresh window for this role (no carried-over ATS state)');
  }

  // If the user closed the active tab: for the persistent window reopen a page;
  // for an ephemeral window fall back to the persistent one (next goto will
  // open a fresh window anyway). If the persistent context is gone too, this
  // throws → caught by caller → clean exit.
  async function ensurePage() {
    if (page && !page.isClosed()) return true;
    if (eph) { await eph.close().catch(() => {}); eph = null; }
    const open = ctx.pages().filter(p => !p.isClosed());
    ppage = open[0] || await ctx.newPage();
    page = ppage;
    return true;
  }

  let lastId = 0;
  // Clear any stale command so we don't replay it on restart.
  const existing = readCmd();
  if (existing && typeof existing.id === 'number') lastId = existing.id;

  const setStatus = (state, lastAction) =>
    writeJsonAtomic(STATUS, { state, url: safeUrl(), lastAction, ts: Date.now() });

  setStatus('ready', 'window launched — position it once; waiting for commands');
  log('\n✅ apply-session ready. One persistent window. Waiting for goto/fill commands.\n');

  while (true) {
    const c = readCmd();
    if (c && typeof c.id === 'number' && c.id > lastId) {
      lastId = c.id;
      try {
        await ensurePage(); // recover if the tab was closed (context still alive)
        if (c.cmd === 'goto') {
          setStatus('navigating', `goto ${c.url}`);
          log(`\n▶ goto ${c.url}`);
          let host = ''; try { host = new URL(c.url).hostname; } catch {}
          if (PERSIST_RE.test(host)) {
            if (eph) { await eph.close().catch(() => {}); eph = null; }
            page = ppage;
          } else {
            await freshWindow();
          }
          await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
          await sleep(1500);
          writeJsonAtomic(OUT, { id: c.id, ok: true, msg: `navigated to ${safeUrl()}` });
          setStatus('idle', `at ${safeUrl()}`);
        } else if (c.cmd === 'fill') {
          // c.jd is a PATH from apply-cmd — read the content; the old code
          // pasted the literal path string into the Kimi prompt as the "JOB".
          let jdText = c.jd || '';
          try { if (jdText && existsSync(jdText)) jdText = readFileSync(jdText, 'utf8').slice(0, 12000); } catch {}
          CTX = { cv: preferTechnical(c.cv || ''), cover: preferTechnical(c.cover || ''), jd: jdText, companyRole: c.companyRole || '' };
          if (/\(technical\)/i.test(CTX.cv) && !/\(technical\)/i.test(c.cv || '')) log(`  ⬆ upgraded to (Technical) package variant`);
          setStatus('filling', `fill: ${CTX.companyRole || safeUrl()}`);
          log(`\n▶ fill — ${CTX.companyRole || safeUrl()}`);
          const msg = await fillForward(page);
          writeJsonAtomic(OUT, { id: c.id, ok: true, msg });
          setStatus('filled', msg);
        } else if (c.cmd === 'status') {
          writeJsonAtomic(OUT, { id: c.id, ok: true, msg: `at ${safeUrl()}` });
        } else if (c.cmd === 'scroll') {
          // Scroll the page so a read-tier screenshot can verify below-the-fold
          // fields. dy = pixels (default 700); dy=0 scrolls back to the top.
          const dy = Number(c.dy ?? 700);
          try {
            if (dy === 0) await page.evaluate(() => window.scrollTo(0, 0));
            else await page.evaluate((y) => window.scrollBy(0, y), dy);
          } catch {}
          await sleep(500);
          writeJsonAtomic(OUT, { id: c.id, ok: true, msg: `scrolled ${dy}` });
        } else if (c.cmd === 'probe') {
          // Diagnostic: open each combobox (optionally filtered by label substring
          // in c.q) and dump its SCOPED options, so we can see exactly what the
          // form offers (and why a match failed) instead of guessing.
          const q = (c.q || '').toLowerCase();
          const out = [];
          for (const frame of page.frames()) {
            let fields = [];
            try { fields = await frame.evaluate(extractFieldsInPage); } catch { continue; }
            for (const f of fields) {
              if (['select', 'radio', 'checkbox', 'file', 'textarea'].includes(f.type)) continue;
              if (q && !`${f.label} ${f.id}`.toLowerCase().includes(q)) continue;
              const loc = await fieldLoc(frame, f);
              if (!loc) continue;
              const isCombo = await loc.evaluate(el => el.tagName !== 'SELECT' && (
                el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list' ||
                el.getAttribute('aria-haspopup') === 'listbox' ||
                !!el.closest('.select__control,[class*="select__control"],[class*="select-shell"],[class*="combobox"],[role="combobox"]')
              )).catch(() => false);
              if (!isCombo) continue;
              await loc.click({ timeout: 2500 }).catch(() => {});
              await frame.waitForTimeout(350);
              const { opts, count, scoped } = await scopedOptions(frame, loc);
              const texts = [];
              for (let i = 0; i < Math.min(count, 30); i++) texts.push(((await opts.nth(i).textContent().catch(() => '')) || '').trim());
              await loc.press('Escape').catch(() => {});
              out.push({ label: (f.label || '').slice(0, 70), id: f.id, scoped, count, options: texts });
            }
          }
          writeJsonAtomic(OUT, { id: c.id, ok: true, msg: JSON.stringify(out, null, 2) });
        } else if (c.cmd === 'set') {
          // No-LLM targeted edit: set ONE field (matched by a label/question substring)
          // to a value. Lets the controller correct any field with ZERO API calls — its
          // own judgment + the real record — covering text/number/select/radio/checkbox.
          const sel = String(c.sel || ''), val = String(c.val ?? '');
          let result = { ok: false, msg: 'no field matched' };
          for (const frame of page.frames()) {
            const r = await frame.evaluate(({ sel, val }) => {
              const nm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
              const want = nm(sel), wantVal = nm(val);
              const esc = (id) => (window.CSS && CSS.escape) ? CSS.escape(id) : id;
              const setNative = (el, v) => {
                const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                try { if (el._valueTracker) el._valueTracker.setValue(''); } catch {}
                Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
              };
              const labelOf = (el) => {
                if (el.id) { const l = document.querySelector(`label[for="${esc(el.id)}"]`); if (l) return l.textContent; }
                const w = el.closest('label'); if (w) return w.textContent;
                const c = el.closest('fieldset,[class*="field"],[class*="question"],li'); return c ? c.textContent : '';
              };
              // 1) text / number / select inputs (matched by their own label)
              for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=file]):not([type=submit]):not([type=button]),textarea,select')) {
                if (!nm(labelOf(el)).includes(want)) continue;
                if (el.tagName === 'SELECT') {
                  const o = Array.from(el.options).find(x => nm(x.text) === wantVal)
                         || Array.from(el.options).find(x => wantVal && (nm(x.text).includes(wantVal) || wantVal.includes(nm(x.text))));
                  if (o) { el.value = o.value; el.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true, kind: 'select', label: nm(labelOf(el)).slice(0, 60), set: o.text.trim() }; }
                  return { ok: false, msg: `select matched but no option ~ "${val}"; has: ${Array.from(el.options).map(x => x.text.trim()).join(' | ').slice(0, 160)}` };
                }
                let v = val; if (el.type === 'number' || el.inputMode === 'numeric') { const d = v.replace(/[^\d.]/g, ''); if (d) v = d; }
                setNative(el, v);
                return { ok: true, kind: 'text', label: nm(labelOf(el)).slice(0, 60), set: v };
              }
              // 2) radio / checkbox: click the option whose OWN label matches val, scoped
              //    by the group question (want) when one is given.
              for (const el of document.querySelectorAll('input[type=radio],input[type=checkbox]')) {
                const optLabel = nm(labelOf(el));
                if (!wantVal || !(optLabel === wantVal || optLabel.includes(wantVal))) continue;
                const grp = el.closest('fieldset,[role=radiogroup],[role=group],[class*="application-question"],[class*="question"],[class*="field"]');
                const q = nm(grp ? grp.textContent : '');
                // When a group question (want) is given, REQUIRE the option's own label or its
                // group context to contain it — never fall through to a blind first-match
                // (that mis-set the 2nd yes/no group from the 1st when no fieldset wrapped them).
                if (want && !optLabel.includes(want) && !q.includes(want)) continue;
                if (!el.checked) { el.click(); if (!el.checked) { const lab = (el.id && document.querySelector(`label[for="${esc(el.id)}"]`)) || el.closest('label') || el.parentElement; if (lab) lab.click(); } }
                return { ok: true, kind: el.type, label: optLabel.slice(0, 60), checked: el.checked };
              }
              return null;   // no match in this frame
            }, { sel, val }).catch(() => null);
            if (r) { result = r; break; }
          }
          writeJsonAtomic(OUT, { id: c.id, ok: !!result.ok, msg: JSON.stringify(result) });
          if (result.ok) log(`  ✎[set] "${sel.slice(0, 30)}" → ${val.slice(0, 40)}`);
        } else if (c.cmd === 'submit') {
          // Click the verified submit button. SEPARATE from fill (which ALWAYS
          // hard-stops): only the controller calls this, AFTER screenshot-verifying
          // the filled form against the user's standard. Returns the post-click URL
          // + page text so the controller can confirm the application landed.
          const before = safeUrl();
          const btns = page.locator('button, input[type="submit"], input[type="button"], a[role="button"]');
          const n = await btns.count().catch(() => 0);
          let clicked = false, label = '';
          for (let i = 0; i < n; i++) {
            const b = btns.nth(i);
            if (!(await b.isVisible().catch(() => false))) continue;
            const t = ((await b.textContent().catch(() => '')) || (await b.getAttribute('value').catch(() => '')) || '').trim();
            if (!t) continue;
            if (SUBMIT_RE.test(t) || SUBMIT_ALSO_RE.test(t)) { label = t; await b.click({ timeout: 10_000 }).catch(() => {}); clicked = true; break; }
          }
          if (!clicked) {
            writeJsonAtomic(OUT, { id: c.id, ok: false, msg: 'no submit button found — submit by hand' });
          } else {
            await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
            await sleep(1500);
            let txt = ''; try { txt = (await page.evaluate(() => document.body ? document.body.innerText : '')).replace(/\n{2,}/g, '\n').trim().slice(0, 500); } catch {}
            writeJsonAtomic(OUT, { id: c.id, ok: true, msg: `clicked "${label}" — now at ${safeUrl()} (was ${before})\n--- page ---\n${txt}` });
            setStatus('submitted', `submitted via "${label}"`);
          }
        } else if (c.cmd === 'read') {
          // Extract the rendered page text — lets the controller read JS-walled
          // portals (JDs, confirmations) that WebFetch can't see.
          let txt = '';
          try { txt = await page.evaluate(() => document.body ? document.body.innerText : ''); } catch {}
          // if the main frame is sparse (content lives in an iframe), grab the richest frame
          if ((txt || '').trim().length < 200) {
            for (const fr of page.frames()) {
              try {
                const ft = await fr.evaluate(() => document.body ? document.body.innerText : '');
                if (ft && ft.length > txt.length) txt = ft;
              } catch {}
            }
          }
          txt = (txt || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 16000);
          writeJsonAtomic(OUT, { id: c.id, ok: true, msg: txt || '(no readable text on page)', url: safeUrl() });
        } else if (c.cmd === 'scanboard') {
          // Sweep a paginated JS job board: harvest listing titles across all pages
          // by auto-clicking the "next" control until it stops advancing.
          const maxPages = Math.min(c.maxPages || 40, 60);
          const titles = [];
          const seen = new Set();
          let lastFirst = null;
          const extract = () => page.evaluate(() => {
            const out = [];
            const text = document.body ? document.body.innerText : '';
            for (const raw of text.split('\n')) {
              const l = raw.trim();
              // listing line pattern: "Title, Company - City"
              if (l.includes(',') && l.length < 160 &&
                  / - (Toronto|Mississauga|Brampton|Etobicoke|Ontario|Markham|Vaughan|Oakville|Milton|Pearson)\s*$/i.test(l)) {
                out.push(l);
              }
            }
            return out;
          });
          let pagesRead = 0;
          for (let i = 0; i < maxPages; i++) {
            const pageTitles = await extract().catch(() => []);
            const first = pageTitles[0] || '';
            if (i > 0 && first === lastFirst) break; // didn't advance
            lastFirst = first;
            pagesRead++;
            for (const t of pageTitles) { if (!seen.has(t)) { seen.add(t); titles.push(t); } }
            const clicked = await page.evaluate(() => {
              const vis = (e) => e && e.offsetParent !== null && !e.disabled && !e.getAttribute('aria-disabled');
              const cands = Array.from(document.querySelectorAll('a,button,[role="button"]'));
              let next = cands.find(e => /next/i.test(e.getAttribute('aria-label') || '') && vis(e));
              if (!next) next = cands.find(e => { const t = (e.textContent || '').trim(); return (t === '›' || t === '»' || t === '>' || /^next\b/i.test(t)) && vis(e); });
              if (next) { next.click(); return true; }
              return false;
            }).catch(() => false);
            if (!clicked) break;
            await sleep(1700);
          }
          writeJsonAtomic(OUT, { id: c.id, ok: true, msg: `PAGES:${pagesRead} TITLES:${titles.length}\n` + titles.join('\n'), url: safeUrl() });
        } else if (c.cmd === 'quit') {
          writeJsonAtomic(OUT, { id: c.id, ok: true, msg: 'closing' });
          break;
        } else {
          writeJsonAtomic(OUT, { id: c.id, ok: false, msg: `unknown cmd: ${c.cmd}` });
        }
      } catch (e) {
        // If the whole window/context was closed, we cannot recover — exit cleanly
        // so it can be relaunched, rather than spinning on a dead context.
        if (/closed/i.test(e.message)) {
          writeJsonAtomic(OUT, { id: c.id, ok: false, msg: 'window closed — relaunch apply-session' });
          setStatus('closed', 'browser window was closed — relaunch needed');
          log(`  ⚠ window/context closed — exiting for relaunch`);
          break;
        }
        writeJsonAtomic(OUT, { id: c.id, ok: false, msg: `error: ${e.message}` });
        setStatus('error', e.message);
        log(`  ⚠ ${e.message}`);
      }
    }
    await sleep(600);
  }

  if (eph) await eph.close().catch(() => {});
  await ctx.close().catch(() => {});
  process.exit(0);
})();
