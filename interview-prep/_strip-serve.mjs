import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

createServer((req, res) => {
  try {
    let name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
    if (!name || !name.endsWith('.html')) name = 'amaris-cheatsheet-strip.html';
    // Containment, not substring checks: resolved path must stay inside here/.
    let full = resolve(here, name);
    if (!full.startsWith(here + sep)) full = resolve(here, 'amaris-cheatsheet-strip.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readFileSync(full));
  } catch {
    res.writeHead(500);
    res.end('internal error');
  }
}).listen(4760, '127.0.0.1', () => console.log('serving interview-prep on http://127.0.0.1:4760'));
