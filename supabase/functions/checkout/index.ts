// Supabase Edge Function: create a Stripe Checkout session for the signed-in user.
// The SPA calls it via supabase.functions.invoke('checkout', { body: { plan } }).
// Deploy: supabase functions deploy checkout
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_STUDIO, SITE_URL
//          (SUPABASE_URL + SUPABASE_ANON_KEY are injected automatically).
import Stripe from 'npm:stripe@^16';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const PRICE: Record<string, string | undefined> = {
  pro: Deno.env.get('STRIPE_PRICE_PRO'),
  studio: Deno.env.get('STRIPE_PRICE_STUDIO'),
};
const SITE = Deno.env.get('SITE_URL') ?? 'http://localhost:5173';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Identify the caller from their JWT (RLS-scoped client).
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { plan } = await req.json().catch(() => ({}));
  const price = PRICE[plan as string];
  if (!price) return json({ error: 'unknown or unconfigured plan' }, 400);

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
  return json({ url: session.url });
});
