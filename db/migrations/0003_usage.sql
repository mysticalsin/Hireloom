-- 0003_usage.sql — per-tenant, per-month usage counters for plan quotas.
-- Forward-only. One row per (tenant, period, metric); the app upserts and the
-- calendar month (YYYY-MM) is the natural reset boundary. Dialect: PostgreSQL.

create table if not exists usage_counters (
  tenant_id  text not null references tenants(id) on delete cascade,
  period     text not null,          -- 'YYYY-MM'
  metric     text not null,          -- evaluationsPerMonth | packagesPerMonth
  count      integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, period, metric)
);

alter table usage_counters enable row level security;
