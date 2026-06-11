#!/usr/bin/env node
// Lightweight Markdown -> styled PDF (no deps). Handles headings, bold/italic/code,
// links, GFM tables, ordered/unordered lists + [ ]/[x] checkboxes, blockquotes, hr, paragraphs.
// Usage: node batch/md2pdf.mjs <in.md> <out.pdf> ["Optional Title"]
import { readFileSync } from 'fs';
import { chromium } from 'playwright';

const inPath = process.argv[2], outPath = process.argv[3], docTitle = process.argv[4] || '';
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

const lines = readFileSync(inPath, 'utf8').split('\n');
let html = '', i = 0;
const closeList = (() => { let stack = []; return mode => {
  // not used for nesting; simple flat lists handled inline
}; })();

function renderTable(block) {
  const rows = block.map(r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
  const head = rows[0]; const body = rows.slice(2); // rows[1] = separator
  let t = '<table><thead><tr>' + head.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of body) t += '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
  return t + '</tbody></table>';
}

while (i < lines.length) {
  let line = lines[i];
  // table block: header line + |---| separator
  if (/^\s*\|.*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
    const block = [line];
    i++;
    while (i < lines.length && /^\s*\|.*\|/.test(lines[i])) { block.push(lines[i]); i++; }
    html += renderTable(block); continue;
  }
  if (/^\s*$/.test(line)) { i++; continue; }
  if (/^#{1,6}\s/.test(line)) { const lvl = line.match(/^#+/)[0].length; html += `<h${lvl}>${inline(line.replace(/^#+\s/, ''))}</h${lvl}>`; i++; continue; }
  if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { html += '<hr>'; i++; continue; }
  if (/^>\s?/.test(line)) {
    const block = [];
    while (i < lines.length && /^>\s?/.test(lines[i])) { block.push(lines[i].replace(/^>\s?/, '')); i++; }
    html += `<blockquote>${block.map(b => inline(b)).join('<br>')}</blockquote>`; continue;
  }
  if (/^\s*[-*]\s|^\s*\d+\.\s/.test(line)) {
    const ordered = /^\s*\d+\.\s/.test(line);
    const tag = ordered ? 'ol' : 'ul';
    html += `<${tag}>`;
    while (i < lines.length && /^\s*([-*]\s|\d+\.\s)/.test(lines[i])) {
      let item = lines[i].replace(/^\s*([-*]\s|\d+\.\s)/, '');
      item = item.replace(/^\[ \]\s/, '☐ ').replace(/^\[[xX]\]\s/, '☑ ');
      html += `<li>${inline(item)}</li>`; i++;
    }
    html += `</${tag}>`; continue;
  }
  // paragraph (gather consecutive plain lines)
  const para = [line]; i++;
  while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|>|\s*[-*]\s|\s*\d+\.\s|\s*\|)/.test(lines[i]) && !/^\s*(---|\*\*\*)\s*$/.test(lines[i])) { para.push(lines[i]); i++; }
  html += `<p>${para.map(inline).join(' ')}</p>`;
}

const full = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  *{box-sizing:border-box} body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:10.5px;line-height:1.5;color:#1a1a1a}
  h1{font-size:20px;font-weight:800;border-bottom:2px solid #333;padding-bottom:4px;margin:0 0 10px}
  h2{font-size:14px;font-weight:800;color:#111;margin:16px 0 6px;border-bottom:1px solid #ccc;padding-bottom:2px}
  h3{font-size:12px;font-weight:700;color:#222;margin:12px 0 4px}
  p{margin:6px 0;text-align:left} strong{font-weight:700} em{font-style:italic}
  code{font-family:'SF Mono',Menlo,Consolas,monospace;background:#f2f2f2;padding:1px 4px;border-radius:3px;font-size:9.5px}
  a{color:#0b5fff;text-decoration:none}
  ul,ol{margin:6px 0;padding-left:20px} li{margin:3px 0}
  blockquote{border-left:3px solid #888;background:#f7f7f7;margin:8px 0;padding:6px 12px;color:#333}
  table{border-collapse:collapse;width:100%;margin:8px 0;font-size:9.5px} th,td{border:1px solid #ccc;padding:4px 7px;text-align:left;vertical-align:top}
  th{background:#f0f0f0;font-weight:700} hr{border:none;border-top:1px solid #ddd;margin:14px 0}
  tr,blockquote,table{page-break-inside:avoid} h1,h2,h3{page-break-after:avoid}
</style></head><body>${docTitle ? `<h1>${esc(docTitle)}</h1>` : ''}${html}</body></html>`;

const EXE = process.env.PW_CHROMIUM_PATH || '';
const ctx = await chromium.launch({ headless: true, ...(EXE ? { executablePath: EXE } : {}) });
const page = await ctx.newPage();
await page.setContent(full, { waitUntil: 'load' });
await page.pdf({ path: outPath, format: 'Letter', printBackground: true, margin: { top: '0.85in', bottom: '0.85in', left: '0.85in', right: '0.85in' } });
await ctx.close();
console.log('✓ ' + outPath);
