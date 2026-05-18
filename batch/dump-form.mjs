#!/usr/bin/env node
// Dump the application form fields for a Greenhouse/Lever/Workday posting.
import { chromium } from 'playwright';
const url = process.argv[2];
const EXEC = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: EXEC });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(4000);
// Greenhouse embeds the form on the job page or links to "Apply". Try to reveal it.
const fields = await page.evaluate(() => {
  const out = [];
  const seen = new Set();
  document.querySelectorAll('input, textarea, select').forEach(el => {
    const type = (el.type || el.tagName).toLowerCase();
    if (['hidden','submit','button'].includes(type)) return;
    // find a label
    let label = '';
    if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l) label = l.innerText.trim(); }
    if (!label && el.getAttribute('aria-label')) label = el.getAttribute('aria-label');
    if (!label && el.placeholder) label = '(placeholder) ' + el.placeholder;
    if (!label) { const p = el.closest('label'); if (p) label = p.innerText.trim(); }
    const req = el.required || el.getAttribute('aria-required') === 'true';
    let opts = '';
    if (el.tagName.toLowerCase() === 'select') opts = ' [' + [...el.options].map(o=>o.text.trim()).filter(Boolean).slice(0,12).join(' / ') + ']';
    const key = label + '|' + type;
    if (seen.has(key) || !label) return; seen.add(key);
    out.push(`${req?'* ':'  '}${type.padEnd(9)} ${label.replace(/\s+/g,' ').slice(0,90)}${opts}`);
  });
  return out;
});
console.log(`FORM FIELDS (${fields.length}) @ ${url}\n` + (fields.length ? fields.join('\n') : '(no visible form fields — likely an "Apply" button that opens a separate form/login)'));
await browser.close();
