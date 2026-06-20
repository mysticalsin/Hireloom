import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, planFor, hasFeature, withinLimit, checkFeature, requireFeature } from '../engine/billing/plans.mjs';
import { entitlementFromEvent, applyWebhookEvent } from '../engine/billing/entitlement.mjs';
import { priceToPlanFromEnv } from '../engine/billing/stripe.mjs';
import { makeInMemoryStore } from '../engine/store/store.mjs';

const PRICE_TO_PLAN = { price_pro: 'pro', price_studio: 'studio' };

test('plan catalog: prices and feature membership', () => {
  assert.equal(PLANS.pro.priceUsd, 29);
  assert.equal(PLANS.studio.priceUsd, 79);
  assert.equal(planFor('nonsense').id, 'free');         // unknown -> free
  assert.ok(hasFeature('pro', 'assisted_apply'));
  assert.ok(!hasFeature('free', 'assisted_apply'));
  assert.ok(hasFeature('studio', 'autopilot'));
  assert.ok(!hasFeature('pro', 'autopilot'));
});

test('limits: free is capped, pro/studio unlimited', () => {
  assert.ok(withinLimit('free', 'evaluationsPerMonth', 9));
  assert.ok(!withinLimit('free', 'evaluationsPerMonth', 10));   // cap is 10
  assert.ok(withinLimit('pro', 'evaluationsPerMonth', 10_000)); // unlimited
});

test('entitlementFromEvent maps subscription.updated to a plan', () => {
  const ev = {
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', status: 'active', customer: 'cus_1', current_period_end: 1700000000, metadata: { tenantId: 't1' }, items: { data: [{ price: { id: 'price_pro' } }] } } },
  };
  const ent = entitlementFromEvent(ev, { priceToPlan: PRICE_TO_PLAN });
  assert.deepEqual(ent, { tenantId: 't1', plan: 'pro', status: 'active', currentPeriodEnd: 1700000000, customerId: 'cus_1', subscriptionId: 'sub_1' });
});

test('entitlementFromEvent downgrades on past_due / canceled / deleted', () => {
  const pastDue = entitlementFromEvent({ type: 'customer.subscription.updated', data: { object: { id: 's', status: 'past_due', metadata: { tenantId: 't1' }, items: { data: [{ price: { id: 'price_pro' } }] } } } }, { priceToPlan: PRICE_TO_PLAN });
  assert.equal(pastDue.plan, 'free');                  // inactive status -> no entitlement
  const deleted = entitlementFromEvent({ type: 'customer.subscription.deleted', data: { object: { id: 's', status: 'canceled', metadata: { tenantId: 't1' } } } }, { priceToPlan: PRICE_TO_PLAN });
  assert.equal(deleted.plan, 'free');
  assert.equal(deleted.status, 'canceled');
});

test('entitlementFromEvent maps checkout.session.completed via metadata', () => {
  const ent = entitlementFromEvent({ type: 'checkout.session.completed', data: { object: { customer: 'cus_9', subscription: 'sub_9', client_reference_id: 't9', metadata: { tenantId: 't9', priceId: 'price_studio' } } } }, { priceToPlan: PRICE_TO_PLAN });
  assert.equal(ent.tenantId, 't9');
  assert.equal(ent.plan, 'studio');
});

test('entitlementFromEvent ignores unrelated events', () => {
  assert.equal(entitlementFromEvent({ type: 'invoice.paid', data: { object: {} } }, { priceToPlan: PRICE_TO_PLAN }), null);
});

test('applyWebhookEvent writes the entitlement to the store and gates features', () => {
  const store = makeInMemoryStore();
  const t = store.createTenant({ name: 'Acme' });
  // before paying: free plan, premium feature gated
  assert.equal(store.tenantPlan(t.id), 'free');
  assert.equal(checkFeature(store, t.id, 'assisted_apply').ok, false);
  assert.throws(() => requireFeature(store, t.id, 'assisted_apply'), /requires the pro plan/);

  // Pro subscription event arrives
  const ev = { type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active', customer: 'cus_1', metadata: { tenantId: t.id }, items: { data: [{ price: { id: 'price_pro' } }] } } } };
  const applied = applyWebhookEvent(store, ev, { priceToPlan: PRICE_TO_PLAN });
  assert.equal(applied.plan, 'pro');
  assert.equal(store.tenantPlan(t.id), 'pro');
  assert.ok(checkFeature(store, t.id, 'assisted_apply').ok);
  // studio-only still gated on pro
  assert.equal(checkFeature(store, t.id, 'autopilot').upgradeTo, 'studio');
});

test('applyWebhookEvent no-ops without a tenant', () => {
  const store = makeInMemoryStore();
  assert.equal(applyWebhookEvent(store, { type: 'invoice.paid', data: { object: {} } }, {}), null);
});

test('priceToPlanFromEnv builds the map from env vars', () => {
  assert.deepEqual(priceToPlanFromEnv({ STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_STUDIO: 'price_studio' }), { price_pro: 'pro', price_studio: 'studio' });
  assert.deepEqual(priceToPlanFromEnv({}), {});
});
