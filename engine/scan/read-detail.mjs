import { writeFileSync } from 'fs';
let s = '';
process.stdin.on('data', d => s += d).on('end', () => {
  let o; try { o = JSON.parse(s); } catch { console.log('(no JSON)'); return; }
  let t = (o.msg || '').replace(/\n[ \t]*\n/g, '\n');
  const tm = t.match(/(?:Search Results\s*\n?Post\s*\n)?([A-Z][^\n]{4,80})\nJob Category:\s*([^\n]+)/);
  const reqm = t.match(/Requisition Number:\s*([^\n]+)/);
  const loc = (t.match(/([A-Za-z .'-]+,\s*(?:QC|ON|AB|BC|MB)[^\n]*)/) || [])[1] || '?';
  const fr = /french.{0,30}required|bilingual.{0,20}required|both french and english/i.test(t);
  console.log('TITLE:', tm ? tm[1] : '(?)', '| CATEGORY:', tm ? tm[2] : '?', '| REQ:', reqm ? reqm[1] : '?');
  console.log('LOCATION:', loc, '| FRENCH gate:', fr ? '⚠ REQUIRED' : 'none obvious');
  console.log('url:', o.url);
  writeFileSync('/tmp/mda-current.json', JSON.stringify({ url: o.url, jd: t, title: tm ? tm[1] : '' }));
  const bs = t.search(/responsib|duties|what you|the role|you will|description\n|work experience/i);
  console.log('--- body ---');
  console.log((bs > 0 ? t.slice(bs) : t).slice(0, 2400));
});
