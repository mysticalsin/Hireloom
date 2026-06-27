-- 0011_demo_eval.sql — keyless "try a sample score" demo. Forward-only.
--
-- Adds the one-per-user flag the demo-eval edge function sets after a signed-in user
-- (who has not added a BYO key yet) runs ONE sample A-G evaluation on the OPERATOR's
-- key. profiles is already RLS-scoped ("own profile", id = auth.uid()) from 0001, so the
-- new column inherits that policy — no new RLS is needed and nothing is loosened. The
-- edge function writes the flag with the service role so a client cannot skip the write.

alter table public.profiles
  add column if not exists demo_used boolean not null default false;

-- demo-eval reuses the existing per-user burst limiter (0006/0010 check_rate_limit) under a
-- new metric. 0009 pinned rate_limits.metric to a fixed vocabulary with a CHECK; extend it
-- so 'demo-eval' is accepted (otherwise the limiter's insert would violate the constraint).
-- NOT VALID mirrors the 0009 idiom (existing rows are not re-scanned; future writes bind).
alter table public.rate_limits drop constraint if exists rate_limits_metric_check;
alter table public.rate_limits
  add constraint rate_limits_metric_check
  check (metric in ('evaluate', 'tailor', 'apply-assist', 'validate-key', 'demo-eval')) not valid;
