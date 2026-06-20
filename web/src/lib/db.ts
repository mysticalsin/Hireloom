import { supabase } from './supabase';

// All reads/writes are RLS-scoped to the signed-in user (auth.uid()) by Supabase —
// no tenant id needed in the client; the database enforces isolation.

export interface RoleRow {
  id: string;
  company: string;
  title: string;
  status: string;
  score: number | null;
  url: string | null;
  source: string | null;
  created_at: string;
}

export interface Subscription {
  plan: string;
  status: string;
  current_period_end: number | null;
}

export async function getSubscription(): Promise<Subscription | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('subscriptions').select('plan,status,current_period_end').maybeSingle();
  return (data as Subscription | null) ?? null;
}

export async function listRoles(): Promise<RoleRow[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('roles')
    .select('id,company,title,status,score,url,source,created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  return (data as RoleRow[]) ?? [];
}

export async function getUsage(metric = 'evaluationsPerMonth'): Promise<number> {
  if (!supabase) return 0;
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  const { data } = await supabase
    .from('usage_counters')
    .select('count')
    .eq('period', period)
    .eq('metric', metric)
    .maybeSingle();
  return (data as { count: number } | null)?.count ?? 0;
}
