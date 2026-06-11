#!/usr/bin/env node
/**
 * relayout-pending.mjs — Re-render (LAYOUT ONLY) the CV + cover for every PENDING
 * role in output/pool-apply-order.json, using the frozen content in
 * output/tailored-content/NNN.json and the current tailor-engine buildHtml.
 *
 * Content is NOT changed — text comes verbatim from the existing JSON. Only the
 * single-page layout (tightened CSS + 0.5in margins) is applied.
 *
 * Reuses ONE Chromium instance for speed. Writes to BOTH folder trees
 * (output/applications/pool-NNN… and output/applications-by-queue/NNN…).
 * Reports any resume that still spills past one page (widow candidates).
 *
 * Usage: PW_CHROMIUM_PATH=... node batch/relayout-pending.mjs
 */
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { chromium } from 'playwright';
import { buildHtml, buildCoverHtml } from './tailor-engine.mjs';
import { loadIdentity } from '../lib/identity.mjs';

const NAME = loadIdentity().name;
const ROOT = process.cwd();
const order = JSON.parse(readFileSync('output/pool-apply-order.json', 'utf8'));
const DONE = new Set(['applied', 'submitted', 'discarded']);
let pending = order.rows.filter(r => !DONE.has((r.status || '').toLowerCase()));
const limArg = process.argv.find(a => a.startsWith('--limit='));
if (limArg) pending = pending.slice(0, parseInt(limArg.split('=')[1], 10));
const EXE = process.env.PW_CHROMIUM_PATH || '';
const M = { top: '0.5in', bottom: '0.5in', left: '0.7in', right: '0.7in' };

function countPages(buf) {
  const s = buf.latin1Slice(0, buf.length);
  const m = s.match(/\/Type\s*\/Page[^s]/g);
  return m ? m.length : 0;
}

const ctx = await chromium.launch({ headless: true, ...(EXE ? { executablePath: EXE } : {}) });
const page = await ctx.newPage();
let ok = 0, fail = 0, twoPage = [];
for (const row of pending) {
  const cf = `output/tailored-content/${String(row.rank).padStart(3, '0')}.json`;
  if (!existsSync(cf)) { fail++; continue; }
  let content;
  try { content = JSON.parse(readFileSync(cf, 'utf8')); } catch { fail++; continue; }
  const poolFolder = row.folder;
  const base = poolFolder.split('/').pop().replace(/^pool-\d+/, String(row.rank).padStart(3, '0'));
  const queueFolder = `output/applications-by-queue/${base}`;
  try {
    for (const dir of [poolFolder, queueFolder]) {
      mkdirSync(dir, { recursive: true });
      await page.setContent(buildHtml(content), { waitUntil: 'load' });
      const buf = await page.pdf({ path: `${dir}/${NAME} - Resume.pdf`, format: 'Letter', printBackground: true, margin: M });
      if (dir === poolFolder && countPages(buf) > 1) twoPage.push(`#${row.rank} ${row.company} — ${row.title}`);
      if (content.coverLetter) {
        await page.setContent(buildCoverHtml(content.coverLetter), { waitUntil: 'load' });
        await page.pdf({ path: `${dir}/${NAME} - Cover Letter.pdf`, format: 'Letter', printBackground: true, margin: M });
      }
    }
    ok++;
    if (ok % 50 === 0) console.log(`  …${ok}/${pending.length}`);
  } catch (e) { fail++; console.error(`  FAIL #${row.rank}: ${e.message}`); }
}
await ctx.close();
console.log(`\n════ RELAYOUT DONE ════\n  ${ok} roles re-rendered (CV+cover, both trees)\n  ${fail} failed`);
if (twoPage.length) {
  console.log(`\n  ⚠ ${twoPage.length} CV(s) STILL >1 page (widow check needed):`);
  for (const t of twoPage) console.log('    ' + t);
} else {
  console.log('  ✅ Every re-rendered CV fits on a single page.');
}
