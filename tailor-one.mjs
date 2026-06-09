#!/usr/bin/env node
/**
 * tailor-one.mjs — tailor a CV + cover for ONE ad-hoc role (outside the 350 pool).
 * Used for the aviation/aerospace hunt. Reuses the batch tailoring engine.
 *
 * Strips any "Aerospace focus" degree-claim the model invents — the degree line
 * must stay exactly as it appears in the candidate's CV, never embellished.
 *
 * Usage:
 *   node tailor-one.mjs --role "Technology Delivery Manager" --company "GTAA" \
 *       --jdfile /tmp/jd.txt --out "output/applications-aviation/GTAA - Technology Delivery Manager"
 */
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { kimiTailor, normalizeContent, renderPdf, renderCoverPdf } from './batch/tailor-engine.mjs';

function loadEnv() {
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
loadEnv();

const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : ''; };
const ROLE = arg('--role'), COMPANY = arg('--company'), JDFILE = arg('--jdfile'), OUT = arg('--out');
if (!ROLE || !COMPANY || !JDFILE || !OUT) {
  console.error('Need --role --company --jdfile --out');
  process.exit(1);
}

// Remove the "(Aerospace focus)" / "Aerospace focus" degree-claim anywhere it appears,
// without nuking legitimate industry mentions of "aerospace" in prose.
function stripAerospaceFocus(content) {
  const clean = (s) => typeof s === 'string'
    ? s.replace(/\s*\(?\s*aerospace[\s-]*focus\s*\)?/gi, '').replace(/\s{2,}/g, ' ').trim()
    : s;
  content.summary = clean(content.summary);
  content.title = clean(content.title);
  if (Array.isArray(content.coverLetter)) content.coverLetter = content.coverLetter.map(clean);
  for (const j of content.experience || []) {
    j.bullets = (j.bullets || []).map(clean);
    j.title = clean(j.title);
  }
  content.competencies = clean(content.competencies);
  content.tools = clean(content.tools);
  return content;
}

(async () => {
  const cv = readFileSync('cv.md', 'utf8');
  const jd = readFileSync(JDFILE, 'utf8');
  mkdirSync(OUT, { recursive: true });

  let content;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      content = await kimiTailor(cv, jd, ROLE, COMPANY);
      break;
    } catch (e) {
      console.error(`  tailor attempt ${attempt} failed: ${e.message}`);
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  content = normalizeContent(content);
  content = stripAerospaceFocus(content);

  const { loadIdentity } = await import('./lib/identity.mjs');
  const NAME = loadIdentity().name;
  const cvPath = join(OUT, `${NAME} - Resume.pdf`);
  const coverPath = join(OUT, `${NAME} - Cover Letter.pdf`);
  await renderPdf(content, cvPath);
  if (Array.isArray(content.coverLetter) && content.coverLetter.length) {
    await renderCoverPdf(content.coverLetter, coverPath);
  }
  console.log(JSON.stringify({ ok: true, role: ROLE, company: COMPANY, cv: cvPath, cover: coverPath, summary: content.summary.slice(0, 200) }));
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
