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

export interface Report { markdown: string; score: number | null; created_at: string; }

export interface Tailoring {
  title: string;
  summary: string;
  experience: { title: string; period: string; location: string; bullets: string[] }[];
  competencies: string;
  tools: string;
  coverLetter: string[];
}

export async function getTailoring(roleId: string): Promise<Tailoring | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('tailorings').select('content').eq('role_id', roleId).maybeSingle();
  return (data as { content: Tailoring } | null)?.content ?? null;
}

export interface ApplyAnswers { answers: { question: string; answer: string }[]; }

export async function getApplyAnswers(roleId: string): Promise<ApplyAnswers | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('apply_answers').select('content').eq('role_id', roleId).maybeSingle();
  return (data as { content: ApplyAnswers } | null)?.content ?? null;
}

export async function getReportForRole(roleId: string): Promise<Report | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('reports')
    .select('markdown,score,created_at')
    .eq('role_id', roleId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Report | null) ?? null;
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
