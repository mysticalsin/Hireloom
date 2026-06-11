#!/usr/bin/env node
// render-breaktail.mjs — render a one-role CV (+ cover) from a content JSON using the
// Kimi-style engine (batch/tailor-engine.mjs: timeline layout, single-page tightening).
// Usage: node engine/render/render-breaktail.mjs "<content.json>" "<outDir>" "<baseName>" [breaktail]
//   breaktail = force Education + Certs + Competencies all onto page 2 (avoids an
//               orphaned Competencies section when the tail straddles the page break).
import { renderCoverPdf, buildHtml, normalizeContent } from '../batch/tailor-engine.mjs';
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'fs';

const [,, jsonPath, outDir, baseName, opt] = process.argv;
if (!jsonPath || !outDir || !baseName) {
  console.error('Usage: node engine/render/render-breaktail.mjs "<content.json>" "<outDir>" "<baseName>" [breaktail]');
  process.exit(1);
}
const breakTail = opt === 'breaktail';
const c = normalizeContent(JSON.parse(readFileSync(jsonPath, 'utf8')));
mkdirSync(outDir, { recursive: true });

let html = buildHtml(c);
if (breakTail) {
  // push the Education/Certs (two-col) block — and the Competencies that follow — to page 2
  html = html.replace('<div class="two-col">', '<div class="pagebreak"></div><div class="two-col">');
}

const EXE = process.env.PW_CHROMIUM_PATH || '';
const browser = await chromium.launch({ headless: true, ...(EXE ? { executablePath: EXE } : {}) });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({ path: `${outDir}/${baseName} - Resume.pdf`, format: 'Letter', printBackground: true,
    margin: { top: '0.5in', bottom: '0.5in', left: '0.7in', right: '0.7in' } });
} finally { await browser.close(); }

if (Array.isArray(c.coverLetter) && c.coverLetter.length)
  await renderCoverPdf(c.coverLetter, `${outDir}/${baseName} - Cover Letter.pdf`);
console.log('✓ rendered:', baseName, breakTail ? '(tail → page 2)' : '');
