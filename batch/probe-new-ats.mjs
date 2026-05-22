import { readFileSync, writeFileSync } from 'fs';
const NAMES = readFileSync('batch/collect-pool.mjs','utf8'); // reuse company universe
const base = readFileSync('batch/probe-ats.mjs','utf8').match(/const COMPANIES = `([\s\S]*?)`/)[1].split('\n').map(s=>s.trim()).filter(Boolean);
const extra = [...new Set((NAMES.match(/const EXTRA = \[([\s\S]*?)\];/)?.[1]||'').match(/'[^']+'/g)?.map(s=>s.slice(1,-1))||[])];
let harvest=[]; try{harvest=JSON.parse(readFileSync('output/indeed-companies.json','utf8'));}catch{}
const all=[...new Set([...base,...extra,...harvest])];
const T=8000;
const slugVars=n=>{const x=n.toLowerCase().trim();return [...new Set([x.replace(/[^a-z0-9]+/g,''),x.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),x.split(/\s+/)[0].replace(/[^a-z0-9]/g,'')])].filter(s=>s.length>=2);};
const srVars=n=>[...new Set([n.replace(/[^A-Za-z0-9]+/g,''),n.replace(/\s+/g,''),n.toLowerCase().replace(/[^a-z0-9]+/g,'')])];
async function gj(u,opts){const ac=new AbortController();const id=setTimeout(()=>ac.abort(),T);try{const r=await fetch(u,{signal:ac.signal,headers:{'User-Agent':'Mozilla/5.0','Content-Type':'application/json'},...opts});clearTimeout(id);return r.ok?await r.json():null;}catch{clearTimeout(id);return null;}}
async function tryWorkable(s){const d=await gj(`https://apply.workable.com/api/v3/accounts/${s}/jobs`,{method:'POST',body:'{}'});return d&&Array.isArray(d.results)&&d.results.length?{ats:'workable',slug:s,jobs:d.results.map(j=>({title:j.title,loc:[j.location?.city,j.location?.country].filter(Boolean).join(', ')}))}:null;}
async function tryRecruitee(s){const d=await gj(`https://${s}.recruitee.com/api/offers/`);return d&&Array.isArray(d.offers)&&d.offers.length?{ats:'recruitee',slug:s,jobs:d.offers.map(j=>({title:j.title,loc:[j.city,j.country_code].filter(Boolean).join(', ')}))}:null;}
async function trySR(s){const d=await gj(`https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100`);return d&&Array.isArray(d.content)&&d.content.length?{ats:'smartrecruiters',slug:s,jobs:d.content.map(j=>({title:j.name,loc:[j.location?.city,j.location?.country].filter(Boolean).join(', ')}))}:null;}
const hits=[];const q=[...all];
async function worker(){while(q.length){const name=q.shift();let r=null;
  for(const s of slugVars(name)){r=await tryWorkable(s)||await tryRecruitee(s);if(r)break;}
  if(!r){for(const s of srVars(name)){r=await trySR(s);if(r)break;}}
  if(r){r.company=name;hits.push(r);}
}}
await Promise.all(Array.from({length:12},worker));
writeFileSync('output/new-ats-hits.json',JSON.stringify(hits,null,2));
const by={};hits.forEach(h=>by[h.ats]=(by[h.ats]||0)+1);
console.log('NEW-ATS BOARDS LOCATED: '+hits.length+'  '+JSON.stringify(by));
hits.forEach(h=>console.log('  ['+h.ats+'] '+h.company+' /'+h.slug+' — '+h.jobs.length+' jobs'));
