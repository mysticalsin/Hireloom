import { supabase } from './supabase';

export async function getCv(): Promise<string> {
  if (!supabase) return '';
  const { data } = await supabase.from('profiles').select('cv_md').maybeSingle();
  return (data as { cv_md?: string } | null)?.cv_md ?? '';
}

export async function saveCv(cv: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Not configured.' };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };
  const { error } = await supabase.from('profiles').upsert({ id: user.id, cv_md: cv, updated_at: new Date().toISOString() });
  return { error: error?.message };
}

export async function getSavedProviders(): Promise<string[]> {
  if (!supabase) return [];
  const { data } = await supabase.from('provider_keys').select('provider');
  return ((data as { provider: string }[] | null) ?? []).map((r) => r.provider);
}

export async function saveProviderKey(provider: string, apiKey: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Not configured.' };
  // Stored in Supabase Vault (encrypted at rest) via a SECURITY DEFINER RPC —
  // the key never lands in an app table or the browser after this call.
  const { error } = await supabase.rpc('set_provider_key', { p_provider: provider, p_key: apiKey });
  return { error: error?.message };
}
