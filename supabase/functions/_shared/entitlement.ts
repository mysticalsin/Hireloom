// Pure Stripe-event → entitlement mapping for Edge Functions (Deno/TS port of
// engine/billing/entitlement.mjs, which is unit-tested). Keep the two in sync.

export interface Entitlement {
  tenantId: string | null;
  plan: string;
  status: string;
  currentPeriodEnd: number | null;
  customerId: string | null;
  subscriptionId: string | null;
}

const ACTIVE = new Set(['active', 'trialing']);

// deno-lint-ignore no-explicit-any
export function entitlementFromEvent(event: any, priceToPlan: Record<string, string>): Entitlement | null {
  const type: string = event?.type;
  const obj = event?.data?.object ?? {};

  if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
    const priceId = obj.items?.data?.[0]?.price?.id;
    const mapped = priceToPlan[priceId] || 'free';
    return {
      tenantId: obj.metadata?.tenantId ?? null,
      plan: ACTIVE.has(obj.status) ? mapped : 'free',
      status: obj.status ?? 'unknown',
      currentPeriodEnd: obj.current_period_end ?? null,
      customerId: obj.customer ?? null,
      subscriptionId: obj.id ?? null,
    };
  }
  if (type === 'customer.subscription.deleted') {
    return {
      tenantId: obj.metadata?.tenantId ?? null,
      plan: 'free',
      status: 'canceled',
      currentPeriodEnd: obj.current_period_end ?? null,
      customerId: obj.customer ?? null,
      subscriptionId: obj.id ?? null,
    };
  }
  if (type === 'checkout.session.completed') {
    return {
      tenantId: obj.metadata?.tenantId ?? obj.client_reference_id ?? null,
      plan: priceToPlan[obj.metadata?.priceId] ?? obj.metadata?.plan ?? 'free',
      status: 'active',
      currentPeriodEnd: null,
      customerId: obj.customer ?? null,
      subscriptionId: obj.subscription ?? null,
    };
  }
  return null;
}
