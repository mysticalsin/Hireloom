import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
const exe = process.env.PW_CHROMIUM_PATH;
const QUERIES = ['project manager','project coordinator','program manager','delivery manager','implementation manager',
  'implementation specialist','business analyst','technical program manager','operations manager','operations coordinator',
  'scrum master','revenue operations','program coordinator','solutions consultant','process improvement','operations associate',
  'project administrator','customer success manager','strategy operations','program specialist'];
const ctx = await chromium.launchPersistentContext('.indeed-profile', { headless:false, ...(exe?{executablePath:exe}:{}), viewport:null, args:['--no-sandbox','--disable-blink-features=AutomationControlled','--start-maximized'] });
const p = ctx.pages()[0] || await ctx.newPage();
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const roles = new Map();   // jk -> role
for (const q of QUERIES) {
  for (const start of [0,10,20,30,40]) {
    await p.goto(`https://ca.indeed.com/jobs?q=${encodeURIComponent(q)}&l=Canada&fromage=14&start=${start}`,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});
    await sleep(2500);
    const blocked = await p.evaluate(()=>/verify you are human|captcha|hcaptcha/i.test(document.body.innerText.slice(0,300))).catch(()=>false);
    if (blocked) { console.log(`CAPTCHA "${q}" start=${start} — pausing 25s...`); await sleep(25000); }
    const cards = await p.evaluate(()=>{
      const out=[];
      document.querySelectorAll('div.job_seen_beacon, [data-jk]').forEach(c=>{
        const jk=c.getAttribute('data-jk')||c.querySelector('[data-jk]')?.getAttribute('data-jk')||'';
        const title=(c.querySelector('h2.jobTitle span[title], [data-testid="jobTitle"], h2 a span')?.textContent||c.querySelector('h2.jobTitle')?.textContent||'').trim();
        const company=(c.querySelector('[data-testid="company-name"], .companyName')?.textContent||'').trim();
        const location=(c.querySelector('[data-testid="text-location"], .companyLocation')?.textContent||'').trim();
        if(jk&&title&&company) out.push({jk,title,company,location});
      });
      return out;
    }).catch(()=>[]);
    cards.forEach(c=>{ if(!roles.has(c.jk)) roles.set(c.jk,c); });
    console.log(`"${q}" start=${start}: +${cards.length} cards (total unique ${roles.size})`);
    await sleep(1500);
  }
}
writeFileSync('output/indeed-roles-raw.json', JSON.stringify([...roles.values()], null, 2));
console.log(`\n✓ Scraped ${roles.size} unique role listings → output/indeed-roles-raw.json`);
await ctx.close();
