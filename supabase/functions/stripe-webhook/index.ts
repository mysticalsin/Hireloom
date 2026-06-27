// Supabase Edge Function: Stripe webhook → update the user's subscription.
// Hardened (docs/AUDIT-REPORT.md P0): event idempotency (stripe_events dedup),
// ordering guard (skip stale events), payment_status gate, never null a good
// current_period_end, no error detail to the client.
//
// Deploy WITHOUT JWT verification (Stripe can't send one; the signature is the auth):
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO,
//          STRIPE_PRICE_STUDIO, SUPABASE_SERVICE_ROLE_KEY (SUPABASE_URL auto).
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

const ok = (extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ received: true, ...extra }), { headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  if (!sig) return new Response('bad request', { status: 400 });
  const body = await req.text();

  let event;
  try {
    // Async variant: Edge runtime has WebCrypto, not Node's sync crypto.
    event = await stripe.webhooks.constructEventAsync(body, sig, Deno.env.get('STRIPE_WEBHOOK_SECRET')!);
  } catch (err) {
    console.error('stripe signature verification failed:', (err as Error).message);
    return new Response('bad request', { status: 400 }); // no detail to client
  }

  // Idempotency: skip if this event id was already FULLY processed. The event is
  // recorded only AFTER a successful upsert (below), so a failed upsert is retried by
  // Stripe instead of being silently swallowed by the dedup row.
  const { data: seen } = await admin.from('stripe_events').select('id').eq('id', event.id).maybeSingle();
  if (seen) return ok({ duplicate: true });

  // checkout.session.completed only grants access when actually paid.
  if (event.type === 'checkout.session.completed') {
    // deno-lint-ignore no-explicit-any
    const obj: any = event.data?.object ?? {};
    if (obj.payment_status && obj.payment_status !== 'paid') return ok({ ignored: 'unpaid' });
  }

  const ent = entitlementFromEvent(event, priceToPlan);
  if (ent?.tenantId) {
    const { data: existing } = await admin.from('subscriptions')
      .select('current_period_end,last_event_created').eq('user_id', ent.tenantId).maybeSingle();

    // Ordering guard: ignore any event older than the last one we applied.
    if (existing?.last_event_created && event.created < existing.last_event_created) return ok({ stale: true });

    const { error } = await admin.from('subscriptions').upsert({
      user_id: ent.tenantId,
      plan: ent.plan,
      status: ent.status,
      // Never overwrite a good period-end with null.
      current_period_end: ent.currentPeriodEnd ?? existing?.current_period_end ?? null,
      customer_id: ent.customerId,
      subscription_id: ent.subscriptionId,
      last_event_created: event.created,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) { console.error('subscription upsert failed:', error.message); return new Response('error', { status: 500 }); }
  }

  // Record the event only AFTER successful processing (a failed upsert above returned 500
  // WITHOUT recording, so Stripe retries it). The unique PK guards a concurrent double-deliver.
  // deno-lint-ignore no-explicit-any
  const { error: recErr } = await admin.from('stripe_events').insert({ id: event.id, type: event.type, created: event.created });
  if (recErr && (recErr as any).code !== '23505') console.error('stripe_events record failed:', recErr.message);
  return ok();
});
