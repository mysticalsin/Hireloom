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
  begin
    update public.subscriptions set plan = 'studio' where user_id = :'B';
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
  exception
    when insufficient_privilege then null; -- expected
  end;

  -- 4. BYOK isolation: provider_keys are SELECT-only-own; B sees none of A's (and none here).
  select count(*) into n from public.provider_keys where user_id = :'A';
  if n <> 0 then raise exception 'FAIL byok: B read A''s provider_keys'; end if;

  raise notice 'OK: RLS isolation + paywall lockdown + BYOK isolation';
end $$;

rollback;
