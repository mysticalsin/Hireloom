// Supabase Edge Function: create a Stripe Checkout session for the signed-in user.
// The SPA calls it via supabase.functions.invoke('checkout', { body: { plan } }).
// Hardened: origin-pinned CORS + sanitized errors (docs/AUDIT-REPORT.md).
//
// Deploy: supabase functions deploy checkout
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_STUDIO, SITE_URL.
import Stripe from 'npm:stripe@^16';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { preflight, jsonResponse, errorResponse } from '../_shared/http.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const PRICE: Record<string, string | undefined> = {
  pro: Deno.env.get('STRIPE_PRICE_PRO'),
  studio: Deno.env.get('STRIPE_PRICE_STUDIO'),
};
const SITE = Deno.env.get('SITE_URL') ?? 'http://localhost:5173';

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405, origin);

  // Identify the caller from their JWT (RLS-scoped client).
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401, origin);

  const { plan } = await req.json().catch(() => ({}));
  const price = PRICE[plan as string];
  if (!price) return jsonResponse({ error: 'unknown or unconfigured plan' }, 400, origin);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: `${SITE}/?billing=success`,
      cancel_url: `${SITE}/?billing=cancel`,
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      metadata: { tenantId: user.id, priceId: price },
      subscription_data: { metadata: { tenantId: user.id } },
    });
    return jsonResponse({ url: session.url }, 200, origin);
  } catch (err) {
    return errorResponse(502, 'Could not start checkout. Please try again.', err, origin);
  }
});
