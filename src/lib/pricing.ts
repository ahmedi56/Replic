/**
 * Pricing lives in one place so the landing page, the quota check and the settings screen
 * can never disagree. These figures are a starting point, not a commitment.
 */
export interface PricingPlan {
  id: 'free' | 'pro' | 'business';
  name: string;
  priceLabel: string;
  period?: string;
  receiptQuota: number;
  features: string[];
  cta: string;
  highlighted?: boolean;
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    priceLabel: '€0',
    receiptQuota: 50,
    features: ['Bulk upload and extraction', 'CSV bank import', 'Automatic matching', 'CSV export'],
    cta: 'Start for free',
  },
  {
    id: 'pro',
    name: 'Pro',
    priceLabel: '€9',
    period: 'month',
    receiptQuota: 500,
    features: ['Everything in Free', 'Duplicate detection across periods', 'Configurable matching weights', 'Full audit history'],
    cta: 'Start for free',
    highlighted: true,
  },
  {
    id: 'business',
    name: 'Business',
    priceLabel: '€29',
    period: 'month',
    receiptQuota: 2500,
    features: ['Everything in Pro', 'Multiple bank accounts', 'Priority extraction', 'Bulk review tools'],
    cta: 'Start for free',
  },
];

export function planFor(id: string): PricingPlan {
  return PRICING_PLANS.find((p) => p.id === id) ?? PRICING_PLANS[0];
}

export interface SubscriptionState {
  plan: string;
  receiptQuota: number;
  currentPeriodEnd: Date | null;
}

export interface EffectiveSubscription {
  plan: PricingPlan;
  receiptQuota: number;
  /** True when a paid plan's period has ended and the organization is on Free limits again. */
  expired: boolean;
  /** Whole days until a paid plan ends; negative once it has. Null for Free or an open-ended plan. */
  daysLeft: number | null;
}

/**
 * What a subscription entitles its owner to right now. A paid plan with an end date that has
 * passed falls back to the Free quota. Nothing is deleted and nobody is locked out: they keep
 * their data and can still upload up to the Free limit, which is what makes a late wire
 * transfer an annoyance and not a disaster.
 */
export function effectiveSubscription(sub: SubscriptionState, now: Date = new Date()): EffectiveSubscription {
  const plan = planFor(sub.plan);
  const end = sub.currentPeriodEnd;
  const daysLeft = end ? Math.ceil((end.getTime() - now.getTime()) / 86_400_000) : null;

  if (plan.id !== 'free' && end && end.getTime() < now.getTime()) {
    const free = planFor('free');
    return { plan: free, receiptQuota: free.receiptQuota, expired: true, daysLeft };
  }
  return { plan, receiptQuota: sub.receiptQuota, expired: false, daysLeft: plan.id === 'free' ? null : daysLeft };
}
