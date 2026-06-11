#!/usr/bin/env node
// Colored terminal banner for an Indeed (manual-apply) role.
// Usage: node batch/indeed-banner.mjs <rank>
// Prints: role title + company, # in queue, and the salary expectation
// (from config/profile.yml compensation) in ANSI color.
import { readFileSync } from 'fs';

const rank = Number(process.argv[2]);
const pool = JSON.parse(readFileSync('output/pool-apply-order.json', 'utf8'));
const total = pool.rows.length;
const r = pool.rows.find(x => x.rank === rank);
if (!r) { console.error(`no role at rank ${rank}`); process.exit(1); }

// salary expectation from profile
const yml = readFileSync('config/profile.yml', 'utf8');
const comp = yml.match(/^compensation:\s*\n([\s\S]*?)(?=^\S|\Z)/m)?.[1] || '';
const pick = (k) => (comp.match(new RegExp(`${k}:\\s*"?([^"\\n#]+)`)) || [])[1]?.trim() || '';
const target = pick('target_range'), cur = pick('currency'), min = pick('minimum');
const salaryExp = `${target} ${cur}`.trim() + (min ? `  (floor ${min})` : '');

// ANSI
const C = (n, s) => `\x1b[${n}m${s}\x1b[0m`;
const cyan = s => C('1;36', s), yellow = s => C('1;33', s), green = s => C('1;32', s),
      dim = s => C('2', s), mag = s => C('1;35', s);

console.log('');
console.log(cyan('━'.repeat(60)));
console.log(`  ${cyan(r.title)}  ${dim('@')} ${mag(r.company)}`);
console.log(`  ${dim(r.loc || '')}`);
console.log('');
console.log(`  ${yellow(`#${r.rank} in queue`)} ${dim(`of ${total}`)}   ${dim('tier ' + r.tier + ' · ' + r.archetype + ' · ' + r.ats)}`);
console.log(`  ${green('Salary expectation: ' + salaryExp)}`);
console.log(cyan('━'.repeat(60)));
console.log(dim(`  careers:  ${r.url}`));
if (r.indeed) console.log(dim(`  indeed:   ${r.indeed}`));
console.log(dim(`  package:  ${r.folder}`));
console.log('');
