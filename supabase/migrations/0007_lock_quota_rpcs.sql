-- 0007_lock_quota_rpcs.sql — CRISIS fix (security panel, floor breach).
-- 0005 GRANTed refund_quota(text)/consume_quota(text,integer) to `authenticated`, scoped by
-- auth.uid(). A signed-in user could therefore call supabase.rpc('refund_quota',{...}) directly
-- from the browser with their own JWT and decrement their own monthly counter at will →
-- unlimited free evaluations (cap 10) + tailoring packages (cap 3) = paywall bypass.
--
-- Fix: re-key both RPCs by an explicit p_user_id and lock EXECUTE to service_role only. The
-- edge functions verify the caller's JWT, then call these with the SERVICE-ROLE client passing
-- the verified user.id — so the client can no longer reach refund_quota at all. Forward-only.

create or replace function public.consume_quota(p_user_id uuid, p_metric text, p_cap integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_period text := to_char(now(), 'YYYY-MM');
  v_count  integer;
begin
  if p_user_id is null then raise exception 'user required'; end if;
  insert into public.usage_counters (user_id, period, metric, count)
    values (p_user_id, v_period, p_metric, 0)
    on conflict (user_id, period, metric) do nothing;
  -- Row-locks the counter; concurrent callers serialize here.
  update public.usage_counters
     set count = count + 1, updated_at = now()
   where user_id = p_user_id and period = v_period and metric = p_metric and count < p_cap
   returning count into v_count;
  if v_count is null then return -1; end if;   -- cap reached
  return v_count;
end;
$$;

create or replace function public.refund_quota(p_user_id uuid, p_metric text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_period text := to_char(now(), 'YYYY-MM');
begin
  if p_user_id is null then raise exception 'user required'; end if;
  update public.usage_counters
     set count = greatest(0, count - 1), updated_at = now()
   where user_id = p_user_id and period = v_period and metric = p_metric;
end;
$$;

-- Remove the insecure auth.uid()-based overloads (drops their grant to `authenticated`).
drop function if exists public.consume_quota(text, integer);
drop function if exists public.refund_quota(text);

-- Execution restricted to the service role (edge functions use the service-role client).
revoke all on function public.consume_quota(uuid, text, integer) from anon, authenticated, public;
revoke all on function public.refund_quota(uuid, text)           from anon, authenticated, public;
grant execute on function public.consume_quota(uuid, text, integer) to service_role;
grant execute on function public.refund_quota(uuid, text)           to service_role;
