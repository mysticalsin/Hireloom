#!/usr/bin/env node
// Batch-2: liveness + full JD fetch. Single browser, sequential.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const JOBS = [
  ['017-aritzia-pmo-sr-pm', 'https://aritzia.wd3.myworkdayjobs.com/External/job/Support-Office-Vancouver/Project-Management-Office---Senior-Project-Manager-Manager--Business-Initiatives_R0022257-1'],
  ['001-league-tech-delivery-pm', 'https://job-boards.greenhouse.io/leagueinc/jobs/5745820004'],
  ['020-canonical-jr-pm', 'https://job-boards.greenhouse.io/canonical/jobs/5861481'],
  ['062-lightspeed-cust-impl', 'https://jobs.ashbyhq.com/lightspeedhq/34be175a-57be-41c3-981f-f11741647d90'],
  ['007-miovision-tech-pm', 'https://jobs.ashbyhq.com/miovision/536a1329-77dd-4d2d-ad77-b6e0c9c2f007'],
  ['045-pcc-sr-pm', 'https://jobs.lever.co/pointclickcare/37a3c394-e5e0-45e1-ba80-964423777f9c'],
  ['063-mercury-sr-tpm', 'https://job-boards.greenhouse.io/mercury/jobs/5856800004'],
  ['067-1password-impl-onboarding', 'https://jobs.ashbyhq.com/1password/c1002e41-2b98-43b4-9e21-a082abee2b32'],
  ['008-lightspeed-transformation', 'https://jobs.ashbyhq.com/lightspeedhq/8a32d1fd-5456-4541-a46c-3525a354af42'],
];

mkdirSync('jds', { recursive: true });
const EXEC = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const CLOSED = /(no longer (accepting|available|open)|position (has been )?filled|job (is )?closed|posting (has )?expired|not found|this (job|posting) is no longer|isn['’]t accepting)/i;
const browser = await chromium.launch({ executablePath: EXEC });
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' });

for (const [slug, url] of JOBS) {
  const page = await ctx.newPage();
  let title='', text='', verdict='UNKNOWN';
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const code = resp ? resp.status() : 0;
    await page.waitForTimeout(4000);
    title = await page.title();
    text = await page.evaluate(() => document.body ? document.body.innerText : '');
    if (code >= 400) verdict = `CLOSED? HTTP ${code}`;
    else if (CLOSED.test(text)) verdict = `CLOSED ("${(text.match(CLOSED)||[''])[0]}")`;
    else if (text.length < 600) verdict = `THIN (${text.length} chars)`;
    else verdict = `LIVE (${text.length} chars)`;
  } catch (e) { verdict = 'ERROR: ' + e.message.split('\n')[0]; }
  writeFileSync(`jds/batch2-${slug}.md`, `# ${slug}\nURL: ${url}\nTitle: ${title}\n\n${text}\n`);
  console.log(`${verdict.padEnd(22)} ${slug}  "${title.slice(0,46)}"`);
  await page.close();
}
await browser.close();
