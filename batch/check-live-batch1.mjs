#!/usr/bin/env node
// Liveness check for Batch-1 apply candidates. Single browser, sequential.
import { chromium } from 'playwright';

const JOBS = [
  ['#61 Coconut — Sr Implementation Mgr', 'https://job-boards.greenhouse.io/coconutsoftware/jobs/5996587004'],
  ['#10 PointClickCare — Project Coordinator (contract)', 'https://jobs.lever.co/pointclickcare/d558dbcd-16c8-4391-b65a-c3a3ff5f74a9'],
  ['#60 BMO — Senior Tech Project Manager', 'https://bmo.wd3.myworkdayjobs.com/External/job/Calgary-AB-CAN/Senior-Tech-Project-Manager_R260004668'],
  ['#13 Forma.ai — Implementation Associate', 'https://job-boards.greenhouse.io/formaaiinc/jobs/4583013005'],
  ['#57 BMO — Agile Delivery Manager', 'https://bmo.wd3.myworkdayjobs.com/External/job/Toronto-ON-CAN/Agile-Delivery-Manager_R260013908'],
  ['#30 Coconut — Implementation Manager', 'https://job-boards.greenhouse.io/coconutsoftware/jobs/5996606004'],
  ['#18 CIBC — Project Manager, IT', 'https://cibc.wd3.myworkdayjobs.com/search/job/Toronto-ON/Project-Manager--IT_2610823'],
  ['#59 BMO — Sr Mgr, Org Change Mgmt', 'https://bmo.wd3.myworkdayjobs.com/External/job/Toronto-ON-CAN/Senior-Manager-Organizational-Change-Management_R260013617'],
  ['#12 Forma.ai — Implementation Analyst', 'https://job-boards.greenhouse.io/formaaiinc/jobs/4691850005'],
  ['#3 Cority — Senior Project Manager', 'https://jobs.lever.co/cority/a1ee6e78-3525-4d15-98dc-5fa0e09aeda2'],
  ['#17 Aritzia — Sr PM / Mgr Business Initiatives', 'https://aritzia.wd3.myworkdayjobs.com/External/job/Support-Office-Vancouver/Project-Management-Office---Senior-Project-Manager-Manager--Business-Initiatives_R0022257-1'],
];

const EXEC = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: EXEC });
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' });
const CLOSED = /(no longer (accepting|available)|position (has been )?filled|job (is )?closed|posting (has )?expired|not found|404|this job is no longer|requisition is closed)/i;

for (const [label, url] of JOBS) {
  const page = await ctx.newPage();
  let verdict = 'UNKNOWN', detail = '';
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const code = resp ? resp.status() : 0;
    await page.waitForTimeout(3500);
    const text = await page.evaluate(() => document.body ? document.body.innerText : '');
    const title = await page.title();
    if (code >= 400) { verdict = 'CLOSED?'; detail = `HTTP ${code}`; }
    else if (CLOSED.test(text)) { verdict = 'CLOSED'; detail = (text.match(CLOSED) || [''])[0]; }
    else if (text.length < 500) { verdict = 'THIN'; detail = `only ${text.length} chars (JS?)`; }
    else { verdict = 'LIVE'; detail = `HTTP ${code}, ${text.length} chars`; }
    detail += ` | "${title.slice(0,60)}"`;
  } catch (e) { verdict = 'ERROR'; detail = e.message.split('\n')[0]; }
  console.log(`${verdict.padEnd(8)} ${label}\n         ${detail}`);
  await page.close();
}
await browser.close();
