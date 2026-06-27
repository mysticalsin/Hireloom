-- 0010_rate_limit_tune.sql — collapse check_rate_limit's two-statement
-- insert-then-update into a single upsert. Forward-only.
--
-- 0006 did an `insert … on conflict do nothing` to seed the counter row, then a
-- separate `update … returning` to increment and read it back — two round-trips on
-- every metered call (evaluate / tailor / apply-assist). The increment_usage idiom
-- from 0005 already proves a single `insert … on conflict do update … returning`
-- both creates the row and increments it atomically (the conflict path row-locks the
-- existing row, so concurrent callers still serialize). Adopt that idiom here to drop
-- one statement per call while keeping identical semantics (count starts at 1 on the
-- first hit, +1 each subsequent hit, true while count <= p_limit). Same signature,
-- SECURITY DEFINER, search_path, auth.uid() null-check, and grants as 0006.
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
  -- Single upsert: create the window row at count 1, or increment the existing one.
  -- The conflict path row-locks the counter, so concurrent callers serialize here.
  insert into public.rate_limits (user_id, metric, window_start, count)
    values (v_uid, p_metric, v_window, 1)
  on conflict (user_id, metric, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;
