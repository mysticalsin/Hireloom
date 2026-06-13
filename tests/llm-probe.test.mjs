/**
 * tests/llm-probe.test.mjs — the API-key probe (no real network).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeProvider, probeEndpoint, classifyProbe } from '../apps/web/lib/llm-probe.mjs';

const fakeFetch = (status) => async () => ({ status });

test('no key → unset', async () => {
  assert.equal((await probeProvider('anthropic', '')).status, 'unset');
});

test('status codes map to plain-English verdicts', async () => {
  assert.equal((await probeProvider('openai', 'k', { fetchImpl: fakeFetch(200) })).status, 'ok');
  assert.equal((await probeProvider('openai', 'k', { fetchImpl: fakeFetch(401) })).status, 'invalid');
  assert.equal((await probeProvider('openai', 'k', { fetchImpl: fakeFetch(403) })).status, 'invalid');
  assert.equal((await probeProvider('openai', 'k', { fetchImpl: fakeFetch(429) })).status, 'ratelimited');
  assert.equal((await probeProvider('openai', 'k', { fetchImpl: fakeFetch(500) })).status, 'error');
});

test('network failure → unreachable', async () => {
  const boom = async () => { throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }); };
  assert.equal((await probeProvider('gemini', 'k', { fetchImpl: boom })).status, 'unreachable');
});

test('timeout aborts → unreachable', async () => {
  const hang = async (_u, { signal }) => new Promise((_r, rej) => {
    signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  assert.equal((await probeProvider('nim', 'k', { fetchImpl: hang, timeoutMs: 20 })).status, 'unreachable');
});

test('unknown provider → unknown', async () => {
  assert.equal((await probeProvider('bogus', 'k', { fetchImpl: fakeFetch(200) })).status, 'unknown');
});

test('probeEndpoint targets the right hosts and honors NIM base URL', () => {
  assert.match(probeEndpoint('anthropic', 'k').url, /api\.anthropic\.com\/v1\/models/);
  assert.ok(probeEndpoint('anthropic', 'k').headers['x-api-key'] === 'k');
  assert.match(probeEndpoint('openai', 'k').url, /api\.openai\.com\/v1\/models/);
  assert.match(probeEndpoint('gemini', 'k').url, /generativelanguage\.googleapis\.com.*key=k/);
  assert.equal(probeEndpoint('nim', 'k', 'https://my.nim/v1/').url, 'https://my.nim/v1/models');
});

test('classifyProbe maps statuses', () => {
  assert.equal(classifyProbe(200).status, 'ok');
  assert.equal(classifyProbe(401).status, 'invalid');
  assert.equal(classifyProbe(429).status, 'ratelimited');
  assert.equal(classifyProbe(404).status, 'error');
});
