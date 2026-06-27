// SSRF-safe text fetch for user-supplied job-posting URLs.
// Forces https, resolves DNS and rejects private/loopback/link-local/metadata IPs,
// follows redirects MANUALLY re-validating each hop, and caps time + bytes.
// (The greenhouse/lever API fast-paths in evaluate hit fixed hosts and don't use this.)

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 4;

function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = +v4[1], b = +v4[2];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  const low = ip.toLowerCase();
  if (low === '::1' || low === '::') return true;
  if (low.startsWith('::ffff:')) return isPrivateIp(low.slice(7)); // IPv4-mapped
  if (low.startsWith('fc') || low.startsWith('fd')) return true; // unique-local
  if (low.startsWith('fe80')) return true; // link-local
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '');
  // IP literal?
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    if (isPrivateIp(host)) throw new Error('blocked_url');
    return;
  }
  const a = await Deno.resolveDns(host, 'A').catch(() => [] as string[]);
  const aaaa = await Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]);
  const ips = [...a, ...aaaa];
  if (ips.length === 0) throw new Error('dns_failed');
  for (const ip of ips) if (isPrivateIp(ip)) throw new Error('blocked_url');
}

async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, max);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      chunks.push(value);
      if (total >= max) { await reader.cancel(); break; }
    }
  }
  const buf = new Uint8Array(Math.min(total, max));
  let off = 0;
  for (const c of chunks) {
    if (off >= buf.length) break;
    const take = Math.min(c.length, buf.length - off);
    buf.set(c.subarray(0, take), off);
    off += take;
  }
  return new TextDecoder().decode(buf);
}

export async function safeFetchText(rawUrl: string): Promise<string> {
  let current: URL;
  try { current = new URL(rawUrl); } catch { throw new Error('invalid_url'); }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'https:') throw new Error('blocked_url'); // force https (no http/file/gopher)
    await assertPublicHost(current.hostname);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': 'HireloomBot/1.0 (+https://hireloom.app)' },
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      await res.body?.cancel().catch(() => {});
      if (!loc) throw new Error('bad_redirect');
      current = new URL(loc, current); // next loop re-validates the new host
      continue;
    }
    if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error('fetch_failed'); }
    return await readCapped(res, MAX_BYTES);
  }
  throw new Error('too_many_redirects');
}
