#!/usr/bin/env node
// One-off pipeline JD extractor — single browser, sequential (respects no-parallel-Playwright rule).
// Dumps rendered text to jds/pipeline-{n}-{slug}.md and prints a JSON summary per URL.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const JOBS = [
  ['lightspeed-strategic-finance', 'https://jobs.ashbyhq.com/lightspeedhq/665b18e9-d46e-4815-b58c-6fd63cf4e05c'],
  ['achievers-csm-1', 'https://jobs.lever.co/achievers/7815541c-65cb-427d-851c-59f89e9e8ae4'],
  ['tr-product-manager-mx', 'https://thomsonreuters.wd5.myworkdayjobs.com/External_Career_Site/job/Mexico-Mexico-City/Product-Manager_JREQ200141'],
  ['tr-csm-my', 'https://thomsonreuters.wd5.myworkdayjobs.com/External_Career_Site/job/Malaysia-Kuala-Lumpur-Wilayah-Persekutuan-Kuala-Lumpur/Customer-Success-Manager_JREQ200479'],
  ['tr-apm-us', 'https://thomsonreuters.wd5.myworkdayjobs.com/External_Career_Site/job/United-States-of-America-Eagan-Minnesota/Associate-Product-Manager_JREQ200222'],
  ['tr-impl-specialist-pl', 'https://thomsonreuters.wd5.myworkdayjobs.com/External_Career_Site/job/Poland-Gdansk/Implementation-Specialist_JREQ199169'],
  ['tr-client-pm-es', 'https://thomsonreuters.wd5.myworkdayjobs.com/External_Career_Site/job/Spain-Madrid-Madrid/Client-Project-Manager_JREQ200098'],
  ['tr-data-governance-in', 'https://thomsonreuters.wd5.myworkdayjobs.com/External_Career_Site/job/India-Bengaluru-Karnataka/Lead-Data-Governance---Quality-Analyst_JREQ198991'],
  ['td-bizops-support-iii', 'https://td.wd3.myworkdayjobs.com/TD_Bank_Careers/job/Montral-Qubec/Business-Operations-Support-Representative-III_R_1485809-1'],
];

mkdirSync('jds', { recursive: true });
// Use the already-installed full chromium directly — the headless-shell package
// download keeps failing to finalize (stale cache lock), and we don't need it.
const EXEC = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: EXEC });
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' });
const results = [];

for (const [slug, url] of JOBS) {
  const page = await ctx.newPage();
  let title = '', text = '', applyBtn = false, status = 'ok', err = '';
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    status = resp ? String(resp.status()) : 'no-response';
    await page.waitForTimeout(4000); // let SPA hydrate
    title = await page.title();
    text = await page.evaluate(() => document.body ? document.body.innerText : '');
    applyBtn = /\bapply\b/i.test(text) || (await page.locator('text=/apply/i').count()) > 0;
  } catch (e) {
    err = e.message.split('\n')[0];
    status = 'error';
  }
  const file = `jds/pipeline-${slug}.md`;
  writeFileSync(file, `# ${slug}\nURL: ${url}\nHTTP: ${status}\nTitle: ${title}\n\n${text}\n`);
  results.push({ slug, status, httpTitle: title, len: text.length, applyBtn, err, file });
  await page.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
