// Supplement: 35 Greenhouse roles on company domains (?gh_jid=). Resolve each
// company's board token from portals.yml careers_url, fetch board, match by id.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
const OUT='output/pool-jds';
const pool=JSON.parse(readFileSync('output/pool-apply-order.json','utf8'));
const have=new Set(readdirSync(OUT).map(f=>parseInt(f)));
const missing=pool.rows.filter(r=>r.ats==='greenhouse'&&!have.has(r.rank)&&r.url);

// company -> greenhouse slug from portals.yml
const yml=readFileSync('portals.yml','utf8').split('\n');
const compSlug={};
let curName='';
for(const line of yml){
  const n=line.match(/^\s*-?\s*name:\s*(.+?)\s*$/); if(n) curName=n[1].replace(/['"]/g,'');
  const c=line.match(/greenhouse\.io\/([^/?#\s]+)/); if(c&&curName) compSlug[curName.toLowerCase()]=c[1];
}
const slugify=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
const norm=s=>(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
async function board(slug){
  try{const r=await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000)});
    if(!r.ok)return null;const d=await r.json();return d?.jobs||null;}catch{return null;}
}
const cache={};
let ok=0,miss=0;
for(const r of missing){
  const ghid=(r.url.match(/gh_jid=(\d+)/)||r.url.match(/\/(\d{6,})/)||[])[1];
  let slug=compSlug[r.company.toLowerCase()]||compSlug[norm(r.company)]||slugify(r.company);
  const tryslugs=[slug, slugify(r.company), compSlug[r.company.toLowerCase()]].filter(Boolean);
  let jobs=null,used='';
  for(const s of [...new Set(tryslugs)]){ if(cache[s]===undefined)cache[s]=await board(s); if(cache[s]){jobs=cache[s];used=s;break;} }
  let jd='';
  if(jobs){
    const j=(ghid&&jobs.find(x=>String(x.id)===ghid))||jobs.find(x=>norm(x.title)===norm(r.title));
    if(j)jd=(j.content||'').replace(/<[^>]+>/g,' ').replace(/&[a-z#0-9]+;/g,' ').replace(/\s+/g,' ').trim();
  }
  writeFileSync(`${OUT}/${String(r.rank).padStart(3,'0')}.json`,JSON.stringify({rank:r.rank,company:r.company,title:r.title,url:r.url,ats:'greenhouse',jd,status:jd?'ok':'unavailable',pulledAt:new Date().toISOString()},null,2));
  if(jd){ok++;}else{miss++;console.log(`  ⚠ #${r.rank} ${r.company} (slug tried: ${tryslugs.join(',')||'none'}, ghid ${ghid||'?'})`);}
}
console.log(`\nsupp: ${ok} pulled, ${miss} still unavailable (of ${missing.length})`);
