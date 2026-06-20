// Stripe webhook → entitlement. The pure mapping from a verified Stripe event to
// a tenant's subscription/plan state. Kept SDK-free and side-effect-free so it's
// fully testable with canned event objects; the live SDK (verify + checkout) lives
// in stripe.mjs, and applyWebhookEvent() does the one store write.

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

/**
 * Map a Stripe event to an entitlement change. Pure.
 * @param {object} event  a verified Stripe event
 * @param {object} opts
 * @param {Record<string,string>} opts.priceToPlan  Stripe price id -> plan id
 * @returns {null | {tenantId, plan, status, currentPeriodEnd, customerId, subscriptionId}}
 *          null for events we don't act on.
 */
export function entitlementFromEvent(event, { priceToPlan = {} } = {}) {
  const type = event?.type;
  const obj = event?.data?.object || {};

  if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
    const priceId = obj.items?.data?.[0]?.price?.id;
    const mapped = priceToPlan[priceId] || 'free';
    const active = ACTIVE_STATUSES.has(obj.status);
    return {
      tenantId: obj.metadata?.tenantId || null,
      plan: active ? mapped : 'free',
      status: obj.status || 'unknown',
      currentPeriodEnd: obj.current_period_end ?? null,
      customerId: obj.customer ?? null,
      subscriptionId: obj.id ?? null,
    };
  }

  if (type === 'customer.subscription.deleted') {
    return {
      tenantId: obj.metadata?.tenantId || null,
      plan: 'free',
      status: 'canceled',
      currentPeriodEnd: obj.current_period_end ?? null,
      customerId: obj.customer ?? null,
      subscriptionId: obj.id ?? null,
    };
  }

  if (type === 'checkout.session.completed') {
    const plan = priceToPlan[obj.metadata?.priceId] || obj.metadata?.plan || null;
    return {
      tenantId: obj.metadata?.tenantId || obj.client_reference_id || null,
      plan: plan || 'free',
      status: 'active',
      currentPeriodEnd: null,
      customerId: obj.customer ?? null,
      subscriptionId: obj.subscription ?? null,
    };
  }

  return null; // event we don't act on
}

/**
 * Apply a verified Stripe event to the store. Returns the applied entitlement,
 * or null if the event isn't actionable / has no tenant.
 */
export function applyWebhookEvent(store, event, { priceToPlan = {} } = {}) {
  const ent = entitlementFromEvent(event, { priceToPlan });
  if (!ent || !ent.tenantId) return null;
  return store.setSubscription(ent.tenantId, ent);
}
