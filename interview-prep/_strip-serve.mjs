import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STRIP = 'amaris-cheatsheet-strip.html';

createServer((req, res) => {
  try {
    let name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
    // Allowlist a single flat .html filename — no separators or dot-segments
    // can survive this shape, so the joined path cannot leave here/.
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*\.html$/.test(name)) name = DEFAULT_STRIP;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readFileSync(join(here, name)));
  } catch {
    res.writeHead(500);
    res.end('internal error');
  }
}).listen(4760, '127.0.0.1', () => console.log('serving interview-prep on http://127.0.0.1:4760'));
