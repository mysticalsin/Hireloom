-- 0012_analytics.sql — first-party, privacy-first funnel analytics. Forward-only.
--
-- WHY: the operator needs to measure activation (signup → key added → CV added →
-- first score → upgrade) to find where new users drop off. This is FIRST-PARTY
-- only — no third-party tracker, no ad pixel, no cookies — consistent with the
-- app's "no ad tracking" CookieConsent stance.
--
-- PRIVACY: rows carry NO PII. The client writes only a low-cardinality event name
-- (e.g. 'signup', 'eval_run') and low-cardinality props (e.g. provider, plan) —
-- never CV text, emails, or API keys (see web/src/lib/analytics.ts). user_id uses
-- the auth.uid() default so events bind to the caller for funnel cohorting, and the
-- row cascades away on account deletion (GDPR erasure).
--
-- ACCESS: authenticated users may INSERT only their own events (write-only). There
-- is deliberately NO SELECT policy for users — the funnel table is read solely by
-- the operator via the service role (which bypasses RLS). A user can emit events
-- but can never read the funnel.

create table if not exists public.analytics_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event      text not null,
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists analytics_events_event_created_idx
  on public.analytics_events (event, created_at desc);

alter table public.analytics_events enable row level security;
-- Write-only for users: insert your own events, scoped to auth.uid(). No SELECT
-- policy → only the service role (operator) can read the funnel.
create policy "insert own analytics" on public.analytics_events
  for insert to authenticated with check (user_id = auth.uid());
