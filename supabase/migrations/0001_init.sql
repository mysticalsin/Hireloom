-- Hireloom — Supabase schema. Each authenticated user is a tenant; isolation is
-- enforced by RLS using auth.uid(). Run in the Supabase SQL editor or via the CLI.
-- Forward-only.

-- ── profiles (1:1 with auth.users) ──────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── subscriptions (one per user; Stripe-backed) ─────────────────────────
create table if not exists public.subscriptions (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  plan               text not null default 'free',     -- free | pro | studio
  status             text not null default 'active',
  current_period_end bigint,
  customer_id        text,
  subscription_id    text,
  updated_at         timestamptz not null default now()
);

-- ── roles (unified registry; deduped per user) ──────────────────────────
create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dedupe_key  text not null,                            -- normalized company + title
  company     text not null,
  title       text not null,
  status      text not null default 'Evaluated',
  score       numeric,
  url         text,
  source      text,
  jd_text     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index if not exists roles_user_status_idx on public.roles (user_id, status);

-- ── reports (A-G evaluations) ───────────────────────────────────────────
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role_id     uuid references public.roles(id) on delete cascade,
  markdown    text not null,
  score       numeric,
  created_at  timestamptz not null default now()
);
create index if not exists reports_user_role_idx on public.reports (user_id, role_id);

-- ── usage_counters (monthly quota metering) ─────────────────────────────
create table if not exists public.usage_counters (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period     text not null,                             -- 'YYYY-MM'
  metric     text not null,                             -- evaluationsPerMonth | packagesPerMonth
  count      integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, period, metric)
);

-- ── Row-Level Security: a user can only touch their own rows ─────────────
alter table public.profiles       enable row level security;
alter table public.subscriptions  enable row level security;
alter table public.roles          enable row level security;
alter table public.reports        enable row level security;
alter table public.usage_counters enable row level security;

create policy "own profile"        on public.profiles       for all using (id = auth.uid())      with check (id = auth.uid());
create policy "own subscription"   on public.subscriptions  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own roles"          on public.roles          for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own reports"        on public.reports        for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own usage"          on public.usage_counters for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── On signup: create the profile + a free subscription automatically ───
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
    values (new.id, new.email, new.raw_user_meta_data->>'full_name')
    on conflict (id) do nothing;
  insert into public.subscriptions (user_id, plan, status)
    values (new.id, 'free', 'active')
    on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Atomic monthly usage increment (callable from the client under RLS) ─
create or replace function public.increment_usage(p_metric text, p_n integer default 1)
returns integer
language plpgsql
security invoker
as $$
declare
  v_period text := to_char(now(), 'YYYY-MM');
  v_count  integer;
begin
  insert into public.usage_counters (user_id, period, metric, count)
    values (auth.uid(), v_period, p_metric, p_n)
  on conflict (user_id, period, metric)
    do update set count = public.usage_counters.count + p_n, updated_at = now()
  returning count into v_count;
  return v_count;
end;
$$;
