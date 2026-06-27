-- 0014_retention_and_cleanup.sql — data-retention pruning + cleanup. Forward-only.
--
-- WHY: three append-only operational tables grow without bound and only the
-- operator ever reads them, so they have a finite useful life:
--   • audit_log         — sensitive-action trail (key set/get, plan, deletion).
--                         90 days covers incident review; older rows are dead weight.
--   • analytics_events  — first-party funnel events (0012). 180 days is two full
--                         activation quarters — enough for cohort/funnel analysis.
--   • stripe_events     — webhook idempotency guard (0005). Only the very recent tail
--                         matters for dedupe/replay protection; 30 days is generous.
-- This mirrors the 0008 prune idiom (SECURITY DEFINER, service_role-only, indexed
-- predicate) so a scheduled maintenance job can bound each table. Without scheduling
-- these tables leak storage + planner stats the same way rate_limits did pre-0008.
--
-- It also adds a funnel-query index, drops the now-dead increment_usage RPC (all
-- metering went through consume_quota as of 0005), and — IF pg_cron is available —
-- schedules every prune (including 0008's prune_rate_limits) so the operator does not
-- have to wire an external cron. The scheduling is wrapped so the migration never
-- hard-fails when pg_cron is absent (e.g. local dev).

-- ── 1. Funnel-query index (operator reads analytics by user + event) ──────────
create index if not exists analytics_events_user_idx
  on public.analytics_events (user_id, event);

-- ── 2. Drop dead code: increment_usage superseded by consume_quota (0005) ─────
drop function if exists public.increment_usage(text, integer);

-- ── 3. Prune functions. SECURITY DEFINER so a maintenance job runs them without
--       table-owner rights; predicates hit indexed timestamp columns. ──────────
create or replace function public.prune_audit_log()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.audit_log
   where created_at < now() - interval '90 days';
end;
$$;

create or replace function public.prune_analytics_events()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.analytics_events
   where created_at < now() - interval '180 days';
end;
$$;

create or replace function public.prune_stripe_events()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.stripe_events
   where processed_at < now() - interval '30 days';
end;
$$;

-- Execution restricted to the service role (maintenance / scheduled job only).
revoke all on function public.prune_audit_log() from anon, authenticated, public;
revoke all on function public.prune_analytics_events() from anon, authenticated, public;
revoke all on function public.prune_stripe_events() from anon, authenticated, public;
grant execute on function public.prune_audit_log() to service_role;
grant execute on function public.prune_analytics_events() to service_role;
grant execute on function public.prune_stripe_events() to service_role;

-- ── 4. Schedule every prune IF pg_cron is available. Guarded so the migration
--       never hard-fails when pg_cron is not installed (local dev, some hosts).
--       cron.schedule is idempotent on the job name, so re-running is safe. ─────
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('prune-rate-limits',     '*/15 * * * *', 'select public.prune_rate_limits()');
  perform cron.schedule('prune-audit-log',       '30 3 * * *',   'select public.prune_audit_log()');
  perform cron.schedule('prune-analytics-events','35 3 * * *',   'select public.prune_analytics_events()');
  perform cron.schedule('prune-stripe-events',   '40 3 * * *',   'select public.prune_stripe_events()');
exception when others then
  -- pg_cron unavailable (or insufficient privilege to create it): non-fatal.
  -- Invoke the prune functions from an external scheduler instead (see DEPLOY-HOSTED.md).
  raise notice 'pg_cron not available (%); prune jobs not scheduled — wire an external scheduler.', sqlerrm;
end;
$$;
