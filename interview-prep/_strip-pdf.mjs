#!/usr/bin/env node
/**
 * _strip-pdf.mjs — render amaris-cheatsheet-strip.html to a single wide
 * landscape PDF, honouring its @page { size: 15in 5in } CSS (preferCSSPageSize).
 * Usage: node interview-prep/_strip-pdf.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, 'amaris-cheatsheet-strip.html');
const outPath = join(here, 'Amaris - Strip Cheat Sheet.pdf');

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
