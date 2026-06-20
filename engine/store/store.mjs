// Tenant-scoped data-access layer.
//
// Schema contract: db/migrations/0001_init.sql. This is the in-memory adapter —
// the test seam and the local default. A Postgres/Drizzle adapter implementing the
// SAME interface drops in once hosting infra exists; callers never change.
//
// THE isolation rule (CLAUDE.md §4): every method is tenant-scoped and verifies
// tenant_id, so a cross-tenant id returns null/empty. Enforced here AND, in
// production, by Postgres RLS. Both layers, always.
//
//   import { makeInMemoryStore } from './engine/store/store.mjs';
//   const store = makeInMemoryStore();
//   const t = store.createTenant({ name: 'Acme' });
//   const r = store.saveRole(t.id, { company: 'Anthropic', title: 'Applied AI Engineer' });

/** Normalize "company|title" into a stable dedupe key. Pure. */
export function dedupeKey(company = '', title = '') {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${norm(company)}|${norm(title)}`;
}

/**
 * Create an in-memory store.
 * @param {object} [opts]
 * @param {() => string} [opts.now] clock returning an ISO timestamp (injectable for tests)
 */
export function makeInMemoryStore({ now = () => new Date().toISOString() } = {}) {
  const tenants = new Map();
  const users = new Map();
  const providerKeys = new Map();
  const roles = new Map();
  const reports = new Map();
  let counter = 0;
  let order = 0;
  const id = (p) => `${p}_${(++counter).toString(36)}`;

  // Return a record only if it belongs to the tenant (the isolation gate).
  const owned = (rec, tenantId) => (rec && rec.tenantId === tenantId ? rec : null);
  const strip = ({ _order, ...rest }) => rest; // hide internal sort key

  return {
    // ---- tenants / users ----
    createTenant({ name } = {}) {
      if (!name) throw new Error('createTenant: name required');
      const t = { id: id('t'), name, createdAt: now() };
      tenants.set(t.id, t);
      return { ...t };
    },
    createUser({ tenantId, email } = {}) {
      if (!tenants.has(tenantId)) throw new Error('createUser: unknown tenant');
      if (!email) throw new Error('createUser: email required');
      for (const u of users.values()) {
        if (u.tenantId === tenantId && u.email === email) throw new Error('createUser: email already exists for tenant');
      }
      const u = { id: id('u'), tenantId, email, createdAt: now() };
      users.set(u.id, u);
      return { ...u };
    },

    // ---- provider keys (BYOK; ciphertext only — never plaintext) ----
    upsertProviderKey(tenantId, { provider, ciphertext } = {}) {
      if (!provider || !ciphertext) throw new Error('upsertProviderKey: provider and ciphertext required');
      for (const k of providerKeys.values()) {
        if (k.tenantId === tenantId && k.provider === provider) {
          k.ciphertext = ciphertext; k.updatedAt = now();
          return { ...k };
        }
      }
      const k = { id: id('pk'), tenantId, provider, ciphertext, createdAt: now() };
      providerKeys.set(k.id, k);
      return { ...k };
    },
    getProviderKey(tenantId, provider) {
      for (const k of providerKeys.values()) {
        if (k.tenantId === tenantId && k.provider === provider) return { ...k };
      }
      return null;
    },

    // ---- roles (unified registry, deduped per tenant) ----
    saveRole(tenantId, role = {}) {
      if (!tenants.has(tenantId)) throw new Error('saveRole: unknown tenant');
      if (!role.company || !role.title) throw new Error('saveRole: company and title required');
      const key = dedupeKey(role.company, role.title);
      for (const r of roles.values()) {
        if (r.tenantId === tenantId && r.dedupeKey === key) {
          // upsert: merge provided fields, keep id + createdAt
          Object.assign(r, {
            status: role.status ?? r.status,
            score: role.score ?? r.score,
            url: role.url ?? r.url,
            source: role.source ?? r.source,
            jdText: role.jdText ?? r.jdText,
            company: role.company,
            title: role.title,
            updatedAt: now(),
          });
          return strip({ ...r });
        }
      }
      const r = {
        id: id('r'), tenantId, dedupeKey: key,
        company: role.company, title: role.title,
        status: role.status || 'Evaluated',
        score: role.score ?? null, url: role.url ?? null,
        source: role.source ?? null, jdText: role.jdText ?? null,
        createdAt: now(), updatedAt: now(), _order: ++order,
      };
      roles.set(r.id, r);
      return strip({ ...r });
    },
    getRole(tenantId, roleId) {
      const r = owned(roles.get(roleId), tenantId);
      return r ? strip({ ...r }) : null;
    },
    updateRoleStatus(tenantId, roleId, status) {
      const r = owned(roles.get(roleId), tenantId);
      if (!r) return null;
      r.status = status; r.updatedAt = now();
      return strip({ ...r });
    },
    listRoles(tenantId, { status, limit = 50, cursor } = {}) {
      let rows = [...roles.values()].filter((r) => r.tenantId === tenantId);
      if (status) rows = rows.filter((r) => r.status === status);
      rows.sort((a, b) => a._order - b._order);
      if (cursor) {
        const i = rows.findIndex((r) => r.id === cursor);
        rows = i >= 0 ? rows.slice(i + 1) : rows;
      }
      const page = rows.slice(0, limit);
      const nextCursor = rows.length > limit ? page[page.length - 1].id : null;
      return { items: page.map((r) => strip({ ...r })), nextCursor };
    },

    // ---- reports ----
    saveReport(tenantId, { roleId, markdown, score } = {}) {
      if (!tenants.has(tenantId)) throw new Error('saveReport: unknown tenant');
      if (!markdown) throw new Error('saveReport: markdown required');
      if (roleId && !owned(roles.get(roleId), tenantId)) throw new Error('saveReport: role not in tenant');
      const rep = { id: id('rep'), tenantId, roleId: roleId ?? null, markdown, score: score ?? null, createdAt: now() };
      reports.set(rep.id, rep);
      return { ...rep };
    },
    getReport(tenantId, reportId) {
      const rep = owned(reports.get(reportId), tenantId);
      return rep ? { ...rep } : null;
    },
  };
}
