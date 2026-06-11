// Locate a Playwright Chromium binary when PW_CHROMIUM_PATH isn't set and the
// bundled headless-shell isn't installed. Globs the ms-playwright cache for the
// newest chromium*/ install (never hardcode a chromium-NNNN revision — it
// changes with every Playwright update).
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export function findChromium() {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  try {
    const revs = readdirSync(cache).filter(d => d.startsWith('chromium')).sort().reverse();
    for (const rev of revs) {
      for (const sub of [
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-linux/chrome',
      ]) {
        const p = join(cache, rev, sub);
        if (existsSync(p)) return p;
      }
    }
  } catch {}
  return '';
}

// Convenience: set PW_CHROMIUM_PATH for downstream playwright launches.
export function ensureChromiumEnv() {
  if (!process.env.PW_CHROMIUM_PATH) {
    const p = findChromium();
    if (p) process.env.PW_CHROMIUM_PATH = p;
  }
  return process.env.PW_CHROMIUM_PATH || '';
}
