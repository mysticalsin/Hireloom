/**
 * Rate-limit + CSRF + DoS defense E2E tests.
 *
 * These exercise the security middleware end-to-end against a booted server,
 * not just the pure helpers. Coverage:
 *   - Rate limit (GET): 200 reqs in <1 s eventually 429s
 *   - Rate limit (POST): tighter mutating budget — small burst trips it
 *   - CSRF: cross-origin POST with attacker Origin returns 403
 *   - CSRF: same-origin POST is allowed
 *   - Body cap: oversized JSON returns 413, not OOMs the server
 *   - Path traversal: /reports/../../etc/passwd returns 404, not the file
 *   - Auth gate when bound to non-loopback (HOST=0.0.0.0) — covered separately
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootServer, fetchPort } from './_helpers/boot-server.mjs';

test('Rate limiting + CSRF + DoS defenses', async (t) => {
  await t.test('GET rate limit triggers 429 after exhausting budget', async () => {
    // Use a tighter budget to keep the test fast
    const srv = await bootServer({
      RATE_GET_PER_MIN: '10',
      RATE_POST_PER_MIN: '5',
    });
    t.after(srv.cleanup);

    const codes = [];
    for (let i = 0; i < 25; i++) {
      const r = await fetchPort(srv.port, '/api/health');
      codes.push(r.statusCode);
    }
    const ok = codes.filter(c => c === 200).length;
    const limited = codes.filter(c => c === 429).length;
    assert.ok(limited > 0, `at least 1 request was 429-rate-limited (got ok=${ok}, 429=${limited})`);
    assert.ok(ok >= 8, `at least the budget worth of requests succeeded, got ${ok}`);
  });

  await t.test('POST rate limit is tighter than GET', async () => {
    const srv = await bootServer({
      RATE_GET_PER_MIN: '60',
      RATE_POST_PER_MIN: '3',
    });
    t.after(srv.cleanup);

    const codes = [];
    for (let i = 0; i < 10; i++) {
      const r = await fetchPort(srv.port, '/api/onboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': srv.baseUrl,
        },
        body: JSON.stringify({ raw_resume: 'test' }),
      });
      codes.push(r.statusCode);
    }
    const limited = codes.filter(c => c === 429).length;
    assert.ok(limited > 0, `POST rate limit should fire within 10 reqs, got codes ${codes.join(',')}`);
  });

  await t.test('Cross-origin POST blocked (CSRF defense)', async () => {
    const srv = await bootServer();
    t.after(srv.cleanup);
    const r = await fetchPort(srv.port, '/api/onboard/finalize', {
      method: 'POST',
      headers: {
        'Origin': 'https://evil.example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ full_name: 'Evil', target_roles: ['Boss'] }),
    });
    assert.equal(r.statusCode, 403, 'cross-origin POST returns 403');
  });

  await t.test('Same-origin POST passes the CSRF gate', async () => {
    const srv = await bootServer();
    t.after(srv.cleanup);
    const r = await fetchPort(srv.port, '/api/onboard/finalize', {
      method: 'POST',
      headers: {
        'Origin': srv.baseUrl,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        full_name: 'Test User',
        email: 'test@example.com',
        target_roles: ['Engineer'],
      }),
    });
    // CSRF gate passes; payload is valid → 200 ok:true. Either 200 or 4xx
    // (validation) is acceptable here — we just want to NOT see 403.
    assert.notEqual(r.statusCode, 403, `same-origin POST should not be 403-blocked, got ${r.statusCode}`);
  });

  await t.test('Oversized JSON body is rejected, server stays alive', async () => {
    const srv = await bootServer();
    t.after(srv.cleanup);

    // Build a 10 MB body — well past the typical 1 MB cap. The server may
    // either return 413/400 or terminate the connection (ECONNRESET) once
    // it sees Content-Length over the cap. Both are valid defenses; what
    // matters is that the server doesn't OOM and stays responsive.
    const big = 'x'.repeat(10 * 1024 * 1024);
    let connectionReset = false;
    let statusCode = null;
    try {
      const r = await fetchPort(srv.port, '/api/onboard', {
        method: 'POST',
        headers: {
          'Origin': srv.baseUrl,
          'Content-Type': 'application/json',
          'Content-Length': String(big.length + 20),
        },
        body: JSON.stringify({ raw_resume: big }),
      });
      statusCode = r.statusCode;
    } catch (e) {
      // Server killed the connection mid-stream → also acceptable defense
      connectionReset = e.code === 'ECONNRESET' || /reset|EPIPE/.test(e.message);
      if (!connectionReset) throw e;
    }
    if (!connectionReset) {
      // 4xx is the expected response — 500 means the server tripped over
      // the big body, which is itself a regression. Connection reset is
      // also acceptable (server killed the connection mid-stream).
      assert.ok([400, 413].includes(statusCode),
        `oversized body rejected with 4xx (413 ideal), got ${statusCode} — 500 indicates the body cap failed cleanly`);
    }

    // Server must still be alive after the attack
    const after = await fetchPort(srv.port, '/api/health');
    assert.equal(after.statusCode, 200, 'server still alive after big body');
  });

  await t.test('Path traversal in /reports/* is sanitized', async () => {
    const srv = await bootServer();
    t.after(srv.cleanup);
    // URL-encoded traversal: pathname survives Node's URL parser intact,
    // then resolveSafeReportPath strips it via path.basename.
    const encodedTraversal = '/reports/..%2F..%2F..%2Fetc%2Fpasswd';
    const r1 = await fetchPort(srv.port, encodedTraversal);
    // Either 404 (basename rejected) or 200 (matched a real .md report by
    // basename only). Critical: body must NOT contain /etc/passwd content.
    const body1 = r1.body.toString();
    assert.ok(!/root:x:0:0/.test(body1), `encoded traversal did not leak /etc/passwd`);
    // basename of "..%2F..%2F..%2Fetc%2Fpasswd" → "passwd" (no .md ext) → 404
    assert.equal(r1.statusCode, 404, `encoded traversal → 404, got ${r1.statusCode}`);

    // Plain "../" traversal is normalized away by Node's URL parser to
    // /etc/passwd — that doesn't match /reports/, so falls through to the
    // dashboard HTML at 200. Body should NOT contain /etc/passwd content.
    const plainTraversal = '/reports/../../../etc/passwd';
    const r2 = await fetchPort(srv.port, plainTraversal);
    const body2 = r2.body.toString();
    assert.ok(!/root:x:0:0/.test(body2), `plain traversal did not leak /etc/passwd`);
    // 200 (dashboard) or 404 are both safe responses
    assert.ok([200, 404].includes(r2.statusCode));

    // Filename WITH suspicious chars but in basename — must be rejected
    const r3 = await fetchPort(srv.port, '/reports/' + encodeURIComponent('../etc.md'));
    assert.equal(r3.statusCode, 404, 'basename with .. is rejected');
  });

  await t.test('Unknown /api/* returns JSON 404 (not HTML)', async () => {
    const srv = await bootServer();
    t.after(srv.cleanup);
    const r = await fetchPort(srv.port, '/api/does-not-exist');
    assert.equal(r.statusCode, 404);
    assert.match(r.headers['content-type'], /application\/json/);
    const json = JSON.parse(r.body.toString());
    assert.equal(json.ok, false);
    assert.match(json.error, /not found/i);
  });

  await t.test('Security headers present on every response', async () => {
    const srv = await bootServer();
    t.after(srv.cleanup);
    const r = await fetchPort(srv.port, '/');
    assert.equal(r.statusCode, 200);
    assert.ok(r.headers['x-content-type-options'], 'X-Content-Type-Options present');
    assert.ok(r.headers['x-frame-options'] || r.headers['content-security-policy'],
      'X-Frame-Options or CSP frame-ancestors present');
    // Referrer-Policy + Permissions-Policy are nice-to-haves
    if (r.headers['referrer-policy']) {
      assert.ok(r.headers['referrer-policy'].length > 0);
    }
  });
});
