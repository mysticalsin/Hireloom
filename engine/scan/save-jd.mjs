import { writeFileSync } from 'fs';
let s = '';
process.stdin.on('data', d => s += d).on('end', () => {
  let o; try { o = JSON.parse(s); } catch { console.log('⚠ no JSON from read:', s.slice(0, 120)); return; }
  const [slug, role, company, url] = process.argv.slice(2);
  const t = o.msg || '';
  const isSearch = /Search all jobs SEARCH Filter Results/i.test(t.slice(0, 400).replace(/\s+/g, ' ')) && t.length < 3500;
  writeFileSync(`output/aviation-jds/${slug}.json`, JSON.stringify({ role, company, url, jd: t, savedAt: '2026-05-29' }, null, 2));
  const ok = t.length > 900 && !isSearch;
  console.log(`[${slug}] chars:${t.length} ${ok ? '✓ saved' : '⚠ thin/walled — may need you to open it'}`);
  console.log('   head:', t.replace(/\s+/g, ' ').slice(0, 170));
});
