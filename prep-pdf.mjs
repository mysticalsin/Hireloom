#!/usr/bin/env node
/**
 * prep-pdf.mjs — Markdown → styled PDF via Playwright (no markdown lib needed).
 *
 * Usage:
 *   node prep-pdf.mjs <input.md> ["output.pdf"]
 *
 * Renders interview-prep / cheat-sheet markdown into a clean, printable Letter PDF.
 * Handles: # / ## / ### headings, GFM tables, - lists, > blockquotes, --- rules,
 * and inline **bold** / *italic* / `code` / [links](url). Tuned for the prep docs
 * in interview-prep/ (acronym dictionary, company prep sheets).
 *
 * Uses the Playwright Chromium already installed for the apply pipeline. Honours
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH if set, else falls back to the bundled build.
 */
import { chromium } from 'playwright';
import { readFile } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { resolve, basename, extname, dirname, join } from 'path';

const [, , inArg, outArg] = process.argv;
if (!inArg) {
  console.error('Usage: node prep-pdf.mjs <input.md> ["output.pdf"]');
  process.exit(1);
}
const inPath = resolve(inArg);
const outPath = outArg
  ? resolve(outArg)
  : join(dirname(inPath), basename(inPath, extname(inPath)) + '.pdf');

const md = await readFile(inPath, 'utf8');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) =>
  s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

function mdToHtml(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let i = 0;
  let inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  const isSep = (s) => s.includes('|') && s.includes('-') && /^\s*\|?\s*:?-{2,}/.test(s);
  const parseRow = (r) => {
    let t = r.trim();
    if (t.startsWith('|')) t = t.slice(1);
    if (t.endsWith('|')) t = t.slice(0, -1);
    return t.split('|').map((c) => c.trim());
  };

  while (i < lines.length) {
    const line = lines[i];
    // fenced code block (``` … ```) — preserve as-is (ASCII diagrams)
    if (/^```/.test(line)) {
      closeList();
      i++;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      html += `<pre><code>${esc(buf.join('\n'))}</code></pre>`;
      continue;
    }
    // table
    if (/^\s*\|/.test(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      closeList();
      const header = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(parseRow(lines[i])); i++; }
      html += '<table><thead><tr>' + header.map((h) => `<th>${inline(esc(h))}</th>`).join('') + '</tr></thead><tbody>';
      for (const r of rows) html += '<tr>' + r.map((c) => `<td>${inline(esc(c))}</td>`).join('') + '</tr>';
      html += '</tbody></table>';
      continue;
    }
    if (/^### /.test(line)) { closeList(); html += `<h3>${inline(esc(line.slice(4)))}</h3>`; i++; continue; }
    if (/^## /.test(line))  { closeList(); html += `<h2>${inline(esc(line.slice(3)))}</h2>`; i++; continue; }
    if (/^# /.test(line))   { closeList(); html += `<h1>${inline(esc(line.slice(2)))}</h1>`; i++; continue; }
    if (/^---+\s*$/.test(line)) { closeList(); html += '<hr>'; i++; continue; }
    if (/^>\s?/.test(line)) { closeList(); html += `<blockquote>${inline(esc(line.replace(/^>\s?/, '')))}</blockquote>`; i++; continue; }
    if (/^\s*[-*] /.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(esc(line.replace(/^\s*[-*] /, '')))}</li>`; i++; continue; }
    if (/^\s*$/.test(line)) { closeList(); i++; continue; }
    closeList();
    html += `<p>${inline(esc(line))}</p>`;
    i++;
  }
  closeList();
  return html;
}

const body = mdToHtml(md);
const title = (md.match(/^#\s+(.+)$/m)?.[1] || basename(inPath)).replace(/[*_`]/g, '');

const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page { size: Letter; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color:#1c2330; font-size:10.6px; line-height:1.5; margin:0; }
  h1 { font-size:21px; color:#10243e; margin:0 0 4px; letter-spacing:-0.01em; }
  h2 { font-size:14px; color:#0f4c81; margin:20px 0 8px; padding-bottom:4px; border-bottom:2px solid #e2e8f0; break-after:avoid; }
  h3 { font-size:11.5px; color:#1c3a5e; margin:14px 0 5px; break-after:avoid; }
  p { margin:5px 0; }
  strong { color:#0d1b2a; }
  em { color:#33415c; }
  code { background:#eef2f7; padding:1px 4px; border-radius:3px; font-family:"SF Mono",Menlo,Consolas,monospace; font-size:9.3px; color:#0f4c81; }
  pre { background:#f5f8fb; border:1px solid #e2e8f0; border-radius:6px; padding:9px 11px; overflow-x:auto; break-inside:avoid; margin:9px 0; }
  pre code { background:none; padding:0; color:#243042; font-size:8.4px; line-height:1.34; white-space:pre; }
  hr { border:0; border-top:1px solid #e6eaf0; margin:14px 0; }
  blockquote { margin:4px 0 9px; padding:5px 11px; border-left:3px solid #9db8d2; background:#f5f8fb; color:#3a4a5e; font-style:italic; border-radius:0 4px 4px 0; break-inside:avoid; }
  ul { margin:5px 0; padding-left:20px; }
  li { margin:2px 0; }
  table { border-collapse:collapse; width:100%; margin:9px 0; font-size:9.8px; }
  th { background:#0f4c81; color:#fff; text-align:left; padding:5px 8px; font-weight:600; }
  td { padding:4px 8px; border-bottom:1px solid #e6eaf0; vertical-align:top; }
  tbody tr:nth-child(even) { background:#f6f9fc; }
  tr { break-inside:avoid; }
  a { color:#0f4c81; text-decoration:none; }
</style></head><body>${body}</body></html>`;

// Playwright's default expects chrome-headless-shell, which may not be installed.
// Fall back to the full Chromium build the apply pipeline uses.
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  try {
    for (const d of readdirSync(cache).filter((n) => n.startsWith('chromium-')).sort().reverse()) {
      for (const sub of ['chrome-mac-arm64', 'chrome-mac']) {
        const p = join(cache, d, sub, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
        if (existsSync(p)) return p;
      }
    }
  } catch { /* fall through to Playwright default */ }
  return undefined;
}
const executablePath = findChromium();
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage();
  await page.setContent(doc, { waitUntil: 'load' });
  await page.pdf({
    path: outPath,
    format: 'Letter',
    printBackground: true,
    margin: { top: '0.6in', bottom: '0.6in', left: '0.62in', right: '0.62in' },
  });
  console.log('PDF written:', outPath);
} finally {
  await browser.close();
}
