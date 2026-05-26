#!/usr/bin/env node
// Dump application-form fields for Batch-1 roles. Single browser, sequential.
import { chromium } from 'playwright';
const JOBS = [
  ['#10 PCC Coordinator', 'https://jobs.lever.co/pointclickcare/d558dbcd-16c8-4391-b65a-c3a3ff5f74a9'],
  ['#60 BMO Sr Tech PM', 'https://bmo.wd3.myworkdayjobs.com/External/job/Calgary-AB-CAN/Senior-Tech-Project-Manager_R260004668'],
  ['#13 Forma Impl Associate', 'https://job-boards.greenhouse.io/formaaiinc/jobs/4583013005'],
  ['#57 BMO Agile Delivery', 'https://bmo.wd3.myworkdayjobs.com/External/job/Toronto-ON-CAN/Agile-Delivery-Manager_R260013908'],
  ['#30 Coconut Impl Mgr', 'https://job-boards.greenhouse.io/coconutsoftware/jobs/5996606004'],
  ['#18 CIBC PM IT', 'https://cibc.wd3.myworkdayjobs.com/search/job/Toronto-ON/Project-Manager--IT_2610823'],
  ['#59 BMO Sr Mgr OCM', 'https://bmo.wd3.myworkdayjobs.com/External/job/Toronto-ON-CAN/Senior-Manager-Organizational-Change-Management_R260013617'],
  ['#12 Forma Impl Analyst', 'https://job-boards.greenhouse.io/formaaiinc/jobs/4691850005'],
  ['#3 Cority Sr PM', 'https://jobs.lever.co/cority/a1ee6e78-3525-4d15-98dc-5fa0e09aeda2'],
];
const EXEC = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: EXEC });
const ctx = await browser.newContext();
for (const [label, url] of JOBS) {
  const page = await ctx.newPage();
  let fields = [];
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3500);
    fields = await page.evaluate(() => {
      const out = []; const seen = new Set();
      document.querySelectorAll('input, textarea, select').forEach(el => {
        const type = (el.type || el.tagName).toLowerCase();
        if (['hidden','submit','button','search'].includes(type)) return;
        let label = '';
        if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l) label = l.innerText.trim(); }
        if (!label && el.getAttribute('aria-label')) label = el.getAttribute('aria-label');
        if (!label) { const p = el.closest('label'); if (p) label = p.innerText.trim(); }
        if (!label && el.placeholder) label = '(ph) ' + el.placeholder;
        if (!label) return;
        const req = el.required || el.getAttribute('aria-required') === 'true';
        const key = label + '|' + type; if (seen.has(key)) return; seen.add(key);
        out.push(`${req?'*':' '}${type.padEnd(8)} ${label.replace(/\s+/g,' ').slice(0,95)}`);
      });
      return out;
    });
  } catch (e) { fields = ['ERROR: ' + e.message.split('\n')[0]]; }
  console.log(`\n=== ${label} (${fields.length}) ===\n` + (fields.length ? fields.join('\n') : '(no inline form — Apply button opens separate flow/login)'));
  await page.close();
}
await browser.close();
