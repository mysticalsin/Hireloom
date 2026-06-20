import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// True once the project's URL + anon key are set. The UI degrades gracefully
// (auth disabled, friendly message) until then so the page still renders.
export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('YOUR-PROJECT'));

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
