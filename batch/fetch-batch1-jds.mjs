#!/usr/bin/env node
// Fetch full JD text for Batch-1 roles (Coconut #61 already done). Single browser, sequential.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const JOBS = [
  ['010-pointclickcare-coordinator', 'https://jobs.lever.co/pointclickcare/d558dbcd-16c8-4391-b65a-c3a3ff5f74a9'],
  ['060-bmo-sr-tech-pm', 'https://bmo.wd3.myworkdayjobs.com/External/job/Calgary-AB-CAN/Senior-Tech-Project-Manager_R260004668'],
  ['013-forma-impl-associate', 'https://job-boards.greenhouse.io/formaaiinc/jobs/4583013005'],
  ['057-bmo-agile-delivery-mgr', 'https://bmo.wd3.myworkdayjobs.com/External/job/Toronto-ON-CAN/Agile-Delivery-Manager_R260013908'],
  ['030-coconut-impl-mgr', 'https://job-boards.greenhouse.io/coconutsoftware/jobs/5996606004'],
  ['018-cibc-pm-it', 'https://cibc.wd3.myworkdayjobs.com/search/job/Toronto-ON/Project-Manager--IT_2610823'],
  ['059-bmo-sr-mgr-ocm', 'https://bmo.wd3.myworkdayjobs.com/External/job/Toronto-ON-CAN/Senior-Manager-Organizational-Change-Management_R260013617'],
  ['012-forma-impl-analyst', 'https://job-boards.greenhouse.io/formaaiinc/jobs/4691850005'],
  ['003-cority-sr-pm', 'https://jobs.lever.co/cority/a1ee6e78-3525-4d15-98dc-5fa0e09aeda2'],
];

mkdirSync('jds', { recursive: true });
const EXEC = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: EXEC });
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' });

for (const [slug, url] of JOBS) {
  const page = await ctx.newPage();
  let title = '', text = '';
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000);
    title = await page.title();
    text = await page.evaluate(() => document.body ? document.body.innerText : '');
  } catch (e) { text = 'ERROR: ' + e.message.split('\n')[0]; }
  writeFileSync(`jds/batch1-${slug}.md`, `# ${slug}\nURL: ${url}\nTitle: ${title}\n\n${text}\n`);
  console.log(`${slug.padEnd(34)} ${text.length} chars  "${title.slice(0,50)}"`);
  await page.close();
}
await browser.close();
