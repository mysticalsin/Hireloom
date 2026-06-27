-- 0009_tighten_grants.sql — defence-in-depth grant + constraint tightening. Forward-only.
--
-- Two safe hardening steps that close residual surface left by 0005–0008:
--
-- (a) increment_usage is dead code: 0005 noted "all metering routes through
--     consume_quota" and revoked its anon/public grant, but left the EXECUTE
--     grant to `authenticated` in place. A dead, signed-in-callable SECURITY
--     DEFINER function is needless surface — revoke it from `authenticated` too.
--     (We keep the function itself to stay forward-only; only the grant goes.)
--
-- (b) usage_counters.metric and rate_limits.metric are free-text columns. The
--     only valid values are the literals the edge functions pass; a typo or a
--     direct service-role write with a bad metric would silently create an
--     untracked counter/window. Pin them with CHECK constraints. NOT VALID so
--     existing rows are not scanned (mirrors 0005/0006 idiom for CHECKs on
--     populated tables) — the constraint still binds every future insert/update.

-- ── (a) Drop the residual EXECUTE grant on the dead increment_usage RPC ────────
revoke execute on function public.increment_usage(text, integer) from authenticated;

-- ── (b) Constrain the metric columns to their known vocabularies ───────────────
-- Guarded drop so this migration is safe to re-run.
alter table public.usage_counters drop constraint if exists usage_counters_metric_check;
alter table public.usage_counters
  add constraint usage_counters_metric_check
  check (metric in ('evaluationsPerMonth', 'packagesPerMonth')) not valid;

alter table public.rate_limits drop constraint if exists rate_limits_metric_check;
alter table public.rate_limits
  add constraint rate_limits_metric_check
  check (metric in ('evaluate', 'tailor', 'apply-assist', 'validate-key')) not valid;
