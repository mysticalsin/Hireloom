import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

createServer((req, res) => {
  try {
    let name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
    if (!name) name = 'amaris-cheatsheet-strip.html';
    // safety: only serve .html files in this folder
    if (name.includes('..') || !name.endsWith('.html')) name = 'amaris-cheatsheet-strip.html';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readFileSync(join(here, name)));
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
}).listen(4760, '127.0.0.1', () => console.log('serving interview-prep on http://127.0.0.1:4760'));
