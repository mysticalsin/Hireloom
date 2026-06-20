// Supabase-backed store adapter — same interface as the in-memory/file stores,
// but async and durable in Postgres. Takes an injected supabase-js client (so the
// engine has no SDK dependency and the adapter is unit-testable with a mock).
//
// tenantId === the Supabase user id (auth user uuid). Use a service-role client
// server-side (RLS bypassed; this adapter scopes every query by user_id itself),
// or a user-scoped client (RLS enforces the same). Mirrors supabase/migrations/0001_init.sql.
//
//   import { createClient } from '@supabase/supabase-js';
//   import { makeSupabaseStore } from './engine/store/supabase-store.mjs';
//   const store = makeSupabaseStore({ client: createClient(url, serviceKey) });

import { dedupeKey } from './store.mjs';

const ROLE_COLS = 'id,company,title,status,score,url,source,jd_text,created_at,updated_at';

function unwrap({ data, error }) {
  if (error) throw new Error(error.message || String(error));
  return data;
}

function toRole(r) {
  if (!r) return null;
  return {
    id: r.id, company: r.company, title: r.title, status: r.status,
    score: r.score ?? null, url: r.url ?? null, source: r.source ?? null,
    jdText: r.jd_text ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function toSub(s) {
  if (!s) return null;
  return {
    tenantId: s.user_id, plan: s.plan, status: s.status,
    currentPeriodEnd: s.current_period_end ?? null,
    customerId: s.customer_id ?? null, subscriptionId: s.subscription_id ?? null,
  };
}

export function makeSupabaseStore({ client, now = () => new Date().toISOString() } = {}) {
  if (!client) throw new Error('makeSupabaseStore: a supabase client is required');
  const period = () => now().slice(0, 7);

  return {
    // ---- roles ----
    async saveRole(userId, role = {}) {
      if (!role.company || !role.title) throw new Error('saveRole: company and title required');
      const row = {
        user_id: userId, dedupe_key: dedupeKey(role.company, role.title),
        company: role.company, title: role.title, status: role.status || 'Evaluated',
        score: role.score ?? null, url: role.url ?? null, source: role.source ?? null,
        jd_text: role.jdText ?? null, updated_at: now(),
      };
      const data = unwrap(await client.from('roles').upsert(row, { onConflict: 'user_id,dedupe_key' }).select(ROLE_COLS).single());
      return toRole(data);
    },
    async getRole(userId, roleId) {
      const data = unwrap(await client.from('roles').select(ROLE_COLS).eq('user_id', userId).eq('id', roleId).maybeSingle());
      return toRole(data);
    },
    async updateRoleStatus(userId, roleId, status) {
      const data = unwrap(await client.from('roles').update({ status, updated_at: now() }).eq('user_id', userId).eq('id', roleId).select(ROLE_COLS).maybeSingle());
      return toRole(data);
    },
    async listRoles(userId, { status, limit = 50 } = {}) {
      let q = client.from('roles').select(ROLE_COLS).eq('user_id', userId);
      if (status) q = q.eq('status', status);
      const data = unwrap(await q.order('created_at', { ascending: false }).limit(limit));
      return { items: (data || []).map(toRole), nextCursor: null };
    },

    // ---- reports ----
    async saveReport(userId, { roleId, markdown, score } = {}) {
      if (!markdown) throw new Error('saveReport: markdown required');
      const data = unwrap(await client.from('reports').insert({ user_id: userId, role_id: roleId ?? null, markdown, score: score ?? null }).select('id,role_id,markdown,score,created_at').single());
      return { id: data.id, tenantId: userId, roleId: data.role_id, markdown: data.markdown, score: data.score, createdAt: data.created_at };
    },
    async getReport(userId, reportId) {
      const data = unwrap(await client.from('reports').select('id,role_id,markdown,score,created_at').eq('user_id', userId).eq('id', reportId).maybeSingle());
      return data ? { id: data.id, tenantId: userId, roleId: data.role_id, markdown: data.markdown, score: data.score, createdAt: data.created_at } : null;
    },

    // ---- subscriptions / entitlement ----
    async setSubscription(userId, sub = {}) {
      const row = {
        user_id: userId, plan: sub.plan || 'free', status: sub.status || 'active',
        current_period_end: sub.currentPeriodEnd ?? null,
        customer_id: sub.customerId ?? null, subscription_id: sub.subscriptionId ?? null,
        updated_at: now(),
      };
      const data = unwrap(await client.from('subscriptions').upsert(row, { onConflict: 'user_id' }).select('*').single());
      return toSub(data);
    },
    async getSubscription(userId) {
      const data = unwrap(await client.from('subscriptions').select('*').eq('user_id', userId).maybeSingle());
      return toSub(data);
    },
    async tenantPlan(userId) {
      const sub = await this.getSubscription(userId);
      return sub?.plan || 'free';
    },

    // ---- usage metering ----
    async incrementUsage(userId, metric, n = 1) {
      const p = period();
      const cur = unwrap(await client.from('usage_counters').select('count').eq('user_id', userId).eq('period', p).eq('metric', metric).maybeSingle());
      const count = (cur?.count || 0) + n;
      unwrap(await client.from('usage_counters').upsert({ user_id: userId, period: p, metric, count, updated_at: now() }, { onConflict: 'user_id,period,metric' }).select('count').single());
      return count;
    },
    async getUsage(userId, metric, p = period()) {
      const cur = unwrap(await client.from('usage_counters').select('count').eq('user_id', userId).eq('period', p).eq('metric', metric).maybeSingle());
      return cur?.count || 0;
    },
  };
}
