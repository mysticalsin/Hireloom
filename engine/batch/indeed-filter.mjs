import { readFileSync, writeFileSync } from 'fs';
const raw = JSON.parse(readFileSync('output/indeed-roles-raw.json','utf8'));
const STRICT=/\b(project coordinator|associate project manager|junior project manager|senior project manager|technical project manager|project manager|implementation (manager|specialist|consultant|lead)|delivery manager|senior program manager|technical program manager|program manager|senior business analyst|business analyst)\b/i;
const PRIORITY=/\b(project manager|project coordinator)\b/i;
const ADJ=/\b(operations|coordinator|program management|project management|business operations|biz ?ops|strategy (and|&) operations|operational excellence|continuous improvement|process (improvement|manager|analyst)|scrum master|agile (coach|delivery)|delivery (lead|coordinator)|chief of staff|engagement manager|onboarding|customer success|client success|professional services|solutions (consultant|manager)|change manage|transformation|portfolio manager|vendor manager|procurement|supply chain|workforce|capacity planning|revenue operations|sales operations|pmo|specialist|analyst|associate|administrator|planner|service delivery|partnerships? manager|account manager|enablement)\b/i;
const EXCLUDE=/\b(software|engineer|developer|\bswe\b|frontend|back ?end|full ?stack|devops|\bsre\b|data scientist|machine learning|designer|\bux\b|\bui\b|marketing|content|copywriter|social media|sales development|sales representative|sales executive|\bsdr\b|account executive|recruiter|talent acquisition|accountant|controller|\bcpa\b|\btax\b|auditor|lawyer|legal counsel|attorney|nurse|clinical|physician|warehouse|driver|technician|electrician|mechanic|welder|forklift|product manager|product owner|product designer|cook|chef|cleaner|janitor|server|cashier|labourer|laborer|millwright|plumber|hvac|carpenter|machinist|assembler|packer|picker)\b/i;
const HARDBAR=/\b(p\.?\s?eng|professional engineer|geotechnical|civil engineer|structural engineer|\bcpa\b|\bcfa\b|chartered (professional )?accountant|\bj\.?d\.?\b|registered nurse|\brn\b|red seal|journeyman|french[- ]speaking|bilingual \(english (and|\/|&) french\)|fully bilingual)\b/i;
const FOREIGN=/\b(united states|u\.s\.\b|\busa\b| ny\b| ca\b, us|tx\b|remote[ ,-]*us|us[ ,-]*remote|india|uk\b|london|australia|germany|france|singapore)\b/i;
// construction / trades / physical-engineering — hard-bar (applied to title AND company)
const CONSTRUCTION=/\b(construction|mechanical|electrical|hvac|civil|structural|geotechnical|estimat(or|ing)|millwright|trades?|superintendent|concrete|plumbing|roofing|glazing|drywall|framing|demolition|\bepc\b|commissioning|piping|welding|scaffold|carpentry|masonry|landscaping|renovation|residential|home ?builder|contracting|contractor|paving|excavation|restoration|fabrication|building envelope|capital project|millwork|formwork|rebar|tower crane|low voltage|fire protection|builders|developments?|properties|realty|homes inc|architectural|horticultur|reforestation|forestry|landscape|tool ?(&|and) ?die|machine shop|manufacturing|industrial|electric supply|\balarm\b|mining|oilfield|petroleum|\butility\b|hydro|marine|automotive|aerospace|foundry|\bsteel\b|sheet metal|plastics|packaging|food production|agricultur|greenhouse|cabinet|furniture|signage|flooring|machinery|heavy equipment|\bplant\b|refrigeration|elevator|escalator|security systems|smart systems|systems integrat|telecom infrastructure)\b/i;
const norm=s=>(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
// dedup set
const dedup=new Set();
try{const a=readFileSync('data/applications.md','utf8');for(const m of a.matchAll(/^\|\s*\d+\s*\|[^|]*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm))dedup.add(norm(m[1])+'::'+norm(m[2]));}catch{}
for(const f of ['output/pool-apply-order.json','output/new-pool.json']){try{const j=JSON.parse(readFileSync(f,'utf8'));(j.rows||j).forEach(r=>dedup.add(norm(r.company)+'::'+norm(r.title)));}catch{}}
const arche=t=>/business (systems )?analyst|systems analyst/i.test(t)?'BIZ_ANALYST':/implementation|onboarding|solutions (consultant|manager)|professional services/i.test(t)?'IMPL_DEL':/customer success|client success/i.test(t)?'IT_SVC':/project|program|delivery|pmo|scrum|agile|portfolio/i.test(t)?'PROG_PM':'GEN_PM_OPS';
const seniority=t=>{const x=t.toLowerCase();if(/\b(junior|jr|associate|coordinator|specialist|analyst|intern|entry|administrator|assistant|\bi\b)\b/.test(x))return 0;if(/\b(senior|sr|lead|principal|staff|\bii\b|\biii\b)\b/.test(x))return 2;if(/\b(director|head|vp|vice president|chief)\b/.test(x))return 3;return 1;};
const pool=[];const seen=new Set();
for(const r of raw){
  const t=r.title;
  const strict=STRICT.test(t)&&!/product manager/i.test(t);
  const adj=!strict&&ADJ.test(t);
  if(!strict&&!adj)continue;
  if(EXCLUDE.test(t)||HARDBAR.test(t))continue;
  if(CONSTRUCTION.test(t)||CONSTRUCTION.test(r.company||''))continue;   // hard-bar construction/trades
  if(FOREIGN.test(r.location||''))continue;        // l=Canada search, drop stray US/foreign
  const key=norm(r.company)+'::'+norm(t);
  if(dedup.has(key)||seen.has(key))continue;seen.add(key);
  const tier=strict?(PRIORITY.test(t)?0:1):2;
  pool.push({company:r.company,title:t,location:r.location||'Canada',jk:r.jk,url:'https://www.google.com/search?q='+encodeURIComponent(r.company+' careers'),indeed:'https://ca.indeed.com/viewjob?jk='+r.jk,tier,archetype:arche(t),sen:seniority(t)});
}
// rank: tier asc; for OFF-direction (tier2) prefer LOWER seniority; then company
pool.sort((a,b)=> a.tier-b.tier || (a.tier===2 ? a.sen-b.sen : 0) || a.company.localeCompare(b.company));
const best=pool.slice(0, Number(process.argv[2]||100));
best.forEach((r,i)=>r.n=i+1);
writeFileSync('output/indeed-pool.json',JSON.stringify(best,null,2));
const byTier=[0,1,2].map(t=>best.filter(r=>r.tier===t).length);
console.log('qualified+CA+new total: '+pool.length+' → capped to best '+best.length);
console.log('  PM/PC: '+byTier[0]+' | other strict: '+byTier[1]+' | adjacent: '+byTier[2]);
console.log('  adjacent seniority mix (best100): low(0)='+best.filter(r=>r.tier===2&&r.sen===0).length+' mid(1)='+best.filter(r=>r.tier===2&&r.sen===1).length+' senior(2-3)='+best.filter(r=>r.tier===2&&r.sen>=2).length);
