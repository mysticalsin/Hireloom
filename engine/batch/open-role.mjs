#!/usr/bin/env node
// Advance the apply queue WITHOUT spawning a new window.
// Writes the role's URL into output/.apply-url so the already-running
// apply-open.mjs browser navigates in place, then prints the colored banner.
//
// Usage: node batch/open-role.mjs <rank>
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';

const rank = Number(process.argv[2]);
const pool = JSON.parse(readFileSync('output/pool-apply-order.json', 'utf8'));
const r = pool.rows.find(x => x.rank === rank);
if (!r) { console.error(`no role at rank ${rank}`); process.exit(1); }

// navigate the existing window in place
writeFileSync('output/.apply-url', r.url);
if (!existsSync('output/.apply-url')) console.error('warning: could not write .apply-url');

// mark it opened in the pool
pool.opened = rank;
writeFileSync('output/pool-apply-order.json', JSON.stringify(pool, null, 2));

// colored banner
execFileSync('node', ['batch/indeed-banner.mjs', String(rank)], { stdio: 'inherit' });
console.error(`\n→ navigated existing window in place to rank #${rank} (no new window)\n`);
