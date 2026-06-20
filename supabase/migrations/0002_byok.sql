-- 0002_byok.sql — BYO provider keys + the user's CV. Forward-only.
-- NOTE: api_key is stored RLS-protected for v1. For production, move to Supabase
-- Vault (pgsodium) and store only a secret reference here. Flagged in the app.

alter table public.profiles add column if not exists cv_md text;

create table if not exists public.provider_keys (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider   text not null,                 -- anthropic | kimi | openrouter | gemini
  api_key    text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.provider_keys enable row level security;
create policy "own provider keys" on public.provider_keys
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
