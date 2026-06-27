-- Tenant-isolation + paywall-lockdown proof (audit P0 #2/#4).
-- Run against a fresh `supabase start` database:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 \
--        -f supabase/tests/rls_isolation.sql
-- Any failed assertion RAISEs and aborts psql (non-zero exit) → CI fails.
-- NOTE: first CI run validates the exact JWT-claim idiom; keep this green before charging anyone.

\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'

begin;

-- Seed two auth users; the handle_new_user trigger creates their profiles + free subscriptions.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  (:'A', 'authenticated', 'authenticated', 'a@test.dev', 'x', now(), now(), now()),
  (:'B', 'authenticated', 'authenticated', 'b@test.dev', 'x', now(), now(), now());

-- Act as user A: create a role (RLS WITH CHECK allows own-row insert).
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'A', 'role', 'authenticated')::text, true);
insert into public.roles (user_id, dedupe_key, company, title) values (:'A', 'acme|eng', 'Acme', 'Engineer');

-- Switch to user B for the assertions.
select set_config('request.jwt.claims', json_build_object('sub', :'B', 'role', 'authenticated')::text, true);

do $$
declare
  n int;
begin
  -- 1. Tenant isolation: B cannot read A's roles.
  select count(*) into n from public.roles where company = 'Acme';
  if n <> 0 then raise exception 'FAIL isolation: B read % of A''s role rows', n; end if;

  -- 2. Paywall lockdown: B cannot self-grant a paid plan. subscriptions is SELECT-only
  --    for authenticated (migration 0005), so this UPDATE must be denied (42501).
  --    An RLS-blocked UPDATE with no matching policy affects 0 rows SILENTLY (no
  --    exception), so assert row_count = 0 in addition to catching insufficient_privilege.
  begin
    update public.subscriptions set plan = 'studio' where user_id = :'B';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL paywall: B updated % subscription row(s) to studio', n; end if;
    -- If the update somehow applied, that is a paywall breach.
    if exists (select 1 from public.subscriptions where plan = 'studio') then
      raise exception 'FAIL paywall: B self-upgraded to studio';
    end if;
  exception
    when insufficient_privilege then null; -- expected: RLS denied the write
  end;

  -- 3. Paywall lockdown: B cannot zero their own usage counter.
  begin
    update public.usage_counters set count = 0 where user_id = :'B';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL paywall: B zeroed % usage_counter row(s)', n; end if;
  exception
    when insufficient_privilege then null; -- expected
  end;

  -- 3b. Paywall lockdown: B cannot self-INSERT a paid subscription. There is no
  --     INSERT policy on subscriptions (writes go via the service-role webhook /
  --     SECURITY DEFINER RPCs only), so a fresh studio row must be rejected or
  --     affect 0 rows.
  begin
    insert into public.subscriptions (user_id, plan) values (:'B', 'studio');
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL paywall: B self-inserted % studio subscription row(s)', n; end if;
  exception
    when insufficient_privilege then null; -- expected: RLS WITH CHECK denied the insert
  end;

  -- 4. BYOK isolation: provider_keys are SELECT-only-own; B sees none of A's (and none here).
  select count(*) into n from public.provider_keys where user_id = :'A';
  if n <> 0 then raise exception 'FAIL byok: B read A''s provider_keys'; end if;

  -- 5. Quota-RPC lockdown (migration 0007): consume_quota/refund_quota are EXECUTE-revoked
  --    from `authenticated` (service-role only). A user JWT calling refund_quota directly was
  --    the paywall bypass — it must now be denied (42501).
  begin
    perform public.refund_quota(:'B'::uuid, 'evaluationsPerMonth');
    raise exception 'FAIL paywall: B called refund_quota directly (grant not revoked)';
  exception
    when insufficient_privilege then null; -- expected
  end;
  begin
    perform public.consume_quota(:'B'::uuid, 'evaluationsPerMonth', 10);
    raise exception 'FAIL paywall: B called consume_quota directly (grant not revoked)';
  exception
    when insufficient_privilege then null; -- expected
  end;

  -- 6. Rate-limit table (migration 0006): SELECT-own only, no write policy → B cannot
  --    INSERT directly (would otherwise let a user reset their own burst counter).
  begin
    insert into public.rate_limits (user_id, metric, window_start, count) values (:'B', 'evaluate', now(), 0);
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL ratelimit: B self-inserted % rate_limits row(s)', n; end if;
  exception
    when insufficient_privilege then null; -- expected
  end;

  raise notice 'OK: RLS isolation + paywall lockdown + quota-RPC lockdown + BYOK isolation';
end $$;

rollback;
