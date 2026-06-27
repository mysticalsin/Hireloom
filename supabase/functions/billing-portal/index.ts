// Supabase Edge Function: open the Stripe Customer Portal for the signed-in user so
// they can manage their subscription, payment method, and invoices.
// Origin-pinned CORS + sanitized errors.
//
// Deploy: supabase functions deploy billing-portal
// Secrets: STRIPE_SECRET_KEY, SITE_URL.
import Stripe from 'npm:stripe@^16';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { preflight, jsonResponse, errorResponse } from '../_shared/http.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const SITE = Deno.env.get('SITE_URL') ?? 'http://localhost:5173';

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405, origin);

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401, origin);

  // Resolve the Stripe customer from the caller's own subscription row (RLS-scoped).
  const { data: sub } = await supabase.from('subscriptions').select('customer_id').maybeSingle();
  if (!sub?.customer_id) return jsonResponse({ error: 'no_subscription' }, 400, origin);

  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.customer_id,
      return_url: `${SITE}/`,
    });
    return jsonResponse({ url: portal.url }, 200, origin);
  } catch (err) {
    return errorResponse(502, 'Could not open the billing portal. Please try again.', err, origin);
  }
});
