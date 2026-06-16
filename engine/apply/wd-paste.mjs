#!/usr/bin/env node
// wd-paste.mjs — print a copy-pastable, field-by-field version of a tailored
// package so a Workday application can be filled by HAND (Workday's resume
// autofill mis-files the experience bullets into "core competencies").
//
//   node engine/apply/wd-paste.mjs <key>            (e.g. 122)
//   node engine/apply/wd-paste.mjs <key> --dir <fresh-build-dir>
//
// Reads output/fresh-2026-06-15/content/<key>.json (the Claude-authored content).
import { readFileSync, existsSync } from 'fs';

const a = process.argv.slice(2);
const key = (a[0] || '').padStart(3, '0');
const di = a.indexOf('--dir');
const DIR = di > -1 ? a[di + 1] : 'output/fresh-2026-06-15';
const path = `${DIR}/content/${key}.json`;
if (!key || !existsSync(path)) { console.error(`usage: wd-paste.mjs <key>  (not found: ${path})`); process.exit(1); }

const c = JSON.parse(readFileSync(path, 'utf8'));
// company/title for the header (manifest), best-effort
let company = '', role = c.title || '';
try {
  const m = JSON.parse(readFileSync(`${DIR}/manifest.json`, 'utf8'));
  const r = (m.roles || m).find(x => String(x.key).padStart(3, '0') === key);
  if (r) { company = r.company; }
} catch {}

const line = (s = '') => console.log(s);
const splitPeriod = (p = '') => {
  const parts = p.split(/\s*[–—-]\s*/);
  return { from: (parts[0] || '').trim(), to: (parts[1] || '').trim() };
};

line(`================  ${key} · ${company ? company + ' — ' : ''}${role}  ================`);
line();
line('—— SUMMARY  (Workday: "Summary" / "About you" / cover-letter box) ——');
line(c.summary || '');
line();
line('—— WORK EXPERIENCE  (one block per job — fill each Workday experience entry) ——');
(c.experience || []).forEach((e, i) => {
  const [r, comp] = (e.title || '').split(/\s+—\s+/);
  const { from, to } = splitPeriod(e.period);
  const cur = /present|current/i.test(to);
  line();
  line(`[${i + 1}] Job Title:  ${(r || e.title || '').trim()}`);
  line(`    Company:    ${(comp || '').trim()}`);
  line(`    Location:   ${e.location || ''}`);
  line(`    From:       ${from}     To: ${cur ? 'Present  (✓ I currently work here)' : to}`);
  line(`    Description:`);
  (e.bullets || []).forEach(b => line(`    • ${b}`));
});
line();
line('—— SKILLS / COMPETENCIES  (Workday "Skills") ——');
line((c.competencies || '').split(' · ').join(', '));
line();
line('—— TOOLS ——');
line((c.tools || '').split(' · ').join(', '));
line();
line('='.repeat(72));
