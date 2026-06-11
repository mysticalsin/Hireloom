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
import { createResolver, extractFieldsInPage, isDecline } from './autoapply-core.mjs';

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

const log = (...a) => console.log(...a);
const R = createResolver({ projectDir: PROJECT_DIR });
const CAND = R.candidate;
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

const NEXT_RE   = /^(next|continue|save (and|&) continue|proceed|review|apply now|apply|start application|get started|begin)\b/i;
const SUBMIT_RE = /^(submit|submit application|send application|finish|complete application)\b/i;

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
      await loc.fill('').catch(() => {});
      await loc.pressSequentially(want.slice(0, 40), { delay: 15 }).catch(() => {});
      await frame.waitForTimeout(450);
      opts = frame.locator(optSel);
    }
    const oc = await opts.count().catch(() => 0);
    if (oc === 0) { await loc.press('Escape').catch(() => {}); continue; }

    const wl = want.toLowerCase();
    let clicked = false;
    const texts = [];
    for (let i = 0; i < oc; i++) texts.push(((await opts.nth(i).textContent().catch(() => '')) || '').trim());
    let idx = texts.findIndex(t => t.toLowerCase() === wl);
    if (idx < 0) idx = texts.findIndex(t => t && (t.toLowerCase().includes(wl) || wl.includes(t.toLowerCase())));
    if (idx >= 0) { await opts.nth(idx).click({ timeout: 2500 }).catch(() => {}); clicked = true; }
    else { await loc.press('Enter').catch(() => {}); }

    await frame.waitForTimeout(200);
    log(`  ▾ dropdown "${(f.label || f.id).slice(0, 35)}" → ${clicked ? `clicked "${want.slice(0, 30)}"` : 'Enter (highlighted)'}`);
  }
}

// Fill the CURRENT page forward (auto-advance Next pages) and STOP at submit.
// Returns a short status string. Does NOT close the browser.
async function fillForward(page) {
  const MAX_PAGES = 8;
  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    log(`\n── page ${pageNum} ──`);

    for (const frame of page.frames()) {
      let fields = [];
      try { fields = await frame.evaluate(extractFieldsInPage); } catch { continue; }
      if (!fields.length) continue;

      let kimiMap = {};
      try { kimiMap = await kimiFillPage(fields); }
      catch (e) { log(`  ⚠ Kimi page fill failed: ${e.message} — falling back to local resolver`); }

      let det = R.resolveAnswers(fields, { cvPath: CTX.cv, coverPath: CTX.cover });
      det = R.mergeIdentity(det, fields);
      R.applyProfileAnswers(det, fields);

      const answers = {};
      for (const f of fields) {
        const k = kimiMap[f.id];
        const fallback = det[f.id] ?? det[f.name];
        let val = (k !== undefined && k !== '' && !isDecline(k)) ? k : fallback;
        const lim = (f.label || '').match(/(\d{2,4})\s*characters?/i);
        if (lim && typeof val === 'string' && val.length > +lim[1]) val = val.slice(0, +lim[1]).trim();
        if (val !== undefined && val !== '' && !isDecline(val)) {
          answers[f.id] = val;
          const src = (k !== undefined && k !== '' && !isDecline(k)) ? 'kimi' : 'local';
          if (f.type === 'textarea' || (f.label || '').length > 25)
            log(`  ✎[${src}] "${(f.label || f.id).slice(0, 45)}" → ${String(val).slice(0, 55)}`);
        }
      }

      // Detect react-select / ARIA comboboxes UP FRONT. Typing text into these
      // does NOT register (React ignores it) and the value reverts to "Select..."
      // on blur — so we must NOT setNative into them. We leave them entirely to
      // selectComboboxes(), which does the real open→filter→click.
      const comboIds = new Set();
      for (const f of fields) {
        if (['select', 'radio', 'checkbox', 'file', 'textarea'].includes(f.type)) continue;
        const v = answers[f.id] ?? answers[f.name];
        if (v == null || v === '') continue;
        const sel = `[id="${String(f.id).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
        const loc = frame.locator(sel).first();
        if (await loc.count().catch(() => 0) === 0) continue;
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
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        for (const it of items) {
          if (it.combo) continue; // combobox → handled by selectComboboxes (open→click), never type
          const el = document.getElementById(it.id) || document.querySelector(`[name="${it.name}"]`) || document.querySelector(`[id="${it.id}"]`);
          if (!el && it.type !== 'radio') continue;
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
                          .map(f => ({ id: f.id, name: f.name, type: f.type, value: answers[f.id] ?? answers[f.name], combo: comboIds.has(f.id) })) });

      await selectComboboxes(frame, fields, answers).catch(() => {});
    }

    // attach CV + cover to empty file inputs (first → resume, next → cover)
    const fileInputs = page.locator('input[type="file"]');
    const fc = await fileInputs.count().catch(() => 0);
    let attached = 0;
    for (let i = 0; i < fc; i++) {
      const fi = fileInputs.nth(i);
      const val = await fi.inputValue().catch(() => '');
      if (val) continue;
      const f = attached === 0 ? CTX.cv : CTX.cover;
      if (f && existsSync(f)) { await fi.setInputFiles(f).catch(() => {}); attached++; }
    }
    if (attached) log(`  📎 attached ${attached} file(s)`);

    await page.waitForTimeout(800);
    const btns = page.locator('button, input[type="submit"], input[type="button"], a[role="button"]');
    const n = await btns.count().catch(() => 0);
    let nextBtn = null, submitSeen = false;
    for (let i = 0; i < n; i++) {
      const b = btns.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      const t = ((await b.textContent().catch(() => '')) || (await b.getAttribute('value').catch(() => '')) || '').trim();
      if (!t) continue;
      if (SUBMIT_RE.test(t)) { submitSeen = true; }
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

(async () => {
  mkdirSync(SDIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext('.apply-profile', {
    headless: false, ...(EXE ? { executablePath: EXE } : {}),
    viewport: null,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
  });
  let page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('about:blank').catch(() => {});

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const safeUrl = () => { try { return page && !page.isClosed() ? page.url() : '(no page)'; } catch { return '(no page)'; } };
  // If the user closed the tab but the window/context is still alive, reopen a page.
  // If the whole context is gone (window closed), this throws → caught by caller → clean exit.
  async function ensurePage() {
    if (page && !page.isClosed()) return true;
    const open = ctx.pages().filter(p => !p.isClosed());
    page = open[0] || await ctx.newPage();
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
          await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
          await sleep(1500);
          writeJsonAtomic(OUT, { id: c.id, ok: true, msg: `navigated to ${safeUrl()}` });
          setStatus('idle', `at ${safeUrl()}`);
        } else if (c.cmd === 'fill') {
          CTX = { cv: c.cv || '', cover: c.cover || '', jd: c.jd || '', companyRole: c.companyRole || '' };
          setStatus('filling', `fill: ${CTX.companyRole || safeUrl()}`);
          log(`\n▶ fill — ${CTX.companyRole || safeUrl()}`);
          const msg = await fillForward(page);
          writeJsonAtomic(OUT, { id: c.id, ok: true, msg });
          setStatus('filled', msg);
        } else if (c.cmd === 'status') {
          writeJsonAtomic(OUT, { id: c.id, ok: true, msg: `at ${safeUrl()}` });
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

  await ctx.close().catch(() => {});
  process.exit(0);
})();
