-- 0006_rate_limits.sql — per-user, per-metric request rate limiting on the metered
-- edge functions (evaluate / tailor / apply-assist). Forward-only.
--
-- The monthly quota (0005 consume_quota) caps total spend per billing period; this
-- adds a short fixed-window burst cap so a single account can't hammer the LLM
-- providers (abuse + cost control) inside a quota allowance. Fixed-window counter:
-- the window is now() floored to p_window_seconds, so all callers in the same window
-- share one counter row and serialize on the UPDATE lock.

-- ── 1. Counter table: one row per (user, metric, window) ──────────────────────
create table if not exists public.rate_limits (
  user_id      uuid not null references auth.users(id) on delete cascade,
  metric       text not null,                    -- e.g. evaluate | tailor | apply-assist
  window_start timestamptz not null,             -- now() floored to the window size
  count        integer not null default 0,
  primary key (user_id, metric, window_start)
);
alter table public.rate_limits enable row level security;
create policy "read own rate limits" on public.rate_limits
  for select using (user_id = auth.uid());
-- No INSERT/UPDATE policy: only the SECURITY DEFINER function below (and the
-- service role) ever writes this table.

-- ── 2. Atomic check-and-increment for the current fixed window ────────────────
-- SECURITY DEFINER so it can write rate_limits despite the SELECT-only policy.
-- Returns true while the caller is within p_limit for the current window, false once
-- the limit is exceeded. The window is now() floored to p_window_seconds.
create or replace function public.check_rate_limit(p_metric text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_window timestamptz;
  v_count  integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  -- Align the window: floor now() to a multiple of p_window_seconds (epoch math).
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits (user_id, metric, window_start, count)
    values (v_uid, p_metric, v_window, 0)
    on conflict (user_id, metric, window_start) do nothing;
  -- The UPDATE row-locks the counter; concurrent callers serialize here.
  update public.rate_limits
     set count = count + 1
   where user_id = v_uid and metric = p_metric and window_start = v_window
   returning count into v_count;
  return v_count <= p_limit;
end;
$$;
revoke all on function public.check_rate_limit(text, integer, integer) from anon, public;
grant execute on function public.check_rate_limit(text, integer, integer) to authenticated;
