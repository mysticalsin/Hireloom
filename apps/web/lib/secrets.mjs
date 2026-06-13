/**
 * apps/web/lib/secrets.mjs — BYO-API-key store (Phase A1).
 *
 * Stores the user's own provider API keys in `config/secrets.json` (gitignored,
 * 0600) and injects them into `process.env` so the EXISTING engine scripts —
 * which read keys only from `process.env` and inherit the server's env when
 * spawned — pick them up with ZERO changes. This is the seam described in
 * output/PRODUCT-BUILD-PATH.md (A1 → A2).
 *
 * Storage is a deliberately-plaintext-but-private file for the Phase-A web UI.
 * We do NOT wrap it in a locally-keyed cipher: the key would sit next to the
 * ciphertext, so that would be theatre, not security. Honesty over theatre.
 * Real at-rest encryption arrives at packaging via Electron `safeStorage`
 * (OS keychain) — same exported API, different read/write backend. Until then,
 * gitignore + 0600 perms keep it out of git and off other local users.
 *
 * No HTTP, no module state beyond the static catalog — unit-testable.
 */
import fs from 'fs';
import path from 'path';

// The provider catalog the Settings UI renders. `env` is the process.env var
// the engine already reads (see PRODUCT-BUILD-PATH appendix + the map).
export const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic — Claude', env: 'ANTHROPIC_API_KEY', placeholder: 'sk-ant-…', blurb: 'Premium evaluation + tailoring.' },
  { id: 'gemini',    label: 'Google — Gemini',    env: 'GEMINI_API_KEY',    placeholder: 'AIza…',    blurb: 'Free-tier fit-scoring (Flash) — best value for big scan runs.' },
  { id: 'openai',    label: 'OpenAI — GPT',       env: 'OPENAI_API_KEY',    placeholder: 'sk-…',     blurb: 'Premium evaluation + tailoring.' },
  { id: 'nim',       label: 'NVIDIA NIM — Kimi',  env: 'KIMI_API_KEY',      placeholder: 'nvapi-…',  blurb: 'Hosted Kimi K2 — tailoring + apply form-fill.' },
];

// Non-secret tuning that travels with the keys (base URL + model overrides).
// `secret:false` → the real value is safe to return to the UI.
export const EXTRAS = [
  { env: 'KIMI_BASE_URL', label: 'Kimi base URL', placeholder: 'https://integrate.api.nvidia.com/v1' },
  { env: 'KIMI_MODEL',    label: 'Kimi model',    placeholder: 'moonshotai/kimi-k2-instruct' },
  { env: 'GEMINI_MODEL',  label: 'Gemini model',  placeholder: 'gemini-2.0-flash' },
];

// Per-task provider routing (consumed by the A2 LLM seam; persisted here now).
export const ROUTING_TASKS = [
  { id: 'scoring',   label: 'Fit-scoring (scan)',   default: 'gemini' },
  { id: 'tailoring', label: 'CV + cover tailoring',  default: 'nim' },
  { id: 'eval',      label: 'Deep evaluation report', default: 'anthropic' },
];

const SECRET_ENVS = new Set(PROVIDERS.map(p => p.env));
const EXTRA_ENVS = new Set(EXTRAS.map(e => e.env));
const ALL_ENVS = new Set([...SECRET_ENVS, ...EXTRA_ENVS]);
const PROVIDER_IDS = new Set(PROVIDERS.map(p => p.id));
const MAX_VALUE_LEN = 500;

export function secretsPath(configDir) { return path.join(configDir, 'secrets.json'); }

// Read the raw store ({} if absent/corrupt). Sync — safe to call at module load.
export function readStore(configDir) {
  try {
    const obj = JSON.parse(fs.readFileSync(secretsPath(configDir), 'utf8'));
    return (obj && typeof obj === 'object') ? obj : {};
  } catch { return {}; }
}

// Persist atomically (temp + rename) with 0600 perms.
export function writeStore(configDir, store) {
  fs.mkdirSync(configDir, { recursive: true });
  const p = secretsPath(configDir);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, p);
  try { fs.chmodSync(p, 0o600); } catch { /* best-effort on non-POSIX */ }
}

// Inject the stored values into process.env. The app-managed store is the
// source of truth, so it OVERWRITES whatever `.env`/launchd loaded for the
// managed keys; keys absent from the store fall back to the existing env.
// Returns the list of env vars injected.
export function loadSecretsIntoEnv(configDir, env = process.env) {
  const store = readStore(configDir);
  const injected = [];
  for (const k of ALL_ENVS) {
    const v = store[k];
    if (typeof v === 'string' && v) { env[k] = v; injected.push(k); }
  }
  return injected;
}

export function maskSecret(v) {
  if (!v) return '';
  const s = String(v);
  return s.length <= 8 ? '••••' : '••••' + s.slice(-4);
}

function readRouting(store) {
  const r = (store && store.__routing && typeof store.__routing === 'object') ? store.__routing : {};
  const out = {};
  for (const t of ROUTING_TASKS) {
    out[t.id] = PROVIDER_IDS.has(r[t.id]) ? r[t.id] : t.default;
  }
  return out;
}

// The full status object the Settings UI renders. Never returns raw secrets —
// only `configured`, `source`, and a masked tail. Extras (non-secret) return
// their real value so the user can see/edit base URL + model.
export function keyStatus(configDir, env = process.env) {
  const store = readStore(configDir);
  const providers = PROVIDERS.map(p => {
    const stored = typeof store[p.env] === 'string' ? store[p.env] : '';
    const live = env[p.env] || '';
    const val = stored || live;
    return {
      id: p.id, label: p.label, env: p.env, placeholder: p.placeholder, blurb: p.blurb,
      configured: !!val,
      source: stored ? 'app' : (live ? 'env' : 'none'),
      masked: maskSecret(val),
    };
  });
  const extras = EXTRAS.map(e => {
    const stored = typeof store[e.env] === 'string' ? store[e.env] : '';
    const val = stored || env[e.env] || '';
    return { env: e.env, label: e.label, placeholder: e.placeholder, value: val, configured: !!val };
  });
  return { providers, extras, routing: readRouting(store), tasks: ROUTING_TASKS };
}

// Validate a save payload. Returns string[] of errors (empty = ok).
// `values` maps env-var → string (non-empty sets it; '' clears it).
export function validateKeysPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') { errors.push('payload required'); return errors; }
  const values = payload.values;
  if (values != null) {
    if (typeof values !== 'object') { errors.push('values must be an object'); return errors; }
    for (const [k, v] of Object.entries(values)) {
      if (!ALL_ENVS.has(k)) { errors.push(`unknown key: ${k}`); continue; }
      if (v != null && (typeof v !== 'string' || v.length > MAX_VALUE_LEN)) errors.push(`invalid value for ${k}`);
    }
  }
  if (payload.routing != null) {
    if (typeof payload.routing !== 'object') errors.push('routing must be an object');
    else for (const [t, prov] of Object.entries(payload.routing)) {
      if (!ROUTING_TASKS.some(x => x.id === t)) errors.push(`unknown routing task: ${t}`);
      else if (!PROVIDER_IDS.has(prov)) errors.push(`unknown provider for ${t}: ${prov}`);
    }
  }
  return errors;
}

// Apply a save: mutate the store + process.env, persist, return new status.
// Non-empty value → set; empty string → clear (delete from store + env so the
// reader falls through to nothing). Unmentioned keys are left untouched.
export function applyKeysPayload(configDir, payload, env = process.env) {
  const store = readStore(configDir);
  const values = (payload && payload.values) || {};
  for (const [k, v] of Object.entries(values)) {
    if (!ALL_ENVS.has(k)) continue;
    if (typeof v === 'string' && v) { store[k] = v; env[k] = v; }
    else { delete store[k]; delete env[k]; }
  }
  if (payload && payload.routing && typeof payload.routing === 'object') {
    const cur = readRouting(store);
    for (const [t, prov] of Object.entries(payload.routing)) {
      if (ROUTING_TASKS.some(x => x.id === t) && PROVIDER_IDS.has(prov)) cur[t] = prov;
    }
    store.__routing = cur;
  }
  writeStore(configDir, store);
  return keyStatus(configDir, env);
}
