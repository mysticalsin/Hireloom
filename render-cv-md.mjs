#!/usr/bin/env node
/**
 * render-cv-md.mjs — render a STANDALONE CV markdown into a styled PDF that
 * matches the generate-cv-pdf.mjs look, but using the file's OWN header
 * (so per-role resubmits with custom title/contact render correctly):
 *
 *   line 1:  "# Name"                          -> H1
 *   line 2:  "**Tagline**"                     -> italic tagline
 *   line 3:  "a | b | c | d"                   -> contact line (· separated)
 *   line 4+: markdown body (## / ### / -, **bold**, *italic*, [link](url))
 *
 * Inline raw HTML is passed through verbatim (e.g. a
 *   <div style="height: 60px;"></div>
 * spacer used for widow/orphan control on a page).
 *
 * Usage: node render-cv-md.mjs "<in.md>" "<out.pdf>"
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';

// Same headed Chrome-for-Testing fallback render-content.mjs uses (the bundled
// headless-shell isn't installed in this environment).
const { ensureChromiumEnv } = await import('./lib/pw-chromium.mjs');
ensureChromiumEnv();

const inPath = process.argv[2], outPath = process.argv[3];
if (!inPath || !outPath) { console.error('Usage: node render-cv-md.mjs "<in.md>" "<out.pdf>"'); process.exit(1); }

const escHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const inline = (s) => escHtml(s)
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`)
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
  .replace(/`([^`]+)`/g, '<code>$1</code>');

function mdBodyToHtml(md) {
  const out = []; let inList = false, inPara = false, paraBuf = [];
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  const closePara = () => { if (inPara) { out.push(`<p>${inline(paraBuf.join(' '))}</p>`); paraBuf = []; inPara = false; } };
  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const t = line.trim();
    if (!t) { closeList(); closePara(); continue; }
    if (t.startsWith('<')) { closeList(); closePara(); out.push(line); continue; } // raw HTML passthrough
    let m;
    if ((m = line.match(/^###\s+(.+)$/)))      { closeList(); closePara(); out.push(`<h3>${inline(m[1])}</h3>`); }
    else if ((m = line.match(/^##\s+(.+)$/)))  { closeList(); closePara(); out.push(`<h2>${inline(m[1])}</h2>`); }
    else if ((m = line.match(/^#\s+(.+)$/)))   { closeList(); closePara(); out.push(`<h2>${inline(m[1])}</h2>`); }
    else if ((m = line.match(/^[-*]\s+(.+)$/))){ closePara(); if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(m[1])}</li>`); }
    else { closeList(); inPara = true; paraBuf.push(t); }
  }
  closeList(); closePara();
  return out.join('\n');
}

const lines = readFileSync(inPath, 'utf8').split('\n');
const name = (lines[0] || '').replace(/^#\s+/, '').trim();
const tagline = (lines[1] || '').replace(/^\*\*|\*\*$/g, '').trim();
const contactBits = (lines[2] || '').split('|').map(s => s.trim()).filter(Boolean);
const contactHtml = contactBits.map(escHtml).join(' &nbsp;·&nbsp; ');
const body = mdBodyToHtml(lines.slice(3).join('\n'));

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${escHtml(name)} — CV</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; font-size: 10.5pt; color: #1a1a1a; line-height: 1.45; padding: 0; }
  h1 { font-size: 20pt; font-weight: 700; letter-spacing: -0.3px; margin-bottom: 2px; }
  .tagline { font-size: 10.5pt; color: #444; margin-bottom: 4px; font-style: italic; }
  .contact { font-size: 9.5pt; color: #555; margin-bottom: 18px; }
  .contact a { color: #555; text-decoration: none; }
  h2 { font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #222; border-bottom: 1.5px solid #d0d0d0; padding-bottom: 3px; margin: 16px 0 8px; }
  h3 { font-size: 10.5pt; font-weight: 700; margin-top: 12px; margin-bottom: 2px; }
  p { margin: 4px 0 6px; }
  ul { padding-left: 16px; margin: 4px 0 6px; }
  li { margin-bottom: 3px; font-size: 10pt; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  code { font-family: 'SF Mono', ui-monospace, monospace; font-size: 9.5pt; background: #f4f4f4; padding: 0 3px; border-radius: 2px; }
  a { color: inherit; text-decoration: none; }
</style></head><body>
<h1>${escHtml(name)}</h1>
${tagline ? `<div class="tagline">${escHtml(tagline)}</div>\n` : ''}<div class="contact">${contactHtml}</div>

${body}
</body></html>`;

const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}) });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: outPath, format: 'Letter', printBackground: true, margin: { top: '1in', right: '1in', bottom: '1in', left: '1in' } });
} finally { await browser.close(); }
console.log('✓ ' + outPath);
