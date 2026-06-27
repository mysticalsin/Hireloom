import { supabase } from './supabase';

// First-party, privacy-first funnel analytics. Fire-and-forget: if Supabase isn't
// configured it no-ops; otherwise it inserts one row and swallows any error so it
// can never throw or block the UI. user_id is filled server-side by the column
// default (auth.uid()) under RLS — see supabase/migrations/0012_analytics.sql.
//
// Record ONLY non-PII event names + low-cardinality props (e.g. provider, plan) —
// never CV text, emails, API keys, or any personal data.
export function track(event: string, props: Record<string, string | number | boolean> = {}): void {
  if (!supabase) return;
  supabase.from('analytics_events').insert({ event, props }).then(() => {}, () => {});
}
