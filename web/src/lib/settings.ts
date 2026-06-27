import { supabase } from './supabase';

export async function getCv(): Promise<string> {
  if (!supabase) return '';
  const { data, error } = await supabase.from('profiles').select('cv_md').maybeSingle();
  if (error) throw new Error(error.message); // never silently blank a saved CV
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
  const { data, error } = await supabase.from('provider_keys').select('provider');
  if (error) throw new Error(error.message);
  return ((data as { provider: string }[] | null) ?? []).map((r) => r.provider);
}

export async function deleteProviderKey(provider: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Not configured.' };
  // provider_keys is SELECT-only under RLS; deletion (and Vault secret removal)
  // goes through a SECURITY DEFINER RPC scoped to auth.uid().
  const { error } = await supabase.rpc('delete_provider_key', { p_provider: provider });
  return { error: error?.message };
}

// GDPR data portability: export everything the user owns as JSON. RLS scopes each
// read to the caller. API key MATERIAL is never exported (it lives in Vault and is
// never returned to the client) — only which providers are configured.
export async function exportMyData(): Promise<{ error?: string; url?: string }> {
  if (!supabase) return { error: 'Not configured.' };
  try {
    const [profile, roles, reports, tailorings, applies, subs, providers] = await Promise.all([
      supabase.from('profiles').select('*').maybeSingle(),
      supabase.from('roles').select('*'),
      supabase.from('reports').select('*'),
      supabase.from('tailorings').select('*'),
      supabase.from('apply_answers').select('*'),
      supabase.from('subscriptions').select('plan,status,current_period_end'),
      supabase.from('provider_keys').select('provider,updated_at'),
    ]);
    const err = profile.error || roles.error || reports.error || tailorings.error || applies.error || subs.error || providers.error;
    if (err) return { error: err.message };
    const payload = {
      exportedAt: new Date().toISOString(),
      profile: profile.data, roles: roles.data, reports: reports.data,
      tailorings: tailorings.data, applyAnswers: applies.data,
      subscription: subs.data, configuredProviders: providers.data,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    return { url: URL.createObjectURL(blob) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// GDPR erasure: deletes the auth identity → all tenant rows cascade, Vault secrets
// removed (SECURITY DEFINER RPC from migration 0005). Irreversible.
export async function deleteMyAccount(): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Not configured.' };
  const { error } = await supabase.rpc('delete_my_account');
  return { error: error?.message };
}

export async function saveProviderKey(provider: string, apiKey: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Not configured.' };
  // Stored in Supabase Vault (encrypted at rest) via a SECURITY DEFINER RPC —
  // the key never lands in an app table or the browser after this call.
  const { error } = await supabase.rpc('set_provider_key', { p_provider: provider, p_key: apiKey });
  return { error: error?.message };
}
