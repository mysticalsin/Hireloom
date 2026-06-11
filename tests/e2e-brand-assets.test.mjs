/**
 * E2E tests for brand assets (favicon, OG image, manifest).
 *
 * These run against a real booted server (no mocks) and verify:
 *   - Each asset is served with the right Content-Type + cache headers
 *   - SVG assets contain the hex-H signature path (catches silent rebrand)
 *   - manifest.webmanifest is valid JSON with required PWA keys
 *   - /favicon.ico redirects to /favicon.svg
 *   - HTML head contains all required brand meta tags
 *   - ETag round-trips return 304 on If-None-Match match
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { bootServer, fetchPort } from './_helpers/boot-server.mjs';

const HEX_H_SIG = 'M4 12 L9 4 L14 12';

test('brand assets', async (t) => {
  const srv = await bootServer();
  t.after(srv.cleanup);

  await t.test('GET /favicon.svg returns SVG with hex-H path', async () => {
    const r = await fetchPort(srv.port, '/favicon.svg');
    assert.equal(r.statusCode, 200);
    assert.match(r.headers['content-type'], /image\/svg\+xml/);
    assert.match(r.headers['cache-control'], /public.*max-age=86400/);
    assert.ok(r.headers.etag, 'ETag header present');
    assert.match(r.body.toString(), new RegExp(HEX_H_SIG.replace(/ /g, '\\s+')));
  });

  await t.test('GET /favicon-light.svg returns light-mode variant', async () => {
    const r = await fetchPort(srv.port, '/favicon-light.svg');
    assert.equal(r.statusCode, 200);
    assert.match(r.body.toString(), /fill="#fafaf9"/, 'has cream backdrop');
    assert.match(r.body.toString(), new RegExp(HEX_H_SIG.replace(/ /g, '\\s+')));
  });

  await t.test('GET /og-image.svg returns 1200x630 OG card', async () => {
    const r = await fetchPort(srv.port, '/og-image.svg');
    assert.equal(r.statusCode, 200);
    const body = r.body.toString();
    assert.match(body, /viewBox="0 0 1200 630"/, 'OG card uses 1200x630 viewBox');
    assert.match(body, /HIRELOOM/, 'wordmark present');
    assert.match(body, /Your AI-Powered Career Accelerator/, 'tagline present');
    assert.match(body, new RegExp(HEX_H_SIG.replace(/ /g, '\\s+')));
  });

  await t.test('GET /manifest.webmanifest returns valid PWA manifest', async () => {
    const r = await fetchPort(srv.port, '/manifest.webmanifest');
    assert.equal(r.statusCode, 200);
    assert.match(r.headers['content-type'], /application\/manifest\+json/);
    const json = JSON.parse(r.body.toString());
    assert.equal(json.name, 'Hireloom — Your AI-Powered Career Accelerator');
    assert.equal(json.short_name, 'Hireloom');
    assert.equal(json.start_url, '/');
    assert.equal(json.display, 'standalone');
    assert.equal(json.theme_color, '#0a0612');
    assert.ok(Array.isArray(json.icons) && json.icons.length >= 1);
    // First icon should reference our SVG
    assert.match(json.icons[0].src, /\/favicon\.svg/);
  });

  await t.test('GET /favicon.ico redirects 302 to /favicon.svg', async () => {
    const r = await fetchPort(srv.port, '/favicon.ico');
    assert.equal(r.statusCode, 302);
    assert.equal(r.headers.location, '/favicon.svg');
  });

  await t.test('HTML head includes all brand meta tags', async () => {
    const r = await fetchPort(srv.port, '/', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(r.statusCode, 200);
    const html = zlib.gunzipSync(r.body).toString('utf8');
    // Title + tagline
    assert.match(html, /<title>Hireloom — Your AI-Powered Career Accelerator<\/title>/);
    assert.match(html, /<meta name="description" content="A quiet, deliberate system/);
    // Theme color (dark + light variants)
    assert.match(html, /<meta name="theme-color" content="#0a0612" media="\(prefers-color-scheme: dark\)">/);
    assert.match(html, /<meta name="theme-color" content="#fafaf9" media="\(prefers-color-scheme: light\)">/);
    // Favicons (dark + light + apple-touch)
    assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/);
    assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon-light\.svg"/);
    assert.match(html, /<link rel="apple-touch-icon" href="\/favicon\.svg">/);
    // Manifest
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
    // Open Graph
    assert.match(html, /<meta property="og:type" content="website">/);
    assert.match(html, /<meta property="og:image" content="\/og-image\.svg">/);
    assert.match(html, /<meta property="og:image:width" content="1200">/);
    assert.match(html, /<meta property="og:image:height" content="630">/);
    // Twitter
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
    assert.match(html, /<meta name="twitter:image" content="\/og-image\.svg">/);
  });

  await t.test('ETag round-trip: matching If-None-Match returns 304', async () => {
    const first = await fetchPort(srv.port, '/favicon.svg');
    const etag = first.headers.etag;
    assert.ok(etag, 'first response had ETag');
    const second = await fetchPort(srv.port, '/favicon.svg', {
      headers: { 'If-None-Match': etag },
    });
    assert.equal(second.statusCode, 304);
    // 304 must echo the ETag so caching proxies stay sane
    assert.equal(second.headers.etag, etag);
  });

  await t.test('Brand assets are gzipped when Accept-Encoding: gzip', async () => {
    const r = await fetchPort(srv.port, '/og-image.svg', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers['content-encoding'], 'gzip');
    // Gunzipped body should still contain the wordmark
    const body = zlib.gunzipSync(r.body).toString('utf8');
    assert.match(body, /HIRELOOM/);
  });
});
