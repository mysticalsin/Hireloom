-- 0001_init.sql — Hireloom hosted platform: core multi-tenant schema.
-- Forward-only. Never edit a shipped migration; add a new one to change the schema.
-- This SQL is the schema contract; engine/store/store.mjs mirrors it (in-memory
-- adapter today, a Postgres/Drizzle adapter on the same interface once infra lands).
-- Dialect: PostgreSQL.

create table if not exists tenants (
  id          text primary key,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists users (
  id          text primary key,
  tenant_id   text not null references tenants(id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, email)
);

-- BYO provider keys. Stored envelope-encrypted (Phase 4 vault). NEVER plaintext.
create table if not exists provider_keys (
  id          text primary key,
  tenant_id   text not null references tenants(id) on delete cascade,
  provider    text not null,            -- anthropic | kimi | openrouter | gemini
  ciphertext  text not null,            -- KMS-wrapped key material
  created_at  timestamptz not null default now(),
  unique (tenant_id, provider)
);

-- Unified role registry (the one directory; see CLAUDE.md §11.1).
create table if not exists roles (
  id          text primary key,
  tenant_id   text not null references tenants(id) on delete cascade,
  dedupe_key  text not null,            -- normalized company + title
  company     text not null,
  title       text not null,
  status      text not null default 'Evaluated',
  score       numeric,
  url         text,
  source      text,                     -- tracker|pool|aviation|aecom|indeed|loose|url|text
  jd_text     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, dedupe_key)
);
create index if not exists roles_tenant_status_idx on roles (tenant_id, status);

create table if not exists reports (
  id          text primary key,
  tenant_id   text not null references tenants(id) on delete cascade,
  role_id     text references roles(id) on delete cascade,
  markdown    text not null,
  score       numeric,
  created_at  timestamptz not null default now()
);
create index if not exists reports_tenant_role_idx on reports (tenant_id, role_id);

-- Row-Level Security: defense in depth on top of the data-access layer. The app
-- connects as a non-superuser role and sets `app.tenant_id` per request; policies
-- that read current_setting('app.tenant_id') are added in a later migration once
-- the application DB role exists.
alter table tenants       enable row level security;
alter table users         enable row level security;
alter table provider_keys enable row level security;
alter table roles         enable row level security;
alter table reports       enable row level security;
