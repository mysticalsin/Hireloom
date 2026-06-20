// Live Stripe calls — the only side-effecting part of billing. The entitlement
// LOGIC is pure and lives in entitlement.mjs (tested offline); this file just
// talks to Stripe. The `stripe` SDK is imported lazily so the rest of billing
// loads without the dependency.
//
// Go-live needs:
//   npm i stripe
//   env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO, STRIPE_PRICE_STUDIO
//   Stripe dashboard: create recurring prices for Pro ($29/mo) and Studio ($79/mo).

let _client;
async function client() {
  if (!_client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not set');
    const Stripe = (await import('stripe')).default;
    _client = new Stripe(key);
  }
  return _client;
}

/** Map env-configured Stripe price ids -> plan ids (for the entitlement reducer). */
export function priceToPlanFromEnv(env = process.env) {
  const map = {};
  if (env.STRIPE_PRICE_PRO) map[env.STRIPE_PRICE_PRO] = 'pro';
  if (env.STRIPE_PRICE_STUDIO) map[env.STRIPE_PRICE_STUDIO] = 'studio';
  return map;
}

/**
 * Create a subscription Checkout Session for a tenant.
 * tenantId is stamped on the session + the subscription metadata so the webhook
 * can attribute the entitlement back to the right tenant.
 */
export async function createCheckoutSession({ tenantId, priceId, successUrl, cancelUrl, customerEmail } = {}) {
  if (!tenantId || !priceId) throw new Error('createCheckoutSession: tenantId and priceId required');
  const stripe = await client();
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: tenantId,
    customer_email: customerEmail,
    metadata: { tenantId, priceId },
    subscription_data: { metadata: { tenantId } },
  });
}

/** Open the Stripe billing portal so a customer can manage/cancel their plan. */
export async function createBillingPortalSession({ customerId, returnUrl } = {}) {
  if (!customerId) throw new Error('createBillingPortalSession: customerId required');
  const stripe = await client();
  return stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
}

/** Verify a webhook payload and return the parsed event. Throws on bad signature. */
export async function constructEvent(rawBody, signature, secret = process.env.STRIPE_WEBHOOK_SECRET) {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not set');
  const stripe = await client();
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}
