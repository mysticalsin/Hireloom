-- 0008_rate_limits_prune.sql — TTL/pruning for public.rate_limits. Forward-only.
--
-- 0006 added rate_limits as a fixed-window counter: one row per (user, metric,
-- window_start), and nothing ever deletes them. Left unmanaged the table grows
-- unbounded (one row per user/metric/minute, forever) — a slow storage + planner
-- leak. Windows older than the longest burst window are dead the moment they roll
-- over, so they can be pruned aggressively.

-- ── 1. Index the prune predicate so the DELETE never scans the whole table ─────
create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- ── 2. Prune stale windows. SECURITY DEFINER so a maintenance job can run it ───
-- without table-owner rights. 1 hour comfortably outlives any fixed window.
create or replace function public.prune_rate_limits()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.rate_limits
   where window_start < now() - interval '1 hour';
end;
$$;

-- Execution restricted to the service role (maintenance / scheduled job only).
revoke all on function public.prune_rate_limits() from anon, authenticated, public;
grant execute on function public.prune_rate_limits() to service_role;

-- Scheduling: run this periodically (e.g. hourly). If the pg_cron extension is
-- enabled, schedule it there, for example:
--   select cron.schedule('prune-rate-limits', '0 * * * *', 'select public.prune_rate_limits()');
-- Otherwise invoke it from an external maintenance job. We do NOT call
-- cron.schedule here — this migration must not assume pg_cron is installed.
