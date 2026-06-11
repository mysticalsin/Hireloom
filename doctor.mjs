#!/usr/bin/env node

/**
 * doctor.mjs — Setup validation for Hireloom (career-ops engine).
 * Checks all prerequisites and prints a pass/fail checklist.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { checkProfileDoc, SECOND_BRAIN_PREREQS } from './lib/profile-check.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;

// ANSI colors (only on TTY)
const isTTY = process.stdout.isTTY;
const green = (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s;
const red = (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s;
const yellow = (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s;
const dim = (s) => isTTY ? `\x1b[2m${s}\x1b[0m` : s;

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0]);
  if (major >= 18) {
    return { pass: true, label: `Node.js >= 18 (v${process.versions.node})` };
  }
  return {
    pass: false,
    label: `Node.js >= 18 (found v${process.versions.node})`,
    fix: 'Install Node.js 18 or later from https://nodejs.org',
  };
}

function checkDependencies() {
  if (existsSync(join(projectRoot, 'node_modules'))) {
    return { pass: true, label: 'Dependencies installed' };
  }
  return {
    pass: false,
    label: 'Dependencies not installed',
    fix: 'Run: npm install',
  };
}

async function checkPlaywright() {
  try {
    const { chromium } = await import('playwright');
    const execPath = chromium.executablePath();
    if (existsSync(execPath)) {
      return { pass: true, label: 'Playwright chromium installed' };
    }
    return {
      pass: false,
      label: 'Playwright chromium not installed',
      fix: 'Run: npx playwright install chromium',
    };
  } catch {
    return {
      pass: false,
      label: 'Playwright chromium not installed',
      fix: 'Run: npx playwright install chromium',
    };
  }
}

function checkCv() {
  if (existsSync(join(projectRoot, 'cv.md'))) {
    return { pass: true, label: 'cv.md found' };
  }
  return {
    pass: false,
    label: 'cv.md not found',
    fix: [
      'Create cv.md in the project root with your CV in markdown',
      'See examples/ for reference CVs',
    ],
  };
}

function checkProfile() {
  if (existsSync(join(projectRoot, 'config', 'profile.yml'))) {
    return { pass: true, label: 'config/profile.yml found' };
  }
  return {
    pass: false,
    label: 'config/profile.yml not found',
    fix: [
      'Run: cp config/profile.example.yml config/profile.yml',
      'Then edit it with your details',
    ],
  };
}

// Validates profile.yml CONTENT (the cv: block contract from lib/identity.mjs),
// not just existence. Returns an array: parse errors and contract violations
// fail; cosmetic gaps (no education yet) warn. Empty profile file → handled
// by checkProfile, so this returns nothing when the file is absent.
function checkCvBlock() {
  const profilePath = join(projectRoot, 'config', 'profile.yml');
  if (!existsSync(profilePath)) return [];
  let doc;
  try {
    doc = load(readFileSync(profilePath, 'utf8'));
  } catch (e) {
    return [{
      pass: false,
      label: `config/profile.yml does not parse: ${e.message.split('\n')[0]}`,
      fix: 'Fix the YAML — a duplicated top-level key (e.g. two cv: blocks) is the usual culprit',
    }];
  }
  const findings = checkProfileDoc(doc);
  if (findings.length === 0) {
    return [{ pass: true, label: 'config/profile.yml valid — cv: block ready for the renderers' }];
  }
  return findings.map((f) => ({
    pass: f.level !== 'fail',
    warn: f.level === 'warn',
    label: f.label,
    fix: f.fix,
  }));
}

// Second Brain is opt-in, so missing prerequisites warn instead of fail.
function checkSecondBrain() {
  const missing = SECOND_BRAIN_PREREQS.filter((rel) => !existsSync(join(projectRoot, rel)));
  if (missing.length > 0) {
    return {
      pass: true,
      warn: true,
      label: `Second Brain prerequisites incomplete (optional): missing ${missing.join(', ')}`,
      fix: 'Restore the missing files from the repo if you want the Obsidian dashboards',
    };
  }
  const major = parseInt(process.versions.node.split('.')[0]);
  if (major < 20) {
    return {
      pass: true,
      warn: true,
      label: `Second Brain build requires Node 20+ (found v${process.versions.node})`,
      fix: 'Upgrade Node before running /second-brain — the rest of Hireloom works on 18',
    };
  }
  return { pass: true, label: 'Second Brain prerequisites ready (optional — say "set up my second brain")' };
}

function checkPortals() {
  if (existsSync(join(projectRoot, 'portals.yml'))) {
    return { pass: true, label: 'portals.yml found' };
  }
  return {
    pass: false,
    label: 'portals.yml not found',
    fix: [
      'Run: cp templates/portals.example.yml portals.yml',
      'Then customize with your target companies',
    ],
  };
}

function checkFonts() {
  const fontsDir = join(projectRoot, 'fonts');
  if (!existsSync(fontsDir)) {
    return {
      pass: false,
      label: 'fonts/ directory not found',
      fix: 'The fonts/ directory is required for PDF generation',
    };
  }
  try {
    const files = readdirSync(fontsDir);
    if (files.length === 0) {
      return {
        pass: false,
        label: 'fonts/ directory is empty',
        fix: 'The fonts/ directory must contain font files for PDF generation',
      };
    }
  } catch {
    return {
      pass: false,
      label: 'fonts/ directory not readable',
      fix: 'Check permissions on the fonts/ directory',
    };
  }
  return { pass: true, label: 'Fonts directory ready' };
}

function checkAutoDir(name) {
  const dirPath = join(projectRoot, name);
  if (existsSync(dirPath)) {
    return { pass: true, label: `${name}/ directory ready` };
  }
  try {
    mkdirSync(dirPath, { recursive: true });
    return { pass: true, label: `${name}/ directory ready (auto-created)` };
  } catch {
    return {
      pass: false,
      label: `${name}/ directory could not be created`,
      fix: `Run: mkdir ${name}`,
    };
  }
}

async function main() {
  console.log('\nHireloom doctor');
  console.log('================\n');

  const checks = [
    checkNodeVersion(),
    checkDependencies(),
    await checkPlaywright(),
    checkCv(),
    checkProfile(),
    ...checkCvBlock(),
    checkPortals(),
    checkFonts(),
    checkAutoDir('data'),
    checkAutoDir('output'),
    checkAutoDir('reports'),
    checkSecondBrain(),
  ];

  let failures = 0;
  let warnings = 0;

  for (const result of checks) {
    if (result.pass && !result.warn) {
      console.log(`${green('✓')} ${result.label}`);
      continue;
    }
    if (result.warn) {
      warnings++;
      console.log(`${yellow('⚠')} ${result.label}`);
    } else {
      failures++;
      console.log(`${red('✗')} ${result.label}`);
    }
    const fixes = Array.isArray(result.fix) ? result.fix : [result.fix];
    for (const hint of fixes) {
      if (hint) console.log(`  ${dim('→ ' + hint)}`);
    }
  }

  console.log('');
  if (failures > 0) {
    console.log(`Result: ${failures} issue${failures === 1 ? '' : 's'} found${warnings ? ` (+${warnings} warning${warnings === 1 ? '' : 's'})` : ''}. Fix them and run \`npm run doctor\` again.`);
    process.exit(1);
  } else if (warnings > 0) {
    console.log(`Result: All required checks passed (${warnings} optional warning${warnings === 1 ? '' : 's'} above). Run \`claude\` to start.`);
    console.log('');
    console.log('Join the community: https://discord.gg/8pRpHETxa4');
    process.exit(0);
  } else {
    console.log('Result: All checks passed. You\'re ready to go! Run `claude` to start.');
    console.log('');
    console.log('Join the community: https://discord.gg/8pRpHETxa4');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('doctor.mjs failed:', err.message);
  process.exit(1);
});
