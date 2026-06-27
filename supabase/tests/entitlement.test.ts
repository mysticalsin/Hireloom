// Deno tests for the edge-side entitlement mapper. Pins the Stripe-event → plan
// contract (the "entitlement twin" of engine/billing/entitlement.mjs). Pure logic,
// no Supabase needed. Run: deno test supabase/tests/
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { entitlementFromEvent } from '../functions/_shared/entitlement.ts';

const priceToPlan: Record<string, string> = { price_pro: 'pro', price_studio: 'studio' };
// deno-lint-ignore no-explicit-any
const ev = (type: string, object: unknown): any => ({ type, data: { object } });

Deno.test('subscription.created active → mapped plan', () => {
  const ent = entitlementFromEvent(
    ev('customer.subscription.created', {
      status: 'active',
      items: { data: [{ price: { id: 'price_pro' } }] },
      metadata: { tenantId: 'u1' },
      current_period_end: 123,
      customer: 'cus_1',
      id: 'sub_1',
    }),
    priceToPlan,
  );
  assertEquals(ent?.plan, 'pro');
  assertEquals(ent?.tenantId, 'u1');
  assertEquals(ent?.status, 'active');
  assertEquals(ent?.currentPeriodEnd, 123);
});

Deno.test('inactive subscription → free (no access)', () => {
  const ent = entitlementFromEvent(
    ev('customer.subscription.updated', {
      status: 'past_due',
      items: { data: [{ price: { id: 'price_pro' } }] },
      metadata: { tenantId: 'u1' },
    }),
    priceToPlan,
  );
  assertEquals(ent?.plan, 'free');
});

Deno.test('subscription.deleted → free / canceled', () => {
  const ent = entitlementFromEvent(
    ev('customer.subscription.deleted', { status: 'canceled', metadata: { tenantId: 'u1' }, id: 'sub_1', customer: 'cus_1' }),
    priceToPlan,
  );
  assertEquals(ent?.plan, 'free');
  assertEquals(ent?.status, 'canceled');
});

Deno.test('checkout.session.completed → plan from priceId metadata', () => {
  const ent = entitlementFromEvent(
    ev('checkout.session.completed', { metadata: { tenantId: 'u1', priceId: 'price_studio' }, customer: 'cus_1', subscription: 'sub_1' }),
    priceToPlan,
  );
  assertEquals(ent?.plan, 'studio');
  assertEquals(ent?.status, 'active');
  assertEquals(ent?.tenantId, 'u1');
});

Deno.test('unknown event type → null (no-op)', () => {
  assertEquals(entitlementFromEvent(ev('invoice.paid', {}), priceToPlan), null);
});

Deno.test('unmapped price → free (never silently grants paid)', () => {
  const ent = entitlementFromEvent(
    ev('customer.subscription.created', {
      status: 'active',
      items: { data: [{ price: { id: 'price_unknown' } }] },
      metadata: { tenantId: 'u1' },
    }),
    priceToPlan,
  );
  assertEquals(ent?.plan, 'free');
});
