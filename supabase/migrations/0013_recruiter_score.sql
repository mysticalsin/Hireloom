-- 0013_recruiter_score.sql — stored recruiter / hiring-manager scorecards per role.
-- Forward-only. The INVERSE of evaluate: evaluate scores a role for the user; this
-- scores the user's CV against a role through a screening lens. One scorecard per
-- (user, role); re-scoring upserts. RLS-scoped. BYOK + free-capped (3/mo, like
-- packages); Pro/Studio unlimited.

create table if not exists public.recruiter_scores (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  content    jsonb not null,            -- { verdict, headline, sixSecondScan, criteria[], redFlags[], gapsToClose[], fairnessNote }
  created_at timestamptz not null default now(),
  unique (user_id, role_id)             -- one per role; backs the (user_id, role_id) lookup index + upsert onConflict
);

alter table public.recruiter_scores enable row level security;
-- Mirrors the tailorings RLS idiom (0003): a single FOR ALL policy = own select +
-- own insert/update/delete, both scoped to auth.uid().
create policy "own recruiter_scores" on public.recruiter_scores
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Cross-migration: extend the metric CHECK vocabularies ──────────────────────
-- recruiter-score adds a new monthly quota metric. 0009 pinned usage_counters.metric
-- to a fixed vocabulary with a CHECK; extend it so 'recruiterScoresPerMonth' is accepted
-- (otherwise consume_quota's insert would violate the constraint). NOT VALID mirrors the
-- 0009/0011 idiom (existing rows are not re-scanned; future writes bind).
alter table public.usage_counters drop constraint if exists usage_counters_metric_check;
alter table public.usage_counters
  add constraint usage_counters_metric_check
  check (metric in ('evaluationsPerMonth', 'packagesPerMonth', 'recruiterScoresPerMonth')) not valid;

-- recruiter-score also reuses the per-user burst limiter (0006/0010 check_rate_limit)
-- under a new metric. 0009/0011 pinned rate_limits.metric to a fixed vocabulary; extend it
-- so 'recruiter-score' is accepted (otherwise the limiter's insert would violate the CHECK).
-- Keep the full existing vocabulary (incl. 'demo-eval' from 0011) and add the new value.
alter table public.rate_limits drop constraint if exists rate_limits_metric_check;
alter table public.rate_limits
  add constraint rate_limits_metric_check
  check (metric in ('evaluate', 'tailor', 'apply-assist', 'validate-key', 'demo-eval', 'recruiter-score')) not valid;
