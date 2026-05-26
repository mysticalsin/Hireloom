import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { createResolver, extractFieldsInPage, bestOption, isDecline } from '../autoapply-core.mjs';

// Long-running apply browser: launches ONCE with a persistent profile, then
// watches output/.apply-url and navigates in-place whenever it changes
// (keeps Workday/ATS logins alive — no kill = no session loss).
// Also watches output/.apply-fill: when it changes, auto-fills the standard
// EEO / work-auth / logistics / education fields from config/profile.yml.
const URLFILE  = 'output/.apply-url';
const FILLFILE = 'output/.apply-fill';
const exe = process.env.PW_CHROMIUM_PATH;
const init = process.argv[2];
if (init) writeFileSync(URLFILE, init);

const ctx = await chromium.launchPersistentContext('.apply-profile', {
  headless: false, ...(exe ? { executablePath: exe } : {}),
  viewport: null,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
});
const p = ctx.pages()[0] || await ctx.newPage();
const R = createResolver({ projectDir: process.cwd() });

// ── navigate-in-place watcher ──
let currentUrl = '';
async function navTick() {
  try {
    if (!existsSync(URLFILE)) return;
    const want = readFileSync(URLFILE, 'utf8').trim();
    if (want && want !== currentUrl) {
      currentUrl = want;
      await p.goto(want, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    }
  } catch (e) {}
}

// ── on-demand autofill of safe, repeat-every-time fields ──
// Runs across the main frame AND every iframe (embedded Greenhouse/Lever/Ashby
// on a company domain lives in an iframe — must scan each frame's document).
const SAFE = new Set(['demographic', 'logistics', 'education']);

async function fillFrame(frame) {
  let fields = [];
  try { fields = await frame.evaluate(extractFieldsInPage); } catch { return 0; }
  if (!fields.length) return 0;
  const instr = [];
  for (const f of fields) {
    let cls; try { cls = R.classifyField(f); } catch { continue; }
    if (!cls || !SAFE.has(cls.kind)) continue;          // skip free-text / role-specific / unknown
    const desired = cls.desired;
    if (!desired || isDecline(desired)) continue;        // never fill blanks or "prefer not to say"
    if (f.type === 'select' || f.type === 'radio') {
      const pick = bestOption(desired, f.options);       // only act if we can match a real option
      if (pick && !isDecline(pick)) instr.push({ id: f.id, name: f.name, type: f.type, value: pick });
    } else if (f.type === 'text' || f.type === 'textarea') {
      instr.push({ id: f.id, name: f.name, type: f.type, value: String(desired) });
    }
  }
  if (!instr.length) return 0;
  try {
    return await frame.evaluate((items) => {
      const setNative = (el, val) => {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      let n = 0;
      for (const it of items) {
        const el = document.getElementById(it.id) || document.querySelector(`[name="${it.name}"]`) || document.querySelector(`[id="${it.id}"]`);
        if (it.type === 'select') {
          const sel = el; if (!sel) continue;
          const opt = Array.from(sel.options).find(o => o.text.trim() === it.value);
          if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); n++; }
        } else if (it.type === 'radio') {
          const radios = Array.from(document.querySelectorAll(`[name="${it.name}"]`));
          const r = radios.find(x => x.value === it.value) || radios.find(x => (x.value || '').toLowerCase() === (it.value || '').toLowerCase());
          if (r && !r.checked) { r.click(); n++; }
        } else {
          if (el && !el.value) { setNative(el, it.value); n++; }   // don't overwrite anything you typed
        }
      }
      return n;
    }, instr);
  } catch { return 0; }
}

async function fillNow() {
  let filled = 0;
  for (const frame of p.frames()) filled += await fillFrame(frame);
  writeFileSync('output/.apply-fill-result', `${new Date().toISOString()} filled ${filled}\n`);
}

let lastFill = '';
async function fillTick() {
  try {
    if (!existsSync(FILLFILE)) return;
    const stamp = readFileSync(FILLFILE, 'utf8').trim() + statSync(FILLFILE).mtimeMs;
    if (stamp !== lastFill) { lastFill = stamp; await fillNow(); }
  } catch (e) {}
}

await navTick();
setInterval(navTick, 1000);
setInterval(fillTick, 800);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { try { await ctx.close(); } catch {} process.exit(0); });
await new Promise(() => {});
