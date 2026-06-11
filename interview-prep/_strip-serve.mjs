import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STRIP = 'amaris-cheatsheet-strip.html';

createServer((req, res) => {
  try {
    const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
    // The served filename comes from the directory listing, never from the
    // request — the URL only selects among files that already exist in here/.
    const file = readdirSync(here).find((f) => f.endsWith('.html') && f === name) || DEFAULT_STRIP;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readFileSync(join(here, file)));
  } catch {
    res.writeHead(500);
    res.end('internal error');
  }
}).listen(4760, '127.0.0.1', () => console.log('serving interview-prep on http://127.0.0.1:4760'));
