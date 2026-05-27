#!/usr/bin/env node
/**
 * apply-cmd.mjs — send one command to a running apply-session.mjs and wait for
 * its response. Keeps a monotonic id in .apply-session/cmd.json so the session
 * only acts on new commands.
 *
 * Usage:
 *   node apply-cmd.mjs goto "<url>"
 *   node apply-cmd.mjs fill --cv "<resume.pdf>" --cover "<cover.pdf>" --jd "<jd.txt>" --role "Company — Role"
 *   node apply-cmd.mjs status
 *   node apply-cmd.mjs quit
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';

const SDIR = '.apply-session';
const CMD = `${SDIR}/cmd.json`;
const OUT = `${SDIR}/out.json`;
const STATUS = `${SDIR}/status.json`;

const a = process.argv.slice(2);
const cmd = a[0];
if (!cmd) { console.error('usage: goto <url> | fill [--cv --cover --jd --role] | status | quit'); process.exit(1); }

const flag = (k) => { const i = a.indexOf(k); return i > -1 ? a[i + 1] : ''; };

mkdirSync(SDIR, { recursive: true });

// Is the session even alive? (heartbeat within last 10s)
if (!existsSync(STATUS)) {
  console.error('⚠ no .apply-session/status.json — is apply-session.mjs running?');
  process.exit(2);
}

let prev = 0;
try { prev = JSON.parse(readFileSync(CMD, 'utf8')).id || 0; } catch {}
const id = prev + 1;

const payload = { id, cmd };
if (cmd === 'goto') payload.url = a[1];
if (cmd === 'fill') {
  payload.cv = flag('--cv'); payload.cover = flag('--cover');
  payload.jd = flag('--jd'); payload.companyRole = flag('--role');
}

const tmp = `${CMD}.tmp`;
writeFileSync(tmp, JSON.stringify(payload, null, 2));
renameSync(tmp, CMD);

// wait for matching response
const deadline = Date.now() + 180_000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
while (Date.now() < deadline) {
  await sleep(500);
  try {
    const out = JSON.parse(readFileSync(OUT, 'utf8'));
    if (out.id === id) {
      console.log(JSON.stringify(out));
      process.exit(out.ok ? 0 : 1);
    }
  } catch {}
}
console.error('⚠ timed out waiting for apply-session response');
process.exit(3);
