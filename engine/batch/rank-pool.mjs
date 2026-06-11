import { readFileSync, writeFileSync } from 'fs';
const o = JSON.parse(readFileSync('output/pool-apply-order.json','utf8'));
const seniority = t => { const x=(t||'').toLowerCase();
  if(/\b(junior|jr|associate|coordinator|specialist|analyst|intern|entry|administrator|assistant)\b/.test(x))return 0;
  if(/\b(senior|sr|lead|principal|staff|\bii\b|\biii\b)\b/.test(x))return 2;
  if(/\b(director|head|vp|vice president|chief)\b/.test(x))return 3;
  return 1; };
const autofill = ats => ats==='smartrecruiters'?8 : ats==='indeed'?5 : 0;  // native ATS = best (Kimi autofills)
const archDir = a => ({PROG_PM:0,IMPL_DEL:1,BIZ_ANALYST:1}[a]!==undefined?0:2); // on-direction archetypes first
for (const r of o.rows) {
  const tier = r.tier ?? 2;
  const sen = seniority(r.title);
  // on-direction (tier 0/1): seniority NOT penalized (he's qualified for senior PM). off-direction (tier2): lower-seniority preferred.
  const senScore = tier===2 ? sen*8 : 0;
  r._score = tier*1000 + senScore + (tier===2?archDir(r.archetype)*3:0) + autofill(r.ats);
}
o.rows.sort((a,b)=> a._score-b._score || (a.company||'').localeCompare(b.company||''));
o.rows.forEach((r,i)=>{ r.rank=i+1; delete r._score; });
o.opened=null; o.nextRank=1;
writeFileSync('output/pool-apply-order.json', JSON.stringify(o,null,2));
const csvQ=s=>{s=String(s??'');return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
writeFileSync('output/pool-ranked.csv',[['rank','tier','company','title','location','ats','archetype','url'].join(','),
  ...o.rows.map(r=>[r.rank,['PM/PC','strict','adjacent'][r.tier],r.company,r.title,r.loc,r.ats,r.archetype,r.url].map(csvQ).join(','))].join('\n')+'\n');
console.log('Ranked '+o.rows.length+' roles best-to-worst → output/pool-apply-order.json + pool-ranked.csv');
console.log('\nTop 15:');
o.rows.slice(0,15).forEach(r=>console.log('  #'+r.rank+' ['+['PM/PC','strict','adj'][r.tier]+'] '+r.title+' @ '+r.company+' ('+r.ats+')'));
console.log('\n#120-130 (strict→adjacent boundary area):');
o.rows.slice(119,130).forEach(r=>console.log('  #'+r.rank+' ['+['PM/PC','strict','adj'][r.tier]+'] '+r.title+' @ '+r.company));
