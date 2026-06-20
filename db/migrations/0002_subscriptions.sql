-- 0002_subscriptions.sql — Stripe-backed entitlement. Forward-only.
-- One subscription row per tenant; webhook events upsert it (see
-- engine/billing/entitlement.mjs). Plan defaults to 'free' when unsubscribed.
-- Dialect: PostgreSQL.

create table if not exists subscriptions (
  tenant_id          text primary key references tenants(id) on delete cascade,
  plan               text not null default 'free',     -- free | pro | studio
  status             text not null default 'active',    -- Stripe subscription status
  current_period_end bigint,                            -- Stripe epoch seconds
  customer_id        text,                              -- Stripe customer id
  subscription_id    text,                              -- Stripe subscription id
  updated_at         timestamptz not null default now()
);
create index if not exists subscriptions_customer_idx on subscriptions (customer_id);

alter table subscriptions enable row level security;
