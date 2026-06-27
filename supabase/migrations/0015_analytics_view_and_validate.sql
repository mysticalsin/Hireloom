-- 0015_analytics_view_and_validate.sql — operator analytics reader + validate deferred CHECKs.
-- Forward-only.
--
-- (1) analytics_funnel: analytics_events (0012) is write-only for users (insert-own, no SELECT
--     policy) — operator telemetry. This view aggregates the activation funnel and is granted to
--     service_role ONLY, so the operator reads it via the Supabase SQL editor / service role.
--     The view runs with owner privileges (reads past the table's RLS) and is unreachable by
--     anon/authenticated, so no user can read the funnel.
-- (2) VALIDATE the CHECK constraints that 0005/0009/0011/0013 added NOT VALID. On a fresh deploy
--     the data conforms to the fixed vocab, so validation marks them enforced for all rows too.

create or replace view public.analytics_funnel as
  select
    event,
    count(*)                as total_events,
    count(distinct user_id) as distinct_users,
    max(created_at)         as last_seen
  from public.analytics_events
  group by event;

revoke all on public.analytics_funnel from anon, authenticated, public;
grant select on public.analytics_funnel to service_role;

-- Validate the deferred CHECK constraints (fresh-deploy data conforms to the fixed vocab).
alter table public.subscriptions  validate constraint subscriptions_plan_chk;
alter table public.provider_keys  validate constraint provider_keys_provider_chk;
alter table public.roles          validate constraint roles_status_chk;
alter table public.usage_counters validate constraint usage_counters_metric_check;
alter table public.rate_limits    validate constraint rate_limits_metric_check;
