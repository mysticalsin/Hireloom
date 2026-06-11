/**
 * dashboard-web/lib/http-utils.mjs — Tiny HTTP helpers shared by server.mjs.
 *
 * Pure (or near-pure) utilities pulled out of the inline server file so we
 * can unit-test the request body parsing & origin allowlist without booting
 * the full HTTP stack.
 */

// ── readJsonBody ────────────────────────────────────────────────────────────
// Bounded body reader for POST endpoints. Aborts at MAX_BODY_BYTES to prevent
// memory exhaustion via unbounded request bodies. Resolves with the parsed
// JSON or {} for empty bodies; rejects with Error('Request body too large')
// or Error('Invalid JSON body') for malformed inputs.

export const MAX_BODY_BYTES = 256 * 1024; // 256 KiB — generous for our payloads

export function readJsonBody(req, opts = {}) {
  const cap = typeof opts.maxBytes === 'number' ? opts.maxBytes : MAX_BODY_BYTES;
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', chunk => {
      total += chunk.length;
      if (total > cap) {
        reject(new Error('Request body too large'));
        if (typeof req.destroy === 'function') req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// ── isOriginAllowed ─────────────────────────────────────────────────────────
// CSRF defense — returns true when the request originates from a localhost
// loopback address on a port we recognize. Anything else (including missing
// Origin header) is rejected. Pattern matches both http and https schemes.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isOriginAllowed(originHeader, allowedPorts = null) {
  if (typeof originHeader !== 'string' || !originHeader) return false;
  let url;
  try { url = new URL(originHeader); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (!LOOPBACK_HOSTS.has(url.hostname)) return false;
  if (Array.isArray(allowedPorts) && allowedPorts.length > 0) {
    return allowedPorts.includes(url.port) || allowedPorts.includes(Number(url.port));
  }
  return true; // any loopback port is fine when no explicit allowlist
}
