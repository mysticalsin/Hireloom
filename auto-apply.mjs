#!/usr/bin/env node
/**
 * auto-apply.mjs — Autonomous Application Engine (Phase 8)
 *
 * Finds assembled packages with "Evaluated" status in applications.md, fills the
 * form via Playwright using LOCAL answer resolution (no LLM): per-role package
 * answers (output/autoapply/{num}.json) + the global Q&A bank (qa-bank.json) +
 * the profile post-processor, then a deterministic pre-submit validator, then
 * submits. Flips tracker to "Applied" ONLY on confirmation, else "Submitted?".
 *
 * Usage:
 *   node auto-apply.mjs                     → process all eligible packages
 *   node auto-apply.mjs --num 062           → process single package
 *   node auto-apply.mjs --dry-run           → fill but do NOT submit
 *   node auto-apply.mjs --threshold 4.0     → min score (default: 4.0; use 0 for all)
 *   node auto-apply.mjs --workers 1         → parallel instances (default: 1)
 *   node auto-apply.mjs --no-review         → skip the deterministic pre-submit validator
 *   node auto-apply.mjs --dump-fields       → (with --dry-run) list every extracted field
 *   node auto-apply.mjs --verbose           → detailed output
 *
 * No API keys required. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH if the Playwright
 * headless-shell isn't installed (points at an existing Chromium binary).
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { chromium } from 'playwright';
import { createResolver, extractFieldsInPage } from './autoapply-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = __dirname;

// ─── Args ─────────────────────────────────────────────────────────────────────

function argValue(flag, def = '') {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : def;
}

const ONLY_NUM  = argValue('--num');
const DRY_RUN   = process.argv.includes('--dry-run');
const NO_REVIEW = process.argv.includes('--no-review');
const VERBOSE   = process.argv.includes('--verbose');
const THRESHOLD = parseFloat(argValue('--threshold', '4.0'));
const WORKERS   = parseInt(argValue('--workers', '1'), 10);
const TODAY     = new Date().toISOString().split('T')[0];

// ─── Paths ─────────────────────────────────────────────────────────────────────

const AUTOAPPLY_DIR = join(PROJECT_DIR, 'output', 'autoapply');   // JSON package format
const SHOTS_DIR    = join(PROJECT_DIR, 'output', 'autoapply', 'screenshots');
const TRACKER_FILE = join(PROJECT_DIR, 'data', 'applications.md');
const LOG_DIR      = join(PROJECT_DIR, 'batch', 'logs');
const LOG_FILE     = join(LOG_DIR, `auto-apply-${TODAY}.log`);
// Resume PDF path is resolved later (after identity loads) — see resolveResumePath()
// Generic fallback used when profile.full_name is missing or no kebab-named PDF exists.
const GENERIC_RESUME_PDF = join(PROJECT_DIR, 'output', 'cv.pdf');
const PROFILE_FILE = join(PROJECT_DIR, 'config', 'profile.yml');
const TMP_DIR      = join(PROJECT_DIR, 'batch', 'tmp');

// ─── Shared resolver (single source of truth — see autoapply-core.mjs) ───────
// All answer-resolution logic lives in autoapply-core.mjs so the CLI and the
// dashboard autopilot behave identically. We destructure what this file needs.
const R = createResolver({ projectDir: PROJECT_DIR });
const CANDIDATE = R.candidate;
const {
  resolveAnswers, mergeIdentity, applyProfileAnswers, validateApplication,
  detectAts, norm,
} = R;

// ─── Resume PDF path (derived from profile, with legacy fallback) ────────────

function kebabCase(s) {
  return String(s).toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-');
}

function resolveResumePath() {
  const fullName = `${CANDIDATE.firstName} ${CANDIDATE.lastName}`.trim();
  const slug = fullName ? kebabCase(fullName) : '';
  const derived = slug ? join(PROJECT_DIR, 'output', `${slug}-cv.pdf`) : '';
  // Prefer the kebab-named PDF if it exists, else the generic fallback, else
  // the derived path (so generate-cv-pdf.mjs writes to the new location next
  // time the user generates one).
  if (derived && existsSync(derived)) return derived;
  if (existsSync(GENERIC_RESUME_PDF)) return GENERIC_RESUME_PDF;
  return derived || GENERIC_RESUME_PDF;
}

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg, level = 'INFO') {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  const prefix = level === 'ERROR' ? '✖ ' : level === 'WARN' ? '⚠ ' : '  ';
  console.log(`${prefix}${msg}`);
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch { /* non-critical */ }
}

function logDetail(num, msg) {
  const ts = new Date().toISOString();
  if (VERBOSE) console.log(`    [${num}] ${msg}`);
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, `apply-${num}-${TODAY}.log`), `[${ts}] ${msg}\n`, 'utf8');
  } catch { /* non-critical */ }
}

// ─── Candidate discovery ──────────────────────────────────────────────────────

function findEvaluatedEntries() {
  if (!existsSync(TRACKER_FILE)) return [];

  const candidates = [];
  for (const line of readFileSync(TRACKER_FILE, 'utf8').split('\n')) {
    if (!line.startsWith('|')) continue;
    // | # | Date | Company | Role | Score | Status | PDF | Report | Notes |
    const cells = line.split('|').map(c => c.trim());
    // cells[0]='' cells[1]=# cells[2]=Date cells[3]=Company cells[4]=Role
    //             cells[5]=Score cells[6]=Status cells[7]=PDF cells[8]=Report
    if (cells.length < 8) continue;
    const num     = cells[1];
    const company = cells[3];
    const role    = cells[4];
    const score   = cells[5];
    const status  = cells[6];
    const report  = cells[8] || '';

    if (!num?.match(/^\d+$/)) continue;
    if (status !== 'Evaluated') continue;

    const scoreNum = parseFloat(score?.replace('/5', '') || '0');
    if (scoreNum < THRESHOLD) continue;

    // Tracker # (cells[1]) is sequential and may not match the package directory
    // when an offer has been re-evaluated. The Report column links to the actual
    // package: [NNN](reports/NNN-...). Extract that number for package lookup;
    // fall back to tracker # if the link is missing or malformed.
    const reportMatch = report.match(/\[(\d+)\]/);
    const packageRaw  = reportMatch ? reportMatch[1] : num;

    candidates.push({
      num:        num.padStart(3, '0'),         // tracker # (for status updates)
      packageNum: packageRaw.padStart(3, '0'),  // package # (for directory lookup)
      company:    company || '',
      role:       role || '',
      score:      scoreNum,
      rawScore:   score || '',
    });
  }
  return candidates;
}

// Package lookup + normalization now live in autoapply-core.mjs (shared).
// Thin wrappers preserve the call sites in applyToPackage.
function findPackage(num) { return R.findPackage(num); }
function readPackage(ref) { return ref?.kind === 'json' ? R.readPackageJson(ref.path) : null; }

// ─── Resume PDF ───────────────────────────────────────────────────────────────

function ensureResumePdf() {
  let pdfPath = resolveResumePath();
  if (existsSync(pdfPath)) return pdfPath;
  log('Generating resume PDF...', 'WARN');
  spawnSync('node', ['generate-cv-pdf.mjs'], { cwd: PROJECT_DIR, encoding: 'utf8', timeout: 60_000 });
  pdfPath = resolveResumePath();
  if (!existsSync(pdfPath)) throw new Error('Could not generate resume PDF');
  return pdfPath;
}

function writeCoverLetterFile(num, content) {
  mkdirSync(TMP_DIR, { recursive: true });
  const path = join(TMP_DIR, `cover-letter-${num}.txt`);
  const plain = content
    .replace(/^#+\s+.+\n/gm, '')          // remove headings
    .replace(/\*\*([^*]+)\*\*/g, '$1')     // bold
    .replace(/\*([^*]+)\*/g, '$1')         // italic
    .replace(/---+\n?/g, '')               // hr
    .trim();
  writeFileSync(path, plain, 'utf8');
  return path;
}

// ─── Guarantee CV/cover uploads ────────────────────────────────────────────────

// After the labeled-field pass, attach the resume (and cover) to any file input
// that's still empty, so an oddly-labeled upload control never silently skips.
async function ensureUploads(page, resumePdf, coverPdf, num) {
  const out = { resume: '', cover: '' };
  try {
    const inputs = page.locator('input[type="file"]');
    const count = await inputs.count();

    // First pass: collect each empty file input with its label/context, so we
    // can resolve ambiguous ("Attach"/"Attach") pairs by ORDER afterwards.
    const empties = [];
    for (let i = 0; i < count; i++) {
      const el = inputs.nth(i);
      const hasFile = await el.evaluate(n => n.files && n.files.length > 0).catch(() => false);
      if (hasFile) continue;
      const ctx = norm(await el.evaluate(n => {
        const lbl = n.id ? document.querySelector(`label[for="${n.id}"]`) : null;
        return `${lbl?.textContent || ''} ${n.name || ''} ${n.id || ''} ${n.getAttribute('aria-label') || ''}`;
      }).catch(() => ''));
      empties.push({ i, el, ctx, isCover: /cover|motivation/.test(ctx), isResume: /resume|cv|curriculum/.test(ctx) });
    }

    const attach = async (el, file, kind, i) => {
      await el.setInputFiles(file).catch(() => {});
      out[kind] = file;
      logDetail(num, `Fallback-attached ${kind} to file input #${i} (${kind === 'cover' ? coverPdf : resumePdf})`);
    };

    // 1) Honor explicitly-labeled inputs first.
    for (const e of empties) {
      if (e.isResume && !out.resume) await attach(e.el, resumePdf, 'resume', e.i);
      else if (e.isCover && coverPdf && !out.cover) await attach(e.el, coverPdf, 'cover', e.i);
    }
    // 2) Fill remaining AMBIGUOUS inputs ("Attach"/"Attach") by order:
    //    resume first, cover next. (Labeled inputs were handled in pass 1.)
    for (const e of empties) {
      if (e.isResume || e.isCover) continue;
      if (!out.resume)                 await attach(e.el, resumePdf, 'resume', e.i);
      else if (coverPdf && !out.cover) await attach(e.el, coverPdf, 'cover', e.i);
    }
  } catch (err) {
    logDetail(num, `ensureUploads error: ${err.message}`);
  }
  return out;
}

// ─── Fill one field ───────────────────────────────────────────────────────────

async function fillField(page, field, value, resumePdf, coverPdf, num) {
  if (!value || value === '') return;

  // Attribute selector avoids needing CSS.escape (which doesn't exist in Node).
  const selector = field.id ? `[id="${field.id}"]` : `[name="${field.name}"]`;

  try {
    if (field.type === 'file') {
      const isResume = /resume|cv|curriculum/i.test(field.label + field.id + field.name);
      const isCL     = /cover.?letter|cover_letter|motivation/i.test(field.label + field.id + field.name);
      if (isResume && value === 'FILE_UPLOAD_RESUME') {
        const el = page.locator(`${selector}, [name="${field.name}"]`).first();
        await el.setInputFiles(resumePdf);
        logDetail(num, `Uploaded resume PDF: ${resumePdf}`);
      } else if (isCL && value === 'FILE_UPLOAD_COVER_LETTER' && coverPdf) {
        const el = page.locator(`${selector}, [name="${field.name}"]`).first();
        await el.setInputFiles(coverPdf);
        logDetail(num, `Uploaded cover letter PDF: ${coverPdf}`);
      }
    } else if (field.type === 'select') {
      const el = page.locator(`${selector}, select[name="${field.name}"]`).first();
      await el.selectOption({ label: value }).catch(() => el.selectOption(value)).catch(() => {});
    } else if (field.type === 'checkbox') {
      if (value === 'CHECK') {
        const el = page.locator(`${selector}`).first();
        const checked = await el.isChecked().catch(() => false);
        if (!checked) await el.check();
      }
    } else if (field.type === 'radio') {
      const radios = page.locator(`[name="${field.name}"]`);
      const count = await radios.count();
      for (let i = 0; i < count; i++) {
        const r = radios.nth(i);
        const v = await r.getAttribute('value').catch(() => '');
        if (v && v.toLowerCase() === String(value).toLowerCase()) {
          await r.check();
          break;
        }
      }
    } else {
      // text, email, tel, number, textarea
      const el = page.locator(`${selector}, [name="${field.name}"]`).first();
      await el.fill(String(value));
    }
  } catch (err) {
    logDetail(num, `Field fill failed [${field.label || field.id}]: ${err.message}`);
  }
}

// ─── Navigate to application form ─────────────────────────────────────────────

async function navigateToForm(page, context, url, ats) {
  // ── ATS-specific direct form URLs ──────────────────────────────────────────
  // Ashby: job listing is /{id}, application form is /{id}/application
  if (ats === 'ashby' && !/\/application$/.test(url)) {
    const formUrl = url.replace(/\/$/, '') + '/application';
    logDetail('nav', `Ashby: navigating directly to application form: ${formUrl}`);
    await page.goto(formUrl, { waitUntil: 'networkidle', timeout: 45_000 });
    await page.waitForTimeout(2000);
    return page;
  }

  // Greenhouse: /jobs/{id} → /jobs/{id}/apply or click Apply
  if (ats === 'greenhouse' && !/\/apply$/.test(url)) {
    const applyUrl = url.replace(/\/$/, '') + '/apply';
    logDetail('nav', `Greenhouse: trying direct apply URL: ${applyUrl}`);
    await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(1500);
    // If that landed on a 404-like page, fall through to button-click
    const hasForm = await page.$('form, [role="form"]') !== null;
    if (hasForm) return page;
    // Fall through to button-click path
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(1500);
  } else {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(1500);
  }

  // ── Generic: look for Apply button and click it ────────────────────────────
  const applySelectors = [
    'a[href*="/applications/new"]',
    'a[href*="?gh_src"]',
    'a:has-text("Apply for this job")',
    'a:has-text("Apply Now")',
    'button:has-text("Apply for this job")',
    'button:has-text("Apply Now")',
    'button:has-text("Apply")',
    '.apply-button',
    '#apply-button',
    '[data-mapped="true"] a',
  ];

  for (const sel of applySelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) {
      const href = await btn.getAttribute('href').catch(() => null);
      logDetail('nav', `Found Apply button [${sel}]${href ? ` → ${href}` : ''}`);

      // Handle new tab
      const [newPage] = await Promise.all([
        context.waitForEvent('page', { timeout: 5_000 }).catch(() => null),
        btn.click({ timeout: 5_000 }).catch(() => {}),
      ]);

      if (newPage) {
        await newPage.waitForLoadState('domcontentloaded');
        await newPage.waitForTimeout(2000);
        return newPage;
      }

      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(2000);
      break;
    }
  }

  return page;
}

// ─── Apply to one package ─────────────────────────────────────────────────────

async function applyToPackage(candidate) {
  const { num, packageNum, company, role, score } = candidate;
  const tag = packageNum === num ? num : `${packageNum}/tracker#${num}`;
  log(`[${tag}] ${company} — ${role} (${score}/5)`);

  // 1. Find package (by report/package number, NOT tracker #)
  const pkgRef = findPackage(packageNum);
  if (!pkgRef) {
    log(`[${tag}] No package (output/autoapply/${parseInt(packageNum, 10)}.json) — skipping`, 'WARN');
    return { num, packageNum, status: 'skipped', reason: 'no package' };
  }

  const pkg = readPackage(pkgRef);
  if (!pkg?.url) {
    log(`[${tag}] No URL in package — skipping`, 'WARN');
    return { num, packageNum, status: 'skipped', reason: 'no url' };
  }

  const ats    = detectAts(pkg.url);
  const salaryNote = pkg.salary ? ` | Salary: ${pkg.salary}` : '';
  const jobCtx = `${company} — ${role} (Score: ${score}/5)${salaryNote}`;
  logDetail(packageNum, `ATS: ${ats} | URL: ${pkg.url}`);

  // 2. Resolve resume PDF — prefer the per-role tailored CV from the package,
  // fall back to the generic resume only if the tailored one is missing.
  let resumePdf = pkg.cvPath && existsSync(pkg.cvPath) ? pkg.cvPath : '';
  if (!resumePdf) {
    try { resumePdf = ensureResumePdf(); } catch (err) {
      log(`[${tag}] Resume PDF unavailable: ${err.message}`, 'ERROR');
      return { num, packageNum, status: 'error', reason: err.message };
    }
    logDetail(packageNum, `No per-role CV at ${pkg.cvPath || '(none)'} — using generic resume ${resumePdf}`);
  } else {
    logDetail(packageNum, `Resume (per-role): ${resumePdf}`);
  }

  // Cover letter: use the per-role cover PDF from the package directly.
  const coverPdf = pkg.coverPath && existsSync(pkg.coverPath) ? pkg.coverPath : '';
  if (coverPdf) logDetail(packageNum, `Cover (per-role): ${coverPdf}`);

  // 3. Launch browser
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  let browser;
  let activePage;

  try {
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });

    const page = await context.newPage();

    // 4. Navigate (handles Apply button + new tab)
    activePage = await navigateToForm(page, context, pkg.url, ats);

    // 5. Check for form
    const hasForm = await activePage.$('form, [role="form"]') !== null;
    if (!hasForm) {
      await browser.close();
      log(`[${tag}] No form found on page — skipping`, 'WARN');
      return { num, packageNum, status: 'skipped', reason: 'no fillable form found' };
    }

    // 6. Extract fields (shared extractor — identical to the dashboard)
    const fields = await activePage.evaluate(extractFieldsInPage);
    if (fields.length === 0) {
      await browser.close();
      log(`[${tag}] No input fields detected — skipping`, 'WARN');
      return { num, packageNum, status: 'skipped', reason: 'no input fields' };
    }

    logDetail(packageNum, `${fields.length} fields: ${fields.slice(0, 5).map(f => f.label || f.id).join(', ')}${fields.length > 5 ? '…' : ''}`);

    // 7. Resolve answers locally (NO LLM): per-role package answers + Q&A bank +
    // role-pitch fallback for open essays. Identity + EEO/education filled below.
    let answers = resolveAnswers(fields, pkg);

    // Hardcoded identity overrides
    answers = mergeIdentity(answers, fields);

    // Profile-driven overrides: fill EEO/work-auth/education/logistics from
    // profile.yml and replace any "Prefer not to say" with the real answer.
    const overrides = applyProfileAnswers(answers, fields, packageNum);
    if (overrides.length) logDetail(packageNum, `Profile overrides: ${overrides.join('; ')}`);

    logDetail(packageNum, `Generated ${Object.keys(answers).length} answers`);

    if (DRY_RUN) {
      log(`[${tag}] DRY RUN — would fill ${fields.length} fields (${Object.keys(answers).length} have values):`);
      for (const [k, v] of Object.entries(answers)) {
        const f = fields.find(f => f.id === k || f.name === k);
        const label = f?.label || k;
        log(`    ${label}: ${String(v).slice(0, 80)}`);
      }
      if (process.argv.includes('--dump-fields')) {
        log(`[${tag}] ALL EXTRACTED FIELDS:`);
        for (const f of fields) {
          const filled = (answers[f.id] ?? answers[f.name]) !== undefined ? ' ✓' : '';
          log(`    [${f.type}]${f.required ? '*' : ''} ${f.label || f.id}${filled}`);
          if (f.options?.length) log(`        opts: ${f.options.slice(0, 14).join(' | ')}`);
        }
      }
      await browser.close();
      return { num, packageNum, status: 'dry-run', company, role, fieldsCount: fields.length };
    }

    // 8. Fill fields
    const filledLog = {};
    for (const field of fields) {
      const value = answers[field.id] ?? answers[field.name];
      if (value === undefined || value === null || value === '') continue;
      await fillField(activePage, field, value, resumePdf, coverPdf, packageNum);
      filledLog[field.label || field.id] = String(value).slice(0, 100);
    }

    // 8b. Guarantee uploads — never leave the CV (or cover) un-attached because a
    // file input wasn't clearly labeled. Attach the resume to the first empty
    // file input, and the cover PDF to the next, as a fallback.
    const uploadResult = await ensureUploads(activePage, resumePdf, coverPdf, packageNum);
    if (uploadResult.resume) filledLog['__resume_uploaded'] = uploadResult.resume;
    if (uploadResult.cover)  filledLog['__cover_uploaded']  = uploadResult.cover;

    // 9. Deterministic pre-submit validation (no LLM): required fields filled,
    // email present, no em-dashes, no lingering "Prefer not to say".
    if (!NO_REVIEW) {
      const review = validateApplication(answers, fields);
      logDetail(packageNum, `Validation: ${review.approved ? 'OK' : `FLAGGED — ${review.reason}`}`);
      if (!review.approved) {
        await browser.close();
        log(`[${tag}] Flagged by validator: ${review.reason}`, 'WARN');
        return { num, packageNum, status: 'flagged', reason: review.reason };
      }
      log(`[${tag}] Validation: OK`);
    }

    // 10. Submit
    const submitSelectors = [
      '#submit_app',
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Submit Application")',
      'button:has-text("Submit")',
      'button:has-text("Send Application")',
      'button:has-text("Apply")',
      '[data-submit="true"]',
    ];

    const urlBeforeSubmit = activePage.url();
    let submitted = false;
    for (const sel of submitSelectors) {
      const btn = activePage.locator(sel).last();
      if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 10_000 });
        await activePage.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
        submitted = true;
        break;
      }
    }

    if (!submitted) {
      await browser.close();
      log(`[${tag}] Submit button not found`, 'WARN');
      return { num, packageNum, status: 'skipped', reason: 'submit button not found' };
    }

    // 11. Verify confirmation — accept either confirmation TEXT or a URL change
    // to a thank-you/confirmation page. Capture a screenshot for the audit trail.
    await activePage.waitForTimeout(2500);
    const bodyText = await activePage.textContent('body').catch(() => '');
    const urlAfterSubmit = activePage.url();
    const textConfirmed = /thank you|thanks for applying|application (received|submitted|complete)|we.ve received|successfully submitted|your application has been|confirmation/i.test(bodyText);
    const urlConfirmed  = urlAfterSubmit !== urlBeforeSubmit
      && /thank|confirm|success|submitted|complete|received/i.test(urlAfterSubmit);
    // A still-present, still-visible submit button usually means submit failed
    // (validation errors). Treat that as NOT confirmed.
    const stillOnForm = await activePage.locator('button[type="submit"], input[type="submit"]').first()
      .isVisible().catch(() => false);
    const confirmed = (textConfirmed || urlConfirmed) && !stillOnForm;

    let shotPath = '';
    try {
      mkdirSync(SHOTS_DIR, { recursive: true });
      shotPath = join(SHOTS_DIR, `${packageNum}-${confirmed ? 'confirmed' : 'unconfirmed'}-${TODAY}.png`);
      await activePage.screenshot({ path: shotPath, fullPage: true });
    } catch { /* screenshot is best-effort */ }

    await browser.close();

    // 12. Update tracker — ONLY flip to Applied when we actually saw confirmation.
    // Unconfirmed submits get the "Submitted?" status so they're retryable and
    // never falsely counted as Applied (the bug from the previous run).
    if (confirmed) {
      updateTrackerStatus(num, 'Applied');
      log(`[${tag}] ✓ Applied → ${company} — ${role} (confirmed)${shotPath ? ` [${shotPath}]` : ''}`);
      return { num, packageNum, status: 'applied', company, role, confirmed: true, shot: shotPath };
    }

    updateTrackerStatus(num, 'Submitted?');
    log(`[${tag}] ⚠ Submitted but UNCONFIRMED → ${company} — ${role} — marked "Submitted?" for manual verify${shotPath ? ` [${shotPath}]` : ''}`, 'WARN');
    return { num, packageNum, status: 'submitted-unconfirmed', company, role, confirmed: false, shot: shotPath };

  } catch (err) {
    try { await browser?.close(); } catch { /* ignore */ }
    log(`[${tag}] Error: ${err.message}`, 'ERROR');
    logDetail(packageNum, `Stack: ${err.stack}`);
    return { num, packageNum, status: 'error', reason: err.message };
  }
}

// ─── Tracker update ───────────────────────────────────────────────────────────

function updateTrackerStatus(num, newStatus) {
  if (!existsSync(TRACKER_FILE)) return;

  const numPadded = num.padStart(3, '0');
  const numInt    = String(parseInt(numPadded, 10));

  const updated = readFileSync(TRACKER_FILE, 'utf8').split('\n').map(line => {
    if (!line.startsWith('|')) return line;
    const cells = line.split('|');
    if (cells.length < 8) return line;
    const rowNum = cells[1]?.trim();
    if (rowNum !== numPadded && rowNum !== numInt) return line;
    // | # | Date | Company | Role | Score | Status | PDF | Report | Notes |
    //   1    2       3        4      5       6        7     8        9
    cells[6] = ` ${newStatus} `;
    return cells.join('|');
  }).join('\n');

  writeFileSync(TRACKER_FILE, updated, 'utf8');
  log(`[${num}] Tracker → ${newStatus}`);
}

// ─── Worker pool ──────────────────────────────────────────────────────────────

async function runPool(items, concurrency, fn) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await fn(items[i], i); }
      catch (err) { results[i] = { error: err.message, item: items[i] }; }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const bar = '─'.repeat(58);
  console.log(`\n┌${bar}┐\n│  Auto-Apply Engine — Phase 8${' '.repeat(29)}│\n└${bar}┘`);
  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE SUBMIT'} | Threshold: ${THRESHOLD}/5 | Workers: ${WORKERS} | Review: ${NO_REVIEW ? 'off' : 'on'}`);

  // Ensure resume PDF is ready upfront
  try { ensureResumePdf(); } catch (err) {
    log(`Resume PDF: ${err.message} (will retry per application)`, 'WARN');
  }

  // Discover candidates
  let candidates = findEvaluatedEntries();

  if (ONLY_NUM) {
    const target = ONLY_NUM.padStart(3, '0');
    // Match on package # (preferred) or tracker # (fallback) so users can pass
    // either "062" (package directory) or "73" (tracker row).
    candidates = candidates.filter(c => c.packageNum === target || c.num === target);
    if (candidates.length === 0) {
      log(`No Evaluated entry found for #${target} above threshold ${THRESHOLD}`);
      return;
    }
  }

  if (candidates.length === 0) {
    log(`No "Evaluated" packages found with score >= ${THRESHOLD}`);
    console.log(JSON.stringify({ status: 'done', applied: 0, skipped: 0, flagged: 0, errors: 0 }));
    return;
  }

  log(`${candidates.length} candidate(s) to process`);

  const results = await runPool(candidates, WORKERS, (c, i) =>
    // Stagger starts to avoid bot detection
    new Promise(r => setTimeout(r, i * 3000)).then(() => applyToPackage(c))
  );

  const applied     = results.filter(r => r?.status === 'applied').length;
  const unconfirmed = results.filter(r => r?.status === 'submitted-unconfirmed').length;
  const skipped     = results.filter(r => r?.status === 'skipped').length;
  const flagged     = results.filter(r => r?.status === 'flagged').length;
  const errors      = results.filter(r => r?.status === 'error' || r?.error).length;
  const dryRuns     = results.filter(r => r?.status === 'dry-run').length;

  console.log(`\n┌${bar}┐\n│  Auto-Apply Summary${' '.repeat(38)}│\n└${bar}┘`);
  log(`Applied: ${applied} | Submitted?: ${unconfirmed} | Skipped: ${skipped} | Flagged: ${flagged} | Errors: ${errors}${dryRuns ? ` | Dry-runs: ${dryRuns}` : ''}`);

  if (unconfirmed > 0) log(`${unconfirmed} submit(s) UNCONFIRMED — marked "Submitted?"; verify via screenshots in output/autoapply/screenshots/`, 'WARN');
  if (flagged > 0) log(`${flagged} application(s) flagged by AI review — check batch/logs/apply-*-${TODAY}.log`, 'WARN');

  console.log(JSON.stringify({ status: 'done', applied, unconfirmed, skipped, flagged, errors, dryRuns }));
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
