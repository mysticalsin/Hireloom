-- 0003_tailorings.sql — stored tailored packages (CV + cover letter) per role.
-- Forward-only. One package per (user, role); regenerating upserts. RLS-scoped.

create table if not exists public.tailorings (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  content    jsonb not null,            -- { title, summary, experience[], competencies, tools, coverLetter[] }
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

alter table public.tailorings enable row level security;
create policy "own tailorings" on public.tailorings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
