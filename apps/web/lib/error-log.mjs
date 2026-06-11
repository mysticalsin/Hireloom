/**
 * dashboard-web/lib/error-log.mjs — Structured error logger with rotation.
 *
 * Writes one JSON line per error to a file in DATA_DIR. Rotates when the
 * file exceeds MAX_BYTES so disk usage stays bounded even if something
 * loops forever. Designed to be safe to call from process-level error
 * handlers (unhandledRejection / uncaughtException) — every operation is
 * synchronous + best-effort: a failing log write never throws.
 *
 * Format (one entry per line):
 *   {"t":1234567890,"iso":"2026-...","level":"error","kind":"unhandledRejection",
 *    "message":"...","stack":"...","tag":"...","ctx":{...}}
 *
 * Rotation:
 *   - errors.log     ← active write target
 *   - errors.log.1   ← previous rotation (single backup)
 *   When errors.log >= MAX_BYTES, errors.log → errors.log.1, new log starts.
 *
 * Memory snapshot:
 *   The recent N entries are mirrored in-memory so /api/health can return
 *   them without an additional disk read.
 */

import { appendFileSync, statSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024;   // 2 MiB before rotation
const MAX_RECENT = 32;               // entries kept in memory for /api/health

/**
 * Build a logger bound to a specific file path. Use makeErrorLogger() once at
 * boot, then call the returned `log()` function from error handlers.
 *
 * Each logger has its OWN in-memory ring buffer — sharing one would couple
 * unrelated test instances and leak state across the suite.
 */
export function makeErrorLogger(filePath) {
  const logPath = path.resolve(filePath);
  const rotPath = logPath + '.1';
  // Per-instance ring buffer. Module-level state is a foot-gun in tests.
  const recentEntries = [];

  function rotateIfNeeded() {
    try {
      if (!existsSync(logPath)) return;
      const st = statSync(logPath);
      if (st.size < MAX_BYTES) return;
      // Best-effort rotation. If rename fails (e.g. Windows holding a handle),
      // skip the rotation rather than block error logging.
      try { renameSync(logPath, rotPath); } catch {}
    } catch {
      // statSync on a missing/unreadable file → noop; we'll just append.
    }
  }

  /**
   * Log a structured error entry. Never throws.
   * @param {object} entry  { kind, message, stack?, tag?, ctx? }
   */
  function log(entry) {
    const enriched = {
      t:       Date.now(),
      iso:     new Date().toISOString(),
      level:   entry.level || 'error',
      kind:    entry.kind || 'error',
      message: typeof entry.message === 'string' ? entry.message : String(entry.message ?? ''),
      ...(entry.stack ? { stack: entry.stack } : {}),
      ...(entry.tag ? { tag: entry.tag } : {}),
      ...(entry.ctx ? { ctx: entry.ctx } : {}),
    };

    // Update in-memory ring buffer
    recentEntries.push(enriched);
    if (recentEntries.length > MAX_RECENT) recentEntries.shift();

    // Best-effort disk write — never let a logging failure crash the
    // caller. We're already in an error-handler context; making things
    // worse is the worst-case scenario.
    try {
      rotateIfNeeded();
      appendFileSync(logPath, JSON.stringify(enriched) + '\n', { encoding: 'utf8', mode: 0o600 });
    } catch {
      // Disk full / permission denied / EROFS → swallow. The in-memory
      // buffer is still populated for /api/health introspection.
    }
  }

  function recent({ limit = MAX_RECENT } = {}) {
    return recentEntries.slice(-limit);
  }

  function clear() {
    recentEntries.length = 0;
  }

  return { log, recent, clear, logPath };
}
