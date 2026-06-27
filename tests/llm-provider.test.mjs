import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callLLM, callModel, resolveModel, resolveKey, validateKey, PROVIDERS } from '../engine/llm/provider.mjs';

// A fake fetch that records the last request and returns a canned response.
function fakeFetch(response, { status = 200 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => response,
      text: async () => JSON.stringify(response),
    };
  };
  fn.calls = calls;
  return fn;
}

const ANTHROPIC_RES = {
  model: 'claude-sonnet-4-0',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: 'hello from claude' }],
  usage: { input_tokens: 11, output_tokens: 7 },
};
const OPENAI_RES = {
  model: 'moonshot-v1-128k',
  choices: [{ message: { content: 'hello from kimi' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 5, completion_tokens: 9 },
};
const GEMINI_RES = {
  modelVersion: 'gemini-2.0-flash',
  candidates: [{ content: { parts: [{ text: 'hello from gemini' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
};

test('resolveModel maps aliases, prefixes, slashes, and bare ids', () => {
  assert.deepEqual(resolveModel('claude'), { provider: 'anthropic', model: 'claude-sonnet-4-0' });
  assert.deepEqual(resolveModel('opus'), { provider: 'anthropic', model: 'claude-opus-4-1' });
  assert.deepEqual(resolveModel('kimi').provider, 'kimi');
  assert.deepEqual(resolveModel('gemini'), { provider: 'gemini', model: 'gemini-2.0-flash' });
  assert.deepEqual(resolveModel('openrouter:meta/llama-3'), { provider: 'openrouter', model: 'meta/llama-3' });
  assert.deepEqual(resolveModel('anthropic/claude-sonnet-4'), { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' });
  assert.deepEqual(resolveModel('claude-sonnet-4-0'), { provider: 'anthropic', model: 'claude-sonnet-4-0' });
  assert.equal(resolveModel().provider, 'anthropic'); // default
  assert.deepEqual(resolveModel('openai'), { provider: 'openai', model: 'gpt-4o' });
  assert.deepEqual(resolveModel('gpt-4o-mini'), { provider: 'openai', model: 'gpt-4o-mini' });
  assert.deepEqual(resolveModel('gpt-4.1'), { provider: 'openai', model: 'gpt-4.1' }); // heuristic
  assert.deepEqual(resolveModel('openai:o3-mini'), { provider: 'openai', model: 'o3-mini' });
});

test('resolveKey prefers explicit arg, falls back to env', () => {
  assert.equal(resolveKey('anthropic', 'sk-explicit'), 'sk-explicit');
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-env';
  try {
    assert.equal(resolveKey('anthropic'), 'sk-env');
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  }
});

test('PROVIDERS lists the supported providers', () => {
  assert.deepEqual([...PROVIDERS].sort(), ['anthropic', 'gemini', 'kimi', 'openai', 'openrouter']);
});

test('anthropic: correct endpoint, headers, body, and parsed output', async () => {
  const ff = fakeFetch(ANTHROPIC_RES);
  const out = await callLLM({
    provider: 'anthropic', model: 'claude-sonnet-4-0', apiKey: 'sk-test',
    system: 'you are terse', prompt: 'hi', maxTokens: 256, temperature: 0.2, fetchImpl: ff,
  });
  const { url, init, body } = ff.calls[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.headers['x-api-key'], 'sk-test');
  assert.equal(init.headers['anthropic-version'], '2023-06-01');
  assert.equal(body.system, 'you are terse');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }]);
  assert.equal(body.max_tokens, 256);
  assert.equal(body.temperature, 0.2);
  assert.equal(out.text, 'hello from claude');
  assert.deepEqual(out.usage, { inputTokens: 11, outputTokens: 7 });
  assert.equal(out.stopReason, 'end_turn');
});

test('kimi: openai-compatible endpoint, Bearer auth, json mode', async () => {
  const ff = fakeFetch(OPENAI_RES);
  const out = await callLLM({
    provider: 'kimi', model: 'moonshot-v1-128k', apiKey: 'kimi-key',
    system: 'sys', prompt: 'q', json: true, fetchImpl: ff,
  });
  const { url, init, body } = ff.calls[0];
  assert.match(url, /\/chat\/completions$/);
  assert.equal(init.headers.authorization, 'Bearer kimi-key');
  assert.deepEqual(body.messages[0], { role: 'system', content: 'sys' });
  assert.deepEqual(body.messages[1], { role: 'user', content: 'q' });
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(out.text, 'hello from kimi');
  assert.deepEqual(out.usage, { inputTokens: 5, outputTokens: 9 });
});

test('openai: api.openai.com endpoint, Bearer auth, parsed output', async () => {
  const ff = fakeFetch(OPENAI_RES);
  const out = await callLLM({
    provider: 'openai', model: 'gpt-4o', apiKey: 'oa-key',
    system: 'sys', prompt: 'q', fetchImpl: ff,
  });
  const { url, init, body } = ff.calls[0];
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(init.headers.authorization, 'Bearer oa-key');
  assert.deepEqual(body.messages[0], { role: 'system', content: 'sys' });
  assert.deepEqual(body.messages[1], { role: 'user', content: 'q' });
  assert.equal(out.text, 'hello from kimi'); // OPENAI_RES shape (openai-compatible)
});

test('openrouter: routes to openrouter.ai with attribution headers', async () => {
  const ff = fakeFetch(OPENAI_RES);
  await callModel('openrouter:meta/llama-3', { apiKey: 'or-key', prompt: 'x', fetchImpl: ff });
  const { url, init, body } = ff.calls[0];
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(init.headers.authorization, 'Bearer or-key');
  assert.equal(init.headers['X-Title'], 'Hireloom');
  assert.equal(body.model, 'meta/llama-3');
});

test('gemini: generateContent endpoint with key, systemInstruction, parsed output', async () => {
  const ff = fakeFetch(GEMINI_RES);
  const out = await callLLM({
    provider: 'gemini', model: 'gemini-2.0-flash', apiKey: 'g-key',
    system: 'sys', prompt: 'hi', json: true, fetchImpl: ff,
  });
  const { url, init, body } = ff.calls[0];
  assert.match(url, /\/models\/gemini-2\.0-flash:generateContent$/); // key NOT in URL
  assert.equal(init.headers['x-goog-api-key'], 'g-key');             // key in header
  assert.deepEqual(body.systemInstruction, { parts: [{ text: 'sys' }] });
  assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: 'hi' }] }]);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(out.text, 'hello from gemini');
  assert.deepEqual(out.usage, { inputTokens: 3, outputTokens: 4 });
});

test('missing key throws, unknown provider throws', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(
      () => callLLM({ provider: 'anthropic', model: 'claude-sonnet-4-0', prompt: 'x', fetchImpl: fakeFetch(ANTHROPIC_RES) }),
      /no API key for anthropic/,
    );
  } finally {
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  }
  await assert.rejects(
    () => callLLM({ provider: 'bogus', model: 'm', apiKey: 'k', prompt: 'x', fetchImpl: fakeFetch({}) }),
    /unknown provider/,
  );
});

test('retries on 429 then succeeds', async () => {
  let n = 0;
  const flaky = async (url, init) => {
    n++;
    if (n === 1) return { ok: false, status: 429, json: async () => ({}), text: async () => 'slow down' };
    return { ok: true, status: 200, json: async () => ANTHROPIC_RES, text: async () => '' };
  };
  const out = await callLLM({
    provider: 'anthropic', model: 'claude-sonnet-4-0', apiKey: 'k', prompt: 'x',
    retries: 2, timeoutMs: 5000, fetchImpl: flaky,
  });
  assert.equal(n, 2);
  assert.equal(out.text, 'hello from claude');
});

test('validateKey returns ok on success and {ok:false} on auth failure', async () => {
  const okFf = fakeFetch(ANTHROPIC_RES);
  assert.deepEqual(await validateKey({ provider: 'anthropic', apiKey: 'good', fetchImpl: okFf }), { ok: true });
  const badFf = fakeFetch({ error: 'invalid key' }, { status: 401 });
  const bad = await validateKey({ provider: 'anthropic', apiKey: 'bad', fetchImpl: badFf });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /401/);
});

test('validateKey for openrouter uses a real model (not the literal "openrouter")', async () => {
  const ff = fakeFetch(OPENAI_RES);
  const r = await validateKey({ provider: 'openrouter', apiKey: 'or', fetchImpl: ff });
  assert.equal(r.ok, true);
  assert.equal(ff.calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.notEqual(ff.calls[0].body.model, 'openrouter');
});
