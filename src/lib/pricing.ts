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
