import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
const exe = process.env.PW_CHROMIUM_PATH;
const QUERIES = ['project manager','project coordinator','program manager','delivery manager',
  'implementation manager','implementation specialist','business analyst','technical program manager',
  'operations manager','scrum master','revenue operations','program coordinator','solutions consultant','process improvement'];
const ctx = await chromium.launchPersistentContext('.indeed-profile', { headless:false, ...(exe?{executablePath:exe}:{}), viewport:null, args:['--no-sandbox','--disable-blink-features=AutomationControlled','--start-maximized'] });
const p = ctx.pages()[0] || await ctx.newPage();
const companies = new Set();
const sleep = ms => new Promise(r=>setTimeout(r,ms));
for (const q of QUERIES) {
  for (const start of [0,10,20]) {
    const url = `https://ca.indeed.com/jobs?q=${encodeURIComponent(q)}&l=Canada&fromage=14&start=${start}`;
    await p.goto(url,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});
    await sleep(2500);
    // captcha guard
    const blocked = await p.evaluate(()=>/verify|captcha|are you a human|hcaptcha/i.test(document.body.innerText.slice(0,400))).catch(()=>false);
    if (blocked) { console.log(`CAPTCHA at "${q}" start=${start} — pausing 25s for you to solve...`); await sleep(25000); }
    const names = await p.evaluate(()=>{
      const out=[];
      document.querySelectorAll('[data-testid="company-name"], .companyName, span[data-testid="company-name"]').forEach(e=>{const t=(e.textContent||'').trim();if(t)out.push(t);});
      return out;
    }).catch(()=>[]);
    names.forEach(n=>companies.add(n));
    console.log(`"${q}" start=${start}: +${names.length} (total unique ${companies.size})`);
    await sleep(1500);
  }
}
writeFileSync('output/indeed-companies.json', JSON.stringify([...companies].sort(), null, 2));
console.log(`\n✓ Harvested ${companies.size} unique company names → output/indeed-companies.json`);
await ctx.close();
