import type { Tailoring } from './db';

// Client-side PDF: render the tailored CV / cover letter as a clean, ATS-friendly
// document in a new window and trigger the browser's print → Save as PDF. No
// Chromium service required.

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const SHELL = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: Letter; margin: 0.5in 0.7in; }
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.5; color: #1a1a1a; margin: 0; }
  h1 { font-size: 26px; font-weight: 800; text-transform: uppercase; letter-spacing: .02em; margin: 0; }
  .role { font-size: 14px; font-weight: 700; color: #333; }
  .contact { font-size: 11px; color: #444; margin-top: 4px; }
  .rule { height: 2px; background: linear-gradient(to right,#666,#ddd); margin: 8px 0 14px; }
  h2 { font-size: 12.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; margin: 14px 0 6px; }
  .summary { text-align: justify; }
  .job { margin-bottom: 10px; }
  .job-h { display: flex; justify-content: space-between; font-weight: 700; }
  .job-loc { font-size: 10.5px; color: #555; }
  ul { margin: 4px 0 0; padding-left: 16px; }
  li { margin-bottom: 3px; text-align: justify; }
  p { text-align: justify; margin: 0 0 10px; }
  .meta b { display: inline-block; min-width: 92px; }
</style></head><body>${body}</body></html>`;

function header(name: string, contact: string, role: string) {
  return `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px">
    <h1>${esc(name)}</h1><div class="role">${esc(role)}</div></div>
    <div class="contact">${esc(contact)}</div><div class="rule"></div>`;
}

export function cvHtml(t: Tailoring, name: string, contact: string): string {
  const exp = (t.experience || []).map((j) => `
    <div class="job"><div class="job-h"><span>${esc(j.title)}</span><span>${esc(j.period)}</span></div>
    <div class="job-loc">${esc(j.location)}</div>
    <ul>${(j.bullets || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>`).join('');
  const body = `${header(name, contact, t.title)}
    <h2>Professional Summary</h2><p class="summary">${esc(t.summary)}</p>
    <h2>Experience</h2>${exp}
    <h2>Core Competencies &amp; Tools</h2>
    <p class="meta"><b>Competencies:</b> ${esc(t.competencies)}</p>
    <p class="meta"><b>Tools:</b> ${esc(t.tools)}</p>`;
  return SHELL(`${name} — CV`, body);
}

export function coverHtml(t: Tailoring, name: string, contact: string): string {
  const paras = (t.coverLetter || []).map((p) => `<p>${esc(p)}</p>`).join('');
  const body = `${header(name, contact, t.title)}${paras}<p>Sincerely,<br>${esc(name)}</p>`;
  return SHELL(`${name} — Cover Letter`, body);
}

export function openPrint(html: string) {
  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups to download the PDF.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350); // let layout settle before the print dialog
}
