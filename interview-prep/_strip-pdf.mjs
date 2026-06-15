#!/usr/bin/env node
/**
 * _strip-pdf.mjs — render a cheat-sheet strip HTML to a single wide
 * landscape PDF, honouring its @page { size: 15in 5in } CSS (preferCSSPageSize).
 * Usage: node interview-prep/_strip-pdf.mjs [strip.html]
 *   - no arg → amaris-cheatsheet-strip.html (back-compat default)
 *   - arg    → render that strip; output PDF named from "<Title> — Strip Cheat Sheet.pdf"
 *              derived from the file's <title>, falling back to the filename.
 */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const inArg = process.argv[2];
const htmlPath = inArg
  ? (existsSync(inArg) ? inArg : join(here, inArg))
  : join(here, 'amaris-cheatsheet-strip.html');
if (!existsSync(htmlPath)) { console.error('not found: ' + htmlPath); process.exit(1); }
// Derive a friendly output name from <title>, else the html filename.
const titleMatch = readFileSync(htmlPath, 'utf8').match(/<title>([^<]*)<\/title>/i);
const stem = titleMatch
  ? titleMatch[1].split(/[—\-–]/)[0].trim().replace(/[\/\\:]/g, '')
  : basename(htmlPath).replace(/\.html?$/i, '');
const outPath = join(here, `${stem} - Strip Cheat Sheet.pdf`);

const execPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.PW_CHROMIUM_PATH;
const launchOpts = execPath && existsSync(execPath) ? { executablePath: execPath } : {};

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
await page.pdf({
  path: outPath,
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});
await browser.close();
console.log('wrote ' + outPath);
