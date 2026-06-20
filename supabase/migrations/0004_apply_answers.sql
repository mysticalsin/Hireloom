-- 0004_apply_answers.sql — generated application answers per role (assisted apply).
-- Forward-only. One set per (user, role); RLS-scoped.

create table if not exists public.apply_answers (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  content    jsonb not null,            -- { answers: [{ question, answer }] }
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

alter table public.apply_answers enable row level security;
create policy "own apply answers" on public.apply_answers
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
