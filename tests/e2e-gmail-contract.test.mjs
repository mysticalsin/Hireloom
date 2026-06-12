/**
 * Gmail OAuth contract tests.
 *
 * Boots the server with various Gmail-config states (using bootServer's
 * pre-seed feature so the server reads files at boot, not flakily after).
 * Verifies /api/gmail/status + /api/gmail/disconnect + /auth/gmail respond
 * correctly across states:
 *   - Unconfigured: status reports missingEnv
 *   - Configured but no tokens: hasTokens=false
 *   - Tokens valid: hasTokens=true, tokenExpired=false
 *   - Tokens expired: tokenExpired=true
 *   - access_token without refresh_token: treated as no-tokens
 *   - Cross-origin disconnect: 403
 *
 * No actual Google API calls are made — these are HTTP-contract tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootServer, fetchPort } from './_helpers/boot-server.mjs';

test('Gmail OAuth contract', async (t) => {
  await t.test('unconfigured state — status reports missingEnv', async () => {
    const srv = await bootServer({
      GMAIL_CLIENT_ID: '',
      GMAIL_CLIENT_SECRET: '',
    });
    t.after(srv.cleanup);
    const r = await fetchPort(srv.port, '/api/gmail/status');
    assert.equal(r.statusCode, 200);
    const json = JSON.parse(r.body.toString());
    assert.equal(json.configured, false);
    assert.equal(json.hasClientId, false);
    assert.equal(json.hasClientSecret, false);
    assert.deepEqual(json.missingEnv.sort(),
      ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET']);
  });

  await t.test('configured but no tokens — hasTokens=false', async () => {
    const srv = await bootServer({
      GMAIL_CLIENT_ID: 'fake-client-id.apps.googleusercontent.com',
      GMAIL_CLIENT_SECRET: 'GOCSPX-fakeSecretForTest',
    });
    t.after(srv.cleanup);
    const r = await fetchPort(srv.port, '/api/gmail/status');
    assert.equal(r.statusCode, 200);
    const json = JSON.parse(r.body.toString());
    assert.equal(json.configured, true);
    assert.equal(json.hasTokens, false);
    assert.equal(json.tokenExpired, null);
    assert.deepEqual(json.missingEnv, []);
  });

  await t.test('valid future tokens — hasTokens=true, tokenExpired=false', async () => {
    const futureExpiry = Date.now() + 3600_000;  // 1 hour from now
    const srv = await bootServer({
      GMAIL_CLIENT_ID: 'fake-client-id.apps.googleusercontent.com',
      GMAIL_CLIENT_SECRET: 'GOCSPX-fakeSecretForTest',
    }, {
      seedData: {
        'gmail-tokens.json': {
          access_token: 'fake-access',
          refresh_token: 'fake-refresh',
          expiry: futureExpiry,
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          token_type: 'Bearer',
        },
      },
    });
    t.after(srv.cleanup);

    const r = await fetchPort(srv.port, '/api/gmail/status');
    const json = JSON.parse(r.body.toString());
    assert.equal(json.hasTokens, true);
    assert.equal(json.tokenExpired, false);
    assert.ok(json.tokenExpiresIn > 3500 && json.tokenExpiresIn <= 3600,
      `expires within ~1h, got ${json.tokenExpiresIn}s`);
  });

  await t.test('expired tokens — tokenExpired=true', async () => {
    const pastExpiry = Date.now() - 1_000;
    const srv = await bootServer({
      GMAIL_CLIENT_ID: 'fake-client-id.apps.googleusercontent.com',
      GMAIL_CLIENT_SECRET: 'GOCSPX-fakeSecretForTest',
    }, {
      seedData: {
        'gmail-tokens.json': {
          access_token: 'expired-access',
          refresh_token: 'still-valid-refresh',
          expiry: pastExpiry,
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          token_type: 'Bearer',
        },
      },
    });
    t.after(srv.cleanup);

    const r = await fetchPort(srv.port, '/api/gmail/status');
    const json = JSON.parse(r.body.toString());
    assert.equal(json.hasTokens, true);
    assert.equal(json.tokenExpired, true);
    assert.equal(json.tokenExpiresIn, 0);
  });

  await t.test('access_token without refresh_token — treated as no-tokens', async () => {
    const srv = await bootServer({
      GMAIL_CLIENT_ID: 'fake-client-id.apps.googleusercontent.com',
      GMAIL_CLIENT_SECRET: 'GOCSPX-fakeSecretForTest',
    }, {
      seedData: {
        'gmail-tokens.json': {
          access_token: 'fake-access',
          // no refresh_token — single-use, can't survive expiry
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
        },
      },
    });
    t.after(srv.cleanup);

    const r = await fetchPort(srv.port, '/api/gmail/status');
    const json = JSON.parse(r.body.toString());
    assert.equal(json.hasTokens, false);
    assert.equal(json.tokenExpired, null);
  });

  await t.test('cached signals are surfaced in status payload', async () => {
    const srv = await bootServer({
      GMAIL_CLIENT_ID: 'fake-client-id.apps.googleusercontent.com',
      GMAIL_CLIENT_SECRET: 'GOCSPX-fakeSecretForTest',
    }, {
      seedData: {
        'gmail-cache.json': {
          v: 2, // current cache schema — v1 caches are wiped on load (see below)
          scanned_at: Date.now() - 60_000,
          signals: [
            { id: '1', type: 'response', dismissed: false },
            { id: '2', type: 'rejection', dismissed: false },
            { id: '3', type: 'rejection', dismissed: true },
          ],
        },
      },
    });
    t.after(srv.cleanup);

    const r = await fetchPort(srv.port, '/api/gmail/status');
    const json = JSON.parse(r.body.toString());
    assert.equal(json.cachedSignalCount, 3);
    assert.equal(json.activeSignalCount, 2);
    assert.ok(json.lastScannedAt > 0);
  });

  await t.test('legacy (v1) cache is wiped on load — the next scan reclassifies', async () => {
    // Pre-role-index signals lack extractedRole/pool matching and would be
    // carried verbatim forever; the v2 migration drops them once, safely
    // (autoApplied statuses already live in the tracker, so re-scans file
    // the same mail quietly instead of re-writing).
    const srv = await bootServer({
      GMAIL_CLIENT_ID: 'fake-client-id.apps.googleusercontent.com',
      GMAIL_CLIENT_SECRET: 'GOCSPX-fakeSecretForTest',
    }, {
      seedData: {
        'gmail-cache.json': {
          scanned_at: Date.now() - 60_000,
          signals: [{ id: '1', type: 'response', dismissed: false }],
        },
      },
    });
    t.after(srv.cleanup);

    const r = await fetchPort(srv.port, '/api/gmail/status');
    const json = JSON.parse(r.body.toString());
    assert.equal(json.cachedSignalCount, 0);
  });

  await t.test('GET /api/gmail/disconnect → 404 (POST-only route)', async () => {
    const srv = await bootServer();
    t.after(srv.cleanup);
    const r = await fetchPort(srv.port, '/api/gmail/disconnect');
    // Server should NOT execute a destructive action under GET. 404 or 405
    // is acceptable; 200 would be a security regression.
    assert.ok([404, 405].includes(r.statusCode),
      `disconnect under GET should not execute, got ${r.statusCode}`);
  });

  await t.test('Cross-origin POST /api/gmail/disconnect blocked (CSRF)', async () => {
    const srv = await bootServer();
    t.after(srv.cleanup);
    const r = await fetchPort(srv.port, '/api/gmail/disconnect', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com' },
    });
    assert.equal(r.statusCode, 403);
  });

  await t.test('OAuth callback rejects missing state (CSRF defense)', async () => {
    const srv = await bootServer({
      GMAIL_CLIENT_ID: 'fake-client-id.apps.googleusercontent.com',
      GMAIL_CLIENT_SECRET: 'GOCSPX-fakeSecretForTest',
    });
    t.after(srv.cleanup);
    // Call the callback with a code but NO state — server must redirect
    // to /?gmail=error&reason=state, NOT exchange the code.
    const r = await fetchPort(srv.port, '/auth/gmail/callback?code=fake-attacker-code');
    assert.equal(r.statusCode, 302);
    assert.match(r.headers.location, /gmail=error/);
    assert.match(r.headers.location, /reason=state/);
  });

  await t.test('OAuth callback rejects unknown state (CSRF defense)', async () => {
    const srv = await bootServer({
      GMAIL_CLIENT_ID: 'fake-client-id.apps.googleusercontent.com',
      GMAIL_CLIENT_SECRET: 'GOCSPX-fakeSecretForTest',
    });
    t.after(srv.cleanup);
    // State token the server never issued — must be rejected
    const r = await fetchPort(srv.port,
      '/auth/gmail/callback?code=fake&state=attacker-forged-state');
    assert.equal(r.statusCode, 302);
    assert.match(r.headers.location, /gmail=error/);
    assert.match(r.headers.location, /reason=state/);
  });

  await t.test('GET /auth/gmail issues a fresh state token (random per visit)', async () => {
    const srv = await bootServer({
      GMAIL_CLIENT_ID: 'fake-client-id.apps.googleusercontent.com',
      GMAIL_CLIENT_SECRET: 'GOCSPX-fakeSecretForTest',
    });
    t.after(srv.cleanup);
    const r1 = await fetchPort(srv.port, '/auth/gmail');
    const r2 = await fetchPort(srv.port, '/auth/gmail');
    assert.equal(r1.statusCode, 302);
    assert.equal(r2.statusCode, 302);
    const state1 = new URL(r1.headers.location).searchParams.get('state');
    const state2 = new URL(r2.headers.location).searchParams.get('state');
    // Both states must exist and be distinct (cryptographically random)
    assert.ok(state1 && state1.length >= 32, `state1 is a long token, got ${state1}`);
    assert.ok(state2 && state2.length >= 32, `state2 is a long token, got ${state2}`);
    assert.notEqual(state1, state2, 'each /auth/gmail visit issues a unique state');
    assert.notEqual(state1, 'dashboard', 'state is not the legacy hardcoded value');
  });
});
