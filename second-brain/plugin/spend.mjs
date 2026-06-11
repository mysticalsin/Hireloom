#!/usr/bin/env node
/**
 * spend.mjs — Claude Code transcript cost parser for the Second Brain spend card.
 * Streams every ~/.claude/projects/* transcript, dedupes by message id
 * (replays inflate totals 2-3x), prices per-model, and writes
 * _brain_api/spend.json. Values are the API-EQUIVALENT cost of subscription
 * usage — Pro/Max users don't pay per token; this card answers "what is my
 * usage worth", honestly labeled.
 *
 * Run: node second-brain/plugin/spend.mjs
 */
import { createReadStream, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const API = join(ROOT, '_brain_api');
mkdirSync(API, { recursive: true });

// $/MTok input,output — cache reads 0.1x input, cache writes 1.25x input
const PRICES = [
  ['fable', { in: 10, out: 50 }],
  ['opus', { in: 5, out: 25 }],
  ['sonnet', { in: 3, out: 15 }],
  ['haiku', { in: 1, out: 5 }],
];
const unknownModels = new Set();
function rate(model) {
  const m = String(model || '').toLowerCase().replace(/\[.*?\]/g, '');
  for (const [key, r] of PRICES) if (m.includes(key)) return r;
  unknownModels.add(model);
  return PRICES[1][1]; // price unknowns as opus
}
const cost = (u, r) =>
  ((u.input_tokens || 0) * r.in + (u.output_tokens || 0) * r.out +
   (u.cache_read_input_tokens || 0) * 0.1 * r.in +
   (u.cache_creation_input_tokens || 0) * 1.25 * r.in) / 1e6;

const projectsDir = join(homedir(), '.claude', 'projects');
const files = [];
if (existsSync(projectsDir)) {
  for (const d of readdirSync(projectsDir)) {
    const p = join(projectsDir, d);
    try { for (const f of readdirSync(p)) if (f.endsWith('.jsonl')) files.push(join(p, f)); } catch {}
  }
}

const seen = new Set();
const byDay = new Map();
const byModel = new Map();
let dedupedReplays = 0, messages = 0, sessions = 0;
const t0 = Date.now();

for (const file of files) {
  let contributed = false;
  await new Promise((resolve) => {
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.includes('"assistant"')) return;
      let j; try { j = JSON.parse(line); } catch { return; }
      const msg = j && j.message;
      if (j.type !== 'assistant' || !msg || !msg.usage) return;
      if (msg.id) {
        if (seen.has(msg.id)) { dedupedReplays++; return; }
        seen.add(msg.id);
      }
      const u = msg.usage, r = rate(msg.model), usd = cost(u, r);
      messages++; contributed = true;
      const day = j.timestamp ? new Date(j.timestamp).toLocaleDateString('en-CA') : 'unknown';
      const d = byDay.get(day) || { usd: 0, in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };
      d.usd += usd; d.in += u.input_tokens || 0; d.out += u.output_tokens || 0;
      d.cacheRead += u.cache_read_input_tokens || 0; d.cacheWrite += u.cache_creation_input_tokens || 0;
      byDay.set(day, d);
      const mk = String(msg.model || 'unknown').replace(/\[.*?\]/g, '');
      const m = byModel.get(mk) || { usd: 0, in: 0, out: 0, cacheRead: 0, cacheWrite: 0, messages: 0 };
      m.usd += usd; m.in += u.input_tokens || 0; m.out += u.output_tokens || 0;
      m.cacheRead += u.cache_read_input_tokens || 0; m.cacheWrite += u.cache_creation_input_tokens || 0; m.messages++;
      byModel.set(mk, m);
    });
    rl.on('close', resolve);
  });
  if (contributed) sessions++;
}

const r2 = (n) => Math.round(n * 100) / 100;
const today = new Date().toLocaleDateString('en-CA');
const t = byDay.get(today) || { usd: 0, in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };
const daysSorted = [...byDay.keys()].filter((d) => d !== 'unknown').sort();
const last7 = daysSorted.slice(-7).reduce((a, d) => a + byDay.get(d).usd, 0);
const allUsd = [...byDay.values()].reduce((a, d) => a + d.usd, 0);

const out = {
  note: 'API-equivalent value of subscription usage — Claude Pro/Max users do not pay per token',
  today: { date: today, usd: r2(t.usd), tokens: { in: t.in, out: t.out, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite } },
  last7d: { usd: r2(last7) },
  allTime: {
    usd: r2(allUsd), sessions, messages,
    byModel: Object.fromEntries([...byModel.entries()].map(([k, m]) => [k, { ...m, usd: r2(m.usd) }])),
  },
  days: daysSorted.slice(-14).map((d) => ({ date: d, usd: r2(byDay.get(d).usd) })),
  dedupedReplays,
  unknownModels: [...unknownModels],
};
writeFileSync(join(API, 'spend.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`spend OK → today $${out.today.usd} · 7d $${out.last7d.usd} · all-time $${out.allTime.usd} · ${sessions} sessions · ${messages} msgs · ${dedupedReplays} replays deduped · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
