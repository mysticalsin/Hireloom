// Durable file-backed store. Same interface as makeInMemoryStore, persisted to a
// JSON file: hydrate on open, write atomically after every mutation. Gives real
// durability for single-user / local hosting with no database. The Postgres
// adapter (same interface) replaces this for multi-instance hosting.
//
//   import { makeFileStore } from './engine/store/file-store.mjs';
//   const store = makeFileStore({ file: 'data/store.json' });

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { makeInMemoryStore } from './store.mjs';

// Methods that change state → trigger a save.
const MUTATORS = new Set([
  'createTenant', 'createUser', 'upsertProviderKey',
  'saveRole', 'updateRoleStatus', 'saveReport',
  'setSubscription', 'incrementUsage',
]);

export function makeFileStore({ file, now } = {}) {
  if (!file) throw new Error('makeFileStore: file path required');

  let snapshot = null;
  try { snapshot = JSON.parse(readFileSync(file, 'utf8')); } catch { /* fresh */ }

  const store = makeInMemoryStore({ now, snapshot });

  const save = () => {
    try { mkdirSync(dirname(file), { recursive: true }); } catch { /* exists */ }
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(store.toJSON()));
    renameSync(tmp, file); // atomic replace — no half-written file on crash
  };

  // Wrap mutators to persist after they succeed; pass everything else through.
  const wrapped = {};
  for (const [name, fn] of Object.entries(store)) {
    if (typeof fn !== 'function') continue;
    wrapped[name] = MUTATORS.has(name)
      ? (...args) => { const r = fn(...args); save(); return r; }
      : fn.bind(store);
  }
  return wrapped;
}
