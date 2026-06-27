-- 0005_security_hardening.sql — close the Phase-0 ship-blockers from docs/AUDIT-REPORT.md.
-- Forward-only. Safe to run on a fresh project; CHECKs assume canonical existing data.
--
-- Closes:
--   • CRITICAL paywall bypass — RLS `for all` let any user upsert plan='studio' / zero usage.
--   • Quota TOCTOU — adds an atomic check-and-increment RPC.
--   • No audit trail — adds audit_log + writes from BYOK RPCs.
--   • Stripe replay/ordering — adds a stripe_events dedup table.
--   • Free-text status columns — adds CHECK constraints.

-- ── 1. Paywall lockdown: subscriptions + usage_counters become SELECT-only for users ──
-- Writes now happen ONLY via the service-role webhook (bypasses RLS) and the
-- SECURITY DEFINER RPCs below. Drop the over-broad `for all` policies from 0001.
drop policy if exists "own subscription" on public.subscriptions;
drop policy if exists "own usage"        on public.usage_counters;

create policy "read own subscription" on public.subscriptions
  for select using (user_id = auth.uid());
create policy "read own usage" on public.usage_counters
  for select using (user_id = auth.uid());

-- ── 2. Atomic quota: check-and-increment in one locked statement ──────────────
-- SECURITY DEFINER so it can write usage_counters despite the SELECT-only policy.
-- Returns the new count, or -1 when the cap is already reached (caller → 402).
-- Pass a large p_cap (e.g. 2147483647) for unlimited plans.
create or replace function public.consume_quota(p_metric text, p_cap integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_period text := to_char(now(), 'YYYY-MM');
  v_count  integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  insert into public.usage_counters (user_id, period, metric, count)
    values (v_uid, v_period, p_metric, 0)
    on conflict (user_id, period, metric) do nothing;
  -- The UPDATE row-locks the counter; concurrent callers serialize here.
  update public.usage_counters
     set count = count + 1, updated_at = now()
   where user_id = v_uid and period = v_period and metric = p_metric and count < p_cap
   returning count into v_count;
  if v_count is null then return -1; end if;   -- cap reached
  return v_count;
end;
$$;

-- Refund one unit (called when the metered operation fails AFTER consuming a slot).
create or replace function public.refund_quota(p_metric text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_period text := to_char(now(), 'YYYY-MM');
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  update public.usage_counters
     set count = greatest(0, count - 1), updated_at = now()
   where user_id = v_uid and period = v_period and metric = p_metric;
end;
$$;

-- Keep increment_usage working under the new SELECT-only policy (was SECURITY INVOKER
-- in 0001 → would now fail). Redefine as DEFINER; still scoped to auth.uid().
create or replace function public.increment_usage(p_metric text, p_n integer default 1)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_period text := to_char(now(), 'YYYY-MM');
  v_uid    uuid := auth.uid();
  v_count  integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  insert into public.usage_counters (user_id, period, metric, count)
    values (v_uid, v_period, p_metric, p_n)
  on conflict (user_id, period, metric)
    do update set count = public.usage_counters.count + p_n, updated_at = now()
  returning count into v_count;
  return v_count;
end;
$$;

revoke all on function public.consume_quota(text, integer)  from anon, public;
revoke all on function public.refund_quota(text)            from anon, public;
grant execute on function public.consume_quota(text, integer) to authenticated;
grant execute on function public.refund_quota(text)           to authenticated;

-- ── 3. Audit log (append-only; user reads own, no client insert) ──────────────
create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  action     text not null,                  -- e.g. byok.set | byok.get | plan.change
  target     text,                           -- e.g. provider name, plan id
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_user_created_idx on public.audit_log (user_id, created_at desc);
alter table public.audit_log enable row level security;
create policy "read own audit" on public.audit_log
  for select using (user_id = auth.uid());
-- No INSERT policy: only SECURITY DEFINER functions (below) and the service role write.

create or replace function public.log_audit(p_action text, p_target text, p_meta jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_log (user_id, action, target, meta)
    values (auth.uid(), p_action, p_target, coalesce(p_meta, '{}'::jsonb));
end;
$$;
revoke all on function public.log_audit(text, text, jsonb) from anon, public, authenticated;
-- callable only by other SECURITY DEFINER functions running as definer.

-- ── 4. BYOK RPCs now write the audit trail (redefine from 0002) ───────────────
create or replace function public.set_provider_key(p_provider text, p_key text)
returns void
language plpgsql security definer set search_path = public, vault
as $$
declare
  v_uid uuid := auth.uid();
  v_secret uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select secret_id into v_secret from public.provider_keys where user_id = v_uid and provider = p_provider;
  if v_secret is null then
    v_secret := vault.create_secret(p_key, 'byok:' || v_uid || ':' || p_provider, 'Hireloom BYO key');
    insert into public.provider_keys (user_id, provider, secret_id) values (v_uid, p_provider, v_secret);
  else
    perform vault.update_secret(v_secret, p_key);
    update public.provider_keys set updated_at = now() where user_id = v_uid and provider = p_provider;
  end if;
  perform public.log_audit('byok.set', p_provider, '{}'::jsonb);
end;
$$;

create or replace function public.get_provider_key(p_provider text)
returns text
language plpgsql security definer set search_path = public, vault
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select ds.decrypted_secret into v_key
    from public.provider_keys pk
    join vault.decrypted_secrets ds on ds.id = pk.secret_id
   where pk.user_id = v_uid and pk.provider = p_provider;
  perform public.log_audit('byok.get', p_provider, '{}'::jsonb);
  return v_key;
end;
$$;
revoke all on function public.set_provider_key(text, text) from anon, public;
revoke all on function public.get_provider_key(text)       from anon, public;
grant execute on function public.set_provider_key(text, text) to authenticated;
grant execute on function public.get_provider_key(text)       to authenticated;

-- Delete a provider key for the caller: removes the Vault secret + the row + logs it.
create or replace function public.delete_provider_key(p_provider text)
returns void
language plpgsql security definer set search_path = public, vault
as $$
declare
  v_uid uuid := auth.uid();
  v_secret uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select secret_id into v_secret from public.provider_keys where user_id = v_uid and provider = p_provider;
  if v_secret is not null then delete from vault.secrets where id = v_secret; end if;
  delete from public.provider_keys where user_id = v_uid and provider = p_provider;
  perform public.log_audit('byok.delete', p_provider, '{}'::jsonb);
end;
$$;
revoke all on function public.delete_provider_key(text) from anon, public;
grant execute on function public.delete_provider_key(text) to authenticated;

-- ── 5. Stripe webhook idempotency (service-role only; RLS on, no policies) ─────
create table if not exists public.stripe_events (
  id           text primary key,              -- Stripe event.id
  type         text,
  created       bigint,                        -- Stripe event.created (ordering guard)
  processed_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
-- No policies → only the service-role key (webhook) can read/write.

create index if not exists subscriptions_customer_idx on public.subscriptions (customer_id);
-- Ordering guard for the webhook: never apply an event older than the last one applied.
alter table public.subscriptions add column if not exists last_event_created bigint;

-- ── 6. CHECK constraints on status-bearing text columns ───────────────────────
alter table public.subscriptions
  add constraint subscriptions_plan_chk check (plan in ('free', 'pro', 'studio')) not valid;
alter table public.provider_keys
  add constraint provider_keys_provider_chk
  check (provider in ('anthropic', 'kimi', 'openrouter', 'gemini', 'openai')) not valid;
alter table public.roles
  add constraint roles_status_chk
  check (status in ('Evaluated','Applied','Responded','Interview','Offer','Rejected','Discarded','SKIP')) not valid;

-- ── 7. GDPR: user-initiated full account+data deletion ────────────────────────
-- Deletes auth.users → all public.* rows cascade (FKs on delete cascade). Vault
-- secrets are removed first (no FK cascade into vault).
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public, vault, auth
as $$
declare
  v_uid uuid := auth.uid();
  r record;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  for r in select secret_id from public.provider_keys where user_id = v_uid and secret_id is not null loop
    delete from vault.secrets where id = r.secret_id;
  end loop;
  perform public.log_audit('account.delete', null, '{}'::jsonb);
  delete from auth.users where id = v_uid;   -- cascades to all public.* tenant rows
end;
$$;
revoke all on function public.delete_my_account() from anon, public;
grant execute on function public.delete_my_account() to authenticated;
