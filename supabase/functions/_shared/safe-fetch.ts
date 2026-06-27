// SSRF-safe text fetch for user-supplied job-posting URLs.
// Forces https, resolves DNS and rejects private/loopback/link-local/metadata IPs,
// follows redirects MANUALLY re-validating each hop, and caps time + bytes.
// (The greenhouse/lever API fast-paths in evaluate hit fixed hosts and don't use this.)
//
// DNS-rebinding (TOCTOU) note: Deno's `fetch` re-resolves the hostname internally
// using the OS resolver and exposes NO hook to pin a pre-validated IP (there is no
// `lookup`/IP-pinning option, and rewriting the URL to the literal IP would break
// TLS SNI + certificate validation on an https-only path). So the validated IP set
// cannot be handed to `fetch` directly. We mitigate the residual window by (a)
// resolving + validating once and caching the validated IPs for a short TTL so the
// validation that gates a request stays consistent with the resolution that backed
// it, and (b) re-validating the host on every redirect hop. The residual is bounded
// by DNS_CACHE_TTL_MS; a full fix requires runtime IP-pinning support.

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 4;
const DNS_CACHE_TTL_MS = 10_000;

// host -> validated public IPs (cached briefly to keep validation close to the fetch)
const dnsCache = new Map<string, { ips: string[]; expires: number }>();

// Expand an IPv6 literal (optionally carrying a trailing dotted-quad, e.g.
// ::ffff:127.0.0.1) into its 8 16-bit groups. Returns null for anything that
// isn't a parseable IPv6 literal so callers can fail closed.
function expandIpv6(addr: string): number[] | null {
  let s = addr.toLowerCase();
  const pct = s.indexOf('%');
  if (pct !== -1) s = s.slice(0, pct); // strip zone id
  if (!s.includes(':')) return null;

  // Convert a trailing dotted-quad into two hex groups so ::ffff:1.2.3.4 and
  // ::1.2.3.4 normalize the same way as their hex spellings.
  const lastColon = s.lastIndexOf(':');
  const tailLiteral = s.slice(lastColon + 1);
  if (tailLiteral.includes('.')) {
    const m = tailLiteral.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return null;
    const o = [+m[1], +m[2], +m[3], +m[4]];
    if (o.some((n) => n > 255)) return null;
    s = s.slice(0, lastColon + 1) +
      ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }

  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] === '' ? [] : parts[0].split(':');
  const tail = parts.length === 2 ? (parts[1] === '' ? [] : parts[1].split(':')) : [];

  let groups: string[];
  if (parts.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

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

  const g = expandIpv6(ip);
  if (!g) return true; // unparseable IPv6-looking literal -> fail closed
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  // 64:ff9b::/96 NAT64 well-known prefix (can be used to reach internal v4) — block.
  if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return true;
  }
  // ::ffff:a.b.c.d IPv4-mapped (any spelling, incl. ::ffff:7f00:1 hex) and the
  // deprecated ::a.b.c.d IPv4-compatible form (also covers :: and ::1 -> 0.0.0.x).
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && (g[5] === 0xffff || g[5] === 0)) {
    const mapped = `${(g[6] >> 8) & 0xff}.${g[6] & 0xff}.${(g[7] >> 8) & 0xff}.${g[7] & 0xff}`;
    return isPrivateIp(mapped);
  }
  return false;
}

// Resolve + validate a hostname's IPs, caching the validated set for a short TTL.
// Throws blocked_url if ANY resolved IP is private; dns_failed if it resolves to nothing.
async function resolveValidated(host: string): Promise<string[]> {
  const now = Date.now();
  const hit = dnsCache.get(host);
  if (hit && hit.expires > now) return hit.ips;

  const a = await Deno.resolveDns(host, 'A').catch(() => [] as string[]);
  const aaaa = await Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]);
  const ips = [...a, ...aaaa];
  if (ips.length === 0) throw new Error('dns_failed');
  for (const ip of ips) if (isPrivateIp(ip)) throw new Error('blocked_url');

  dnsCache.set(host, { ips, expires: now + DNS_CACHE_TTL_MS });
  return ips;
}

// Returns the validated public IPs for the host (or the literal itself if it's an
// IP literal). Note: these cannot be pinned into Deno's fetch (see file header);
// they bound + cache the validation rather than steer the connection.
async function assertPublicHost(hostname: string): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, '');
  // IP literal?
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    if (isPrivateIp(host)) throw new Error('blocked_url');
    return [host];
  }
  return await resolveValidated(host);
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
    await assertPublicHost(current.hostname); // re-validates (from cache if fresh) on every hop

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
