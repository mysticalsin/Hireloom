import { chromium } from 'playwright';
import { createResolver, extractFieldsInPage } from '../apply/autoapply-core.mjs';
const EXE = process.env.PW_CHROMIUM_PATH;
const R = createResolver({ projectDir: process.cwd() });
const T=9000;
async function gj(u,opts){try{const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0','Content-Type':'application/json'},signal:AbortSignal.timeout(T),...opts});return r.ok?await r.json():null;}catch{return null;}}
// gather 3 live form URLs per ATS
async function srUrls(slug,n){const d=await gj(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=20`);return (d?.content||[]).slice(0,n).map(j=>`https://jobs.smartrecruiters.com/${slug}/${j.id}`);}
async function recUrls(slug,n){const d=await gj(`https://${slug}.recruitee.com/api/offers/`);return (d?.offers||[]).slice(0,n).map(j=>j.careers_url||j.url).filter(Boolean);}
const tests=[];
for(const s of ['Hootsuite','Wise','ServiceTitan']) (await srUrls(s,1)).forEach(u=>tests.push({ats:'smartrecruiters',u}));
for(const s of ['gong','prodigy','make']) (await recUrls(s,1)).forEach(u=>tests.push({ats:'recruitee',u}));
console.log('Validating '+tests.length+' live forms...\n');
const ctx=await chromium.launch({headless:true,...(EXE?{executablePath:EXE}:{})});
async function reachForm(page,url){
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:40000}).catch(()=>{});
  await page.waitForTimeout(2500);
  const has=async()=>(await page.locator('form, input[type="file"], input[name*="first" i], [name*="email" i]').count().catch(()=>0))>0;
  if(await has())return true;
  // click Apply / I'm interested
  for(const sel of ['a:has-text("I\'m interested")','button:has-text("I\'m interested")','a:has-text("Apply")','button:has-text("Apply")','a[href*="apply"]']){
    try{const b=page.locator(sel).first();if(await b.isVisible({timeout:1000})){await b.click();await page.waitForTimeout(2500);break;}}catch{}
  }
  return await has();
}
for(const t of tests){
  const page=await ctx.newPage();
  let fields=[],resolved=0,reached=false;
  try{reached=await reachForm(page,t.u);await page.waitForTimeout(2000);
    // frame-aware: SmartRecruiters oneclick + embedded forms live in iframes
    for(const fr of page.frames()){const ff=await fr.evaluate(extractFieldsInPage).catch(()=>[]);if(ff&&ff.length)fields=fields.concat(ff);}
    if(fields.length){let a=R.resolveAnswers(fields,{});a=R.mergeIdentity(a,fields);R.applyProfileAnswers(a,fields);resolved=Object.values(a).filter(v=>v&&String(v).trim()).length;}
  }catch(e){}
  const pass=fields.length>0;
  console.log(`[${t.ats}] ${pass?'✓ PASS':'✗ FAIL'} — fields=${fields.length} resolved=${resolved} (frames=${page.frames().length})`);
  console.log(`         ${t.u}`);
  await page.close();
}
await ctx.close();
