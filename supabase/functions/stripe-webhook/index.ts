// Supabase Edge Function: Stripe webhook → update the user's subscription.
// Deploy WITHOUT JWT verification (Stripe can't send one; the signature is the auth):
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO,
//          STRIPE_PRICE_STUDIO, SUPABASE_SERVICE_ROLE_KEY (SUPABASE_URL auto).
// Point a Stripe webhook at this function's URL; subscribe to
// checkout.session.completed + customer.subscription.*.
import Stripe from 'npm:stripe@^16';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { entitlementFromEvent } from '../_shared/entitlement.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const priceToPlan: Record<string, string> = {};
const proPrice = Deno.env.get('STRIPE_PRICE_PRO');
const studioPrice = Deno.env.get('STRIPE_PRICE_STUDIO');
if (proPrice) priceToPlan[proPrice] = 'pro';
if (studioPrice) priceToPlan[studioPrice] = 'studio';

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  if (!sig) return new Response('missing signature', { status: 400 });
  const body = await req.text();

  let event;
  try {
    // Async variant: Edge runtime has WebCrypto, not Node's sync crypto.
    event = await stripe.webhooks.constructEventAsync(body, sig, Deno.env.get('STRIPE_WEBHOOK_SECRET')!);
  } catch (err) {
    return new Response(`signature verification failed: ${(err as Error).message}`, { status: 400 });
  }

  const ent = entitlementFromEvent(event, priceToPlan);
  if (ent?.tenantId) {
    const { error } = await admin.from('subscriptions').upsert({
      user_id: ent.tenantId,
      plan: ent.plan,
      status: ent.status,
      current_period_end: ent.currentPeriodEnd,
      customer_id: ent.customerId,
      subscription_id: ent.subscriptionId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) return new Response(`db error: ${error.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
});
