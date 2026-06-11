import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';
const URLFILE='output/.indeed-url';
const exe=process.env.PW_CHROMIUM_PATH;
const init=process.argv[2]; if(init) writeFileSync(URLFILE,init);
const ctx=await chromium.launchPersistentContext('.indeed-profile',{headless:false,...(exe?{executablePath:exe}:{}),viewport:null,args:['--no-sandbox','--disable-blink-features=AutomationControlled','--start-maximized']});
const p=ctx.pages()[0]||await ctx.newPage();
let cur='';
async function tick(){try{if(!existsSync(URLFILE))return;const w=readFileSync(URLFILE,'utf8').trim();if(w&&w!==cur){cur=w;await p.goto(w,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});}}catch{}}
await tick(); setInterval(tick,1000);
for(const s of ['SIGINT','SIGTERM']) process.on(s,async()=>{try{await ctx.close();}catch{}process.exit(0);});
await new Promise(()=>{});
