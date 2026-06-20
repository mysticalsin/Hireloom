-- 0002_byok.sql — BYO provider keys (in Supabase Vault, encrypted at rest) + CV.
-- Forward-only. Keys are NEVER stored in plaintext: the secret lives in Vault, and
-- provider_keys holds only a secret reference. Read/write go through SECURITY DEFINER
-- RPCs scoped to auth.uid().

create extension if not exists supabase_vault with schema vault;

alter table public.profiles add column if not exists cv_md text;

create table if not exists public.provider_keys (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider   text not null,                 -- anthropic | kimi | openrouter | gemini
  secret_id  uuid,                           -- → vault.secrets(id); the encrypted key
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.provider_keys enable row level security;
-- Users may see WHICH providers they've configured (never the key material).
create policy "own provider keys" on public.provider_keys
  for select using (user_id = auth.uid());

-- Save / rotate a provider key for the caller. SECURITY DEFINER so it can write to
-- Vault; auth.uid() still resolves to the calling user.
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
end;
$$;

-- Read the decrypted key for the caller (used server-side by the evaluate function).
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
  return v_key;
end;
$$;

revoke all on function public.set_provider_key(text, text) from anon, public;
revoke all on function public.get_provider_key(text) from anon, public;
grant execute on function public.set_provider_key(text, text) to authenticated;
grant execute on function public.get_provider_key(text) to authenticated;
