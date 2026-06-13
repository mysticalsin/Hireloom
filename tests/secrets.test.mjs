/**
 * tests/secrets.test.mjs — the BYO-API-key store + env seam.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readStore, writeStore, loadSecretsIntoEnv, keyStatus, maskSecret,
  validateKeysPayload, applyKeysPayload, secretsPath, PROVIDERS,
} from '../apps/web/lib/secrets.mjs';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'hl-secrets-')); }

test('readStore returns {} when missing or corrupt', () => {
  const d = tmpDir();
  assert.deepEqual(readStore(d), {});
  fs.writeFileSync(secretsPath(d), 'not json{');
  assert.deepEqual(readStore(d), {});
});

test('writeStore → readStore round-trips and is 0600', () => {
  const d = tmpDir();
  writeStore(d, { ANTHROPIC_API_KEY: 'sk-ant-xyz' });
  assert.deepEqual(readStore(d), { ANTHROPIC_API_KEY: 'sk-ant-xyz' });
  const mode = fs.statSync(secretsPath(d)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('loadSecretsIntoEnv injects managed keys and overwrites existing env', () => {
  const d = tmpDir();
  writeStore(d, { KIMI_API_KEY: 'nvapi-store', KIMI_MODEL: 'm1', NOT_A_KEY: 'x' });
  const env = { KIMI_API_KEY: 'nvapi-old-from-dotenv' };
  const injected = loadSecretsIntoEnv(d, env);
  assert.equal(env.KIMI_API_KEY, 'nvapi-store', 'store wins over pre-existing env');
  assert.equal(env.KIMI_MODEL, 'm1');
  assert.equal(env.NOT_A_KEY, undefined, 'only catalog keys are injected');
  assert.ok(injected.includes('KIMI_API_KEY') && injected.includes('KIMI_MODEL'));
});

test('maskSecret never reveals the body', () => {
  assert.equal(maskSecret(''), '');
  assert.equal(maskSecret('short'), '••••');
  assert.equal(maskSecret('sk-ant-abcd1234'), '••••1234');
});

test('keyStatus reports configured + source + masked, never the raw secret', () => {
  const d = tmpDir();
  writeStore(d, { ANTHROPIC_API_KEY: 'sk-ant-secret-9999', KIMI_BASE_URL: 'https://x/v1' });
  const env = { GEMINI_API_KEY: 'AIza-from-env' };
  const st = keyStatus(d, env);
  const anthropic = st.providers.find(p => p.id === 'anthropic');
  const gemini = st.providers.find(p => p.id === 'gemini');
  const openai = st.providers.find(p => p.id === 'openai');
  assert.equal(anthropic.configured, true);
  assert.equal(anthropic.source, 'app');
  assert.equal(anthropic.masked, '••••9999');
  assert.ok(!JSON.stringify(st).includes('sk-ant-secret-9999'), 'raw secret must never leak');
  assert.equal(gemini.source, 'env');     // from process.env fallback
  assert.equal(openai.source, 'none');
  // extras return their real (non-secret) value
  assert.equal(st.extras.find(e => e.env === 'KIMI_BASE_URL').value, 'https://x/v1');
  // routing defaults present
  assert.equal(st.routing.tailoring, 'nim');
});

test('validateKeysPayload rejects unknown keys, oversize values, bad routing', () => {
  assert.deepEqual(validateKeysPayload({ values: { ANTHROPIC_API_KEY: 'ok' } }), []);
  assert.ok(validateKeysPayload({ values: { BOGUS: 'x' } }).length);
  assert.ok(validateKeysPayload({ values: { ANTHROPIC_API_KEY: 'x'.repeat(9999) } }).length);
  assert.ok(validateKeysPayload({ routing: { scoring: 'nope' } }).length);
  assert.ok(validateKeysPayload({ routing: { bogusTask: 'gemini' } }).length);
});

test('applyKeysPayload sets, clears, persists, and routes', () => {
  const d = tmpDir();
  const env = {};
  // set
  let st = applyKeysPayload(d, { values: { ANTHROPIC_API_KEY: 'sk-ant-1', KIMI_MODEL: 'kimi-x' }, routing: { eval: 'openai' } }, env);
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-1');
  assert.equal(readStore(d).ANTHROPIC_API_KEY, 'sk-ant-1');
  assert.equal(st.routing.eval, 'openai');
  assert.equal(st.providers.find(p => p.id === 'anthropic').configured, true);
  // clear with empty string
  st = applyKeysPayload(d, { values: { ANTHROPIC_API_KEY: '' } }, env);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(readStore(d).ANTHROPIC_API_KEY, undefined);
  assert.equal(st.providers.find(p => p.id === 'anthropic').configured, false);
  // unmentioned key untouched
  assert.equal(readStore(d).KIMI_MODEL, 'kimi-x');
});

test('the catalog covers the four BYO providers', () => {
  assert.deepEqual(PROVIDERS.map(p => p.id).sort(), ['anthropic', 'gemini', 'nim', 'openai']);
});
