// Reads an apply-cmd `read` JSON from stdin, prints job-title-ish lines that
// match PM/program/delivery roles. Used for the fresh aviation liveness sweep.
let s = '';
process.stdin.on('data', d => s += d).on('end', () => {
  let t = ''; try { t = JSON.parse(s).msg || ''; } catch { console.log('  (no JSON)'); return; }
  const label = process.argv[2] || '';
  console.log(`  [${label}] page chars: ${t.length}`);
  if (/the page you are looking for|doesn'?t exist|404|no longer available|has been filled/i.test(t.slice(0, 400))) {
    console.log('  ⚠ DEAD/EMPTY page'); return;
  }
  const kw = /(project manager|program manager|delivery manager|implementation manager|technical program|program management|portfolio|transformation|continuous improvement|process improvement|operations manager|service delivery|PMO)/i;
  const junk = /(welder|cook|cashier|driver|cleaner|mechanic|technician|assembler|operator|attendant|loader|fueler|agent|guard|labour|machinist|inspector|electrician|pilot|crew|steward)/i;
  const lines = [...new Set(t.split('\n').map(l => l.trim()).filter(l => l.length > 6 && l.length < 130 && kw.test(l) && !junk.test(l)))];
  if (!lines.length) { console.log('  (no PM/program titles found on this view)'); return; }
  lines.slice(0, 25).forEach(l => console.log('   • ' + l));
});
