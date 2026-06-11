/**
 * Unit tests for lib/error-log.mjs — structured error logger with rotation.
 *
 * Coverage:
 *   - log() writes one JSON line per call
 *   - recent() returns the latest N entries (in-memory mirror)
 *   - rotation: when log file exceeds threshold, .1 backup is created
 *   - log() is best-effort: non-existent dir doesn't throw
 *   - Entry shape: t, iso, level, kind, message — and optional stack/tag/ctx
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeErrorLogger } from '../apps/web/lib/error-log.mjs';

test('error-log', async (t) => {
  await t.test('log() writes a JSON line and updates recent()', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'errlog-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const logPath = path.join(dir, 'errors.log');
    const logger = makeErrorLogger(logPath);

    logger.log({ kind: 'test', message: 'first' });
    logger.log({ kind: 'test', message: 'second', stack: 'mock-stack' });

    // recent() should return both
    const entries = logger.recent();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].message, 'first');
    assert.equal(entries[1].message, 'second');
    assert.equal(entries[1].stack, 'mock-stack');

    // File should contain both lines as valid JSON
    const raw = await readFile(logPath, 'utf8');
    const lines = raw.trim().split('\n');
    assert.equal(lines.length, 2);
    const parsed1 = JSON.parse(lines[0]);
    const parsed2 = JSON.parse(lines[1]);
    assert.equal(parsed1.message, 'first');
    assert.equal(parsed2.message, 'second');
    assert.equal(parsed2.stack, 'mock-stack');
    // Required envelope fields
    for (const p of [parsed1, parsed2]) {
      assert.ok(typeof p.t === 'number');
      assert.match(p.iso, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(p.level, 'error');
      assert.equal(p.kind, 'test');
    }
  });

  await t.test('recent() respects MAX_RECENT cap (32 entries)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'errlog-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const logger = makeErrorLogger(path.join(dir, 'errors.log'));

    for (let i = 0; i < 100; i++) {
      logger.log({ kind: 'test', message: `entry-${i}` });
    }
    const entries = logger.recent();
    assert.equal(entries.length, 32, 'recent() caps at 32');
    assert.equal(entries[0].message, 'entry-68', 'oldest in window is entry-68 (100 - 32)');
    assert.equal(entries[31].message, 'entry-99', 'newest is entry-99');
  });

  await t.test('rotation: log file > 2MB → .1 backup created', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'errlog-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const logPath = path.join(dir, 'errors.log');
    const rotPath = logPath + '.1';

    // Pre-fill log with > 2MB so rotation triggers on next write
    await writeFile(logPath, 'x'.repeat(2.5 * 1024 * 1024), 'utf8');
    assert.ok(existsSync(logPath));
    const before = await stat(logPath);
    assert.ok(before.size > 2 * 1024 * 1024);

    const logger = makeErrorLogger(logPath);
    logger.log({ kind: 'test', message: 'after rotation' });

    // After log(): rotation should have happened
    assert.ok(existsSync(rotPath), '.1 backup exists after rotation');
    const newSize = (await stat(logPath)).size;
    assert.ok(newSize < 1024, `new log starts small after rotation, got ${newSize}b`);

    // The single new line should parse
    const raw = await readFile(logPath, 'utf8');
    const parsed = JSON.parse(raw.trim());
    assert.equal(parsed.message, 'after rotation');
  });

  await t.test('log() does NOT throw when path is unwritable', async () => {
    // Use a path that can never exist (a file inside a file). Logger must
    // swallow and continue.
    const dir = await mkdtemp(path.join(tmpdir(), 'errlog-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const fakePath = path.join(dir, 'not-a-file.log', 'deep', 'errors.log');

    const logger = makeErrorLogger(fakePath);
    // This should NOT throw, even though the directory chain is invalid.
    assert.doesNotThrow(() => logger.log({ kind: 'test', message: 'noop' }));
    // In-memory ring buffer still receives the entry
    assert.equal(logger.recent().length, 1);
  });

  await t.test('Entry includes optional ctx/tag fields when provided', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'errlog-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const logger = makeErrorLogger(path.join(dir, 'errors.log'));

    logger.log({ kind: 'route-error', message: 'oops', tag: '/api/foo', ctx: { ip: '127.0.0.1' } });
    const e = logger.recent()[logger.recent().length - 1];
    assert.equal(e.tag, '/api/foo');
    assert.deepEqual(e.ctx, { ip: '127.0.0.1' });
  });

  await t.test('Defaults: missing kind/message coerce sensibly', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'errlog-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const logger = makeErrorLogger(path.join(dir, 'errors.log'));

    logger.log({});  // empty
    const e = logger.recent()[logger.recent().length - 1];
    assert.equal(e.level, 'error');
    assert.equal(e.kind, 'error');
    assert.equal(e.message, '');
  });
});
