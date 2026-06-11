// Parse Porter (iCIMS) listing text from an apply-cmd `read` JSON on stdin.
// Extracts Title / Req ID / Location / Department / Position Type and flags fits.
let s = '';
process.stdin.on('data', d => s += d).on('end', () => {
  let t = ''; try { t = JSON.parse(s).msg || ''; } catch { console.log('  (no JSON)'); return; }
  t = t.replace(/\n[ \t]*\n/g, '\n'); // collapse Porter's double-newlines
  const label = process.argv[2] || '';
  const re = /(?:Featured Job\s*\n)?([^\n]{4,90})\nReq ID:\s*(\d+)\nLocation Name\n([^\n]+)\nDepartment\n([^\n]+)\nPosition Type\n([^\n]+)/g;
  const seen = new Set(); const rows = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    const [, title, req, loc, dept, type] = m.map(x => (x || '').trim());
    if (seen.has(req)) continue; seen.add(req);
    rows.push({ title, req, loc, dept, type });
  }
  const FIT = /(project manager|program manager|delivery manager|implementation|transformation|continuous improvement|process improvement|portfolio|PMO|program management|solutions delivery|operations manager|change manager|business analyst|product manager|product owner)/i;
  const SKIP = /(pilot|first officer|captain|flight attendant|cabin|ramp|customer service|baggage handler|mechanic|technician|certification authority|crew|steward|loader|fueler|agent|station attendant)/i;
  console.log(`  [${label}] ${rows.length} listings on this page:`);
  for (const r of rows) {
    const fit = FIT.test(r.title) || FIT.test(r.dept);
    const skip = SKIP.test(r.title);
    const tag = fit && !skip ? '⭐FIT' : (skip ? '  skip' : '   ·');
    console.log(`   ${tag}  ${r.title}  [${r.dept} · ${r.loc} · ${r.type}] Req ${r.req}`);
  }
});
