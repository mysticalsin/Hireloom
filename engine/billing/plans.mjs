// Plan catalog + feature gating. Single source of truth for what each tier gets.
// Prices mirror docs/PRODUCT-GTM-STRATEGY.md (BYOK: subscription is for the
// platform, not inference). Stripe price IDs are mapped via env (see stripe.mjs).

const UNLIMITED = Number.POSITIVE_INFINITY;

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    priceUsd: 0,
    limits: { evaluationsPerMonth: 10, packagesPerMonth: 3 },
    features: ['pipeline', 'byok'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceUsd: 29,
    limits: { evaluationsPerMonth: UNLIMITED, packagesPerMonth: UNLIMITED },
    features: ['pipeline', 'byok', 'inbox', 'assisted_apply', 'followup'],
  },
  studio: {
    id: 'studio',
    name: 'Studio',
    priceUsd: 79,
    limits: { evaluationsPerMonth: UNLIMITED, packagesPerMonth: UNLIMITED },
    features: ['pipeline', 'byok', 'inbox', 'assisted_apply', 'followup', 'autopilot', 'second_brain', 'interview_prep', 'priority'],
  },
};

/** Resolve a plan id to its definition; unknown ids fall back to Free. Pure. */
export function planFor(planId) {
  return PLANS[planId] || PLANS.free;
}

/** Does this plan include a feature? Pure. */
export function hasFeature(planId, feature) {
  return planFor(planId).features.includes(feature);
}

/** Is `used` still within the plan's limit for `key`? Pure. (UNLIMITED → always true.) */
export function withinLimit(planId, key, used) {
  const cap = planFor(planId).limits[key];
  if (cap === undefined) return true;
  return used < cap;
}

/**
 * Feature gate against a store-backed tenant plan. Returns {ok} or {ok:false,...}.
 * Throwing variant: requireFeature(...) for handler use.
 */
export function checkFeature(store, tenantId, feature) {
  const plan = store.tenantPlan(tenantId);
  if (hasFeature(plan, feature)) return { ok: true, plan };
  return { ok: false, plan, feature, upgradeTo: feature === 'autopilot' || feature === 'second_brain' ? 'studio' : 'pro' };
}

export function requireFeature(store, tenantId, feature) {
  const r = checkFeature(store, tenantId, feature);
  if (!r.ok) {
    const err = new Error(`Feature "${feature}" requires the ${r.upgradeTo} plan (current: ${r.plan})`);
    err.code = 'plan_required';
    err.upgradeTo = r.upgradeTo;
    throw err;
  }
  return r;
}
