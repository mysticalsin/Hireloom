#!/usr/bin/env node
/**
 * render-content.mjs — render a CLAUDE-authored tailored-content JSON into a
 * CV + cover PDF, using the batch engine's renderer only (no Kimi call).
 *
 * Content JSON shape (Education + Certifications are auto-injected by the engine):
 *   {
 *     "title": "Technology Delivery Manager",
 *     "summary": "...",
 *     "experience": [{ "title": "...", "period": "...", "location": "...", "bullets": ["...", ...] }, ...],
 *     "competencies": " · separated",
 *     "tools": " · separated",
 *     "coverLetter": ["para1", "para2", "para3"]
 *   }
 *
 * Usage:
 *   node engine/render/render-content.mjs --content /tmp/role.json --out "output/applications-aviation/GTAA - Technology Delivery Manager"
 */
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { normalizeContent, renderPdf, renderCoverPdf, renderCombinedPdf } from '../batch/tailor-engine.mjs';

function loadEnv() {
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
loadEnv();
// The bundled headless-shell isn't installed; point the renderer at the headed
// Chrome-for-Testing (runs headless via flag) — same binary the apply window uses.
const { ensureChromiumEnv } = await import('../lib/pw-chromium.mjs');
ensureChromiumEnv();

const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : ''; };
const CONTENT = arg('--content'), OUT = arg('--out');
if (!CONTENT || !OUT) { console.error('Need --content <json> --out <folder>'); process.exit(1); }

// Safety: strip any "(Aerospace focus)" degree-claim that slipped into prose.
const cleanStr = (s) => typeof s === 'string'
  ? s.replace(/\s*\(?\s*aerospace[\s-]*focus\s*\)?/gi, '').replace(/\s{2,}/g, ' ').trim() : s;
function stripAerospaceFocus(c) {
  c.summary = cleanStr(c.summary); c.title = cleanStr(c.title);
  c.competencies = cleanStr(c.competencies); c.tools = cleanStr(c.tools);
  if (Array.isArray(c.coverLetter)) c.coverLetter = c.coverLetter.map(cleanStr);
  for (const j of c.experience || []) { j.title = cleanStr(j.title); j.bullets = (j.bullets || []).map(cleanStr); }
  return c;
}

(async () => {
  let content = JSON.parse(readFileSync(CONTENT, 'utf8'));
  content = normalizeContent(content);
  content = stripAerospaceFocus(content);
  const GREET = arg('--greeting');
  if (GREET && Array.isArray(content.coverLetter) && content.coverLetter[0] !== GREET) {
    content.coverLetter = [GREET, ...content.coverLetter];
  }
  mkdirSync(OUT, { recursive: true });
  const { loadIdentity } = await import('../lib/identity.mjs');
  const NAME = loadIdentity().name;
  const cvPath = join(OUT, `${NAME} - Resume.pdf`);
  const coverPath = join(OUT, `${NAME} - Cover Letter.pdf`);
  await renderPdf(content, cvPath);
  const combinedPath = join(OUT, `${NAME} - Resume + Cover Letter.pdf`);
  if (Array.isArray(content.coverLetter) && content.coverLetter.length) {
    await renderCoverPdf(content.coverLetter, coverPath);
    await renderCombinedPdf(content, combinedPath); // cover-then-resume, for 1-file-upload employers
  }
  console.log(JSON.stringify({ ok: true, cv: cvPath, cover: coverPath, combined: combinedPath }));
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
