#!/usr/bin/env node
/**
 * scrape-forms.mjs — Form Field Harvester
 *
 * Navigates each package's live application form and dumps every field
 * (label, type, options, required) to output/autoapply/fields/{num}.json,
 * flagging live vs. dead postings. This is the input for pre-generating
 * tailored answers (so the auto-applier needs no LLM at submit time).
 *
 * Nav + extraction mirror auto-apply.mjs so field ids/labels line up exactly.
 *
 * Usage:
 *   node engine/scan/scrape-forms.mjs                 → all packages in output/autoapply/
 *   node engine/scan/scrape-forms.mjs --num 15        → single package
 *   node engine/scan/scrape-forms.mjs --workers 3     → concurrency (default 3)
 *   node engine/scan/scrape-forms.mjs --only-missing  → skip packages already scraped
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTOAPPLY_DIR = join(__dirname, '..', '..', 'output', 'autoapply');
const FIELDS_DIR    = join(AUTOAPPLY_DIR, 'fields');

const argValue = (flag, def = '') => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
};
const ONLY_NUM     = argValue('--num');
const WORKERS      = parseInt(argValue('--workers', '3'), 10);
const ONLY_MISSING = process.argv.includes('--only-missing');
const EXEC_PATH    = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

// ─── ATS detection (mirror of auto-apply.mjs) ──────────────────────────────────
function detectAts(url) {
  if (!url) return 'unknown';
  if (/greenhouse\.io/i.test(url))           return 'greenhouse';
  if (/ashbyhq\.com/i.test(url))             return 'ashby';
  if (/lever\.co/i.test(url))                return 'lever';
  if (/workday\.com|workdayjobs/i.test(url)) return 'workday';
  if (/smartrecruiters/i.test(url))          return 'smartrecruiters';
  return 'generic';
}

// ─── Navigate to the application form (mirror of auto-apply.mjs) ────────────────
async function navigateToForm(page, context, url, ats) {
  if (ats === 'ashby' && !/\/application$/.test(url)) {
    const formUrl = url.replace(/\/$/, '') + '/application';
    await page.goto(formUrl, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    return page;
  }
  if (ats === 'greenhouse' && !/\/apply$/.test(url)) {
    const applyUrl = url.replace(/\/$/, '') + '/apply';
    await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    if (await page.$('form, [role="form"]')) return page;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  } else {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  const applySelectors = [
    'a[href*="/applications/new"]', 'a[href*="?gh_src"]',
    'a:has-text("Apply for this job")', 'a:has-text("Apply Now")',
    'button:has-text("Apply for this job")', 'button:has-text("Apply Now")',
    'button:has-text("Apply")', '.apply-button', '#apply-button', '[data-mapped="true"] a',
  ];
  for (const sel of applySelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) {
      const [newPage] = await Promise.all([
        context.waitForEvent('page', { timeout: 5_000 }).catch(() => null),
        btn.click({ timeout: 5_000 }).catch(() => {}),
      ]);
      if (newPage) {
        await newPage.waitForLoadState('domcontentloaded').catch(() => {});
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

// ─── Field extractor (mirror of auto-apply.mjs) ─────────────────────────────────
async function extractFields(page) {
  return page.evaluate(() => {
    const fields = [];
    const seen = new Set();
    const findLabel = (el) => {
      if (el.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
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
  });
}

// ─── Open-question classifier ───────────────────────────────────────────────────
// A field needs a *written* answer only if it's free text/textarea AND not one of
// the deterministic categories (identity, EEO, education, work-auth, logistics).
const DETERMINISTIC = /first name|last name|full name|email|phone|linkedin|github|website|portfolio|address|city|country|state|province|postal|zip|gender|sex\b|race|ethnic|hispanic|latino|veteran|disab|transgender|orientation|pronoun|authoriz|legally|eligible to work|right to work|work permit|sponsor|school|university|college|institution|degree|discipline|major|field of study|18 years|over 18|relocat|notice|start date|availability|background check|consent|criminal|convict|how did you hear|resume|cv\b|cover|attach|salary|compensation|pay expectation/i;

function isOpenQuestion(f) {
  if (f.type !== 'text' && f.type !== 'textarea') return false;
  const t = `${f.label} ${f.id} ${f.name}`;
  if (DETERMINISTIC.test(t)) return false;
  // Needs a real prompt to be worth answering.
  return (f.label || '').length > 12;
}

// ─── Scrape one package ─────────────────────────────────────────────────────────
async function scrapeOne(pkgPath) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const num = pkg.num;
  const out = {
    num, company: pkg.company, role: pkg.role, url: pkg.url,
    ats: detectAts(pkg.url), scrapedAt: new Date().toISOString(),
    live: false, fields: [], openQuestions: [], note: '',
  };
  if (!pkg.url) { out.note = 'no url in package'; return out; }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true, ...(EXEC_PATH ? { executablePath: EXEC_PATH } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const active = await navigateToForm(page, context, pkg.url, out.ats);
    out.finalUrl = active.url();
    const hasForm = await active.$('form, [role="form"]') !== null;
    const fields = hasForm ? await extractFields(active) : [];
    out.fields = fields;
    out.openQuestions = fields.filter(isOpenQuestion).map(f => ({ id: f.id, label: f.label, required: f.required, type: f.type }));
    out.live = fields.length > 0;
    if (!out.live) out.note = hasForm ? 'form present but no fields' : 'no form (closed/403/expired)';
  } catch (err) {
    out.note = `error: ${err.message}`;
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
  }
  return out;
}

// ─── Pool ────────────────────────────────────────────────────────────────────────
async function runPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await fn(items[i], i); }
      catch (e) { results[i] = { error: e.message }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────────
async function main() {
  mkdirSync(FIELDS_DIR, { recursive: true });
  let pkgs = readdirSync(AUTOAPPLY_DIR)
    .filter(f => /^\d+\.json$/.test(f))
    .map(f => join(AUTOAPPLY_DIR, f))
    .sort((a, b) => parseInt(a.match(/(\d+)\.json$/)[1]) - parseInt(b.match(/(\d+)\.json$/)[1]));

  if (ONLY_NUM) {
    const n = String(parseInt(ONLY_NUM, 10));
    pkgs = pkgs.filter(p => p.endsWith(`/${n}.json`) || p.endsWith(`/${ONLY_NUM}.json`));
  }
  if (ONLY_MISSING) {
    pkgs = pkgs.filter(p => {
      const n = p.match(/(\d+)\.json$/)[1];
      return !existsSync(join(FIELDS_DIR, `${n}.json`));
    });
  }

  console.log(`Scraping ${pkgs.length} form(s) with ${WORKERS} worker(s)...`);
  let done = 0;
  const results = await runPool(pkgs, WORKERS, async (p) => {
    const res = await scrapeOne(p);
    writeFileSync(join(FIELDS_DIR, `${res.num}.json`), JSON.stringify(res, null, 2));
    done++;
    const flag = res.live ? `✓ ${res.fields.length} fields, ${res.openQuestions.length} open-Q` : `✗ ${res.note}`;
    console.log(`  [${done}/${pkgs.length}] #${res.num} ${res.company} — ${flag}`);
    return res;
  });

  const live = results.filter(r => r?.live).length;
  const dead = results.length - live;
  const totalOpenQ = results.reduce((s, r) => s + (r?.openQuestions?.length || 0), 0);
  console.log(`\nDone. Live: ${live} | Dead: ${dead} | Total open-ended questions: ${totalOpenQ}`);
  console.log(JSON.stringify({ status: 'done', live, dead, totalOpenQ }));
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
