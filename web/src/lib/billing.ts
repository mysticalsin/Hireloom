import { supabase } from './supabase';

// Starts Stripe Checkout via the `checkout` Edge Function and redirects there.
export async function startCheckout(plan: 'pro' | 'studio'): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Billing is not configured yet.' };
  const { data, error } = await supabase.functions.invoke('checkout', { body: { plan } });
  if (error) return { error: error.message };
  const url = (data as { url?: string } | null)?.url;
  if (url) { window.location.href = url; return {}; }
  return { error: 'No checkout URL returned.' };
}

// Opens the Stripe Customer Portal (manage subscription / payment method / invoices).
export async function openBillingPortal(): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Billing is not configured yet.' };
  const { data, error } = await supabase.functions.invoke('billing-portal', { body: {} });
  if (error) return { error: error.message };
  const url = (data as { url?: string } | null)?.url;
  if (url) { window.location.href = url; return {}; }
  return { error: 'No portal URL returned.' };
}
