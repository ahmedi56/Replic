/**
 * Every tunable number in the matching engine lives here.
 * Nothing downstream hard-codes a weight or a threshold — they read this object,
 * and an org can override any of it via org_settings.matching_config.
 */

export interface MatchingConfig {
  weights: {
    amount: number;
    date: number;
    merchant: number;
    currency: number;
    paymentMethod: number;
  };
  thresholds: {
    /** >= this score: matched without asking the user. */
    auto: number;
    /** >= this score: surfaced in "Needs Review", highest confidence first. */
    review: number;
    /** >= this score: kept as a weak candidate. Below it, discarded. */
    possible: number;
  };
  amount: {
    /** Absolute difference treated as a rounding artefact, still a perfect score. */
    exactToleranceAbs: number;
    /** Relative difference beyond which amount scores zero. */
    maxRelativeDelta: number;
  };
  date: {
    /** Full score inside this many days. */
    exactToleranceDays: number;
    /** Score decays to zero at this many days. Banks post late, so this is asymmetric. */
    maxDaysAfter: number;
    maxDaysBefore: number;
  };
  merchant: {
    /** Below this similarity, the merchant signal contributes nothing. */
    floor: number;
    /** Deterministic similarity band where it's worth asking a semantic provider. */
    semanticLowerBound: number;
    semanticUpperBound: number;
  };
  duplicates: {
    /** Receipts within this many days + same amount + same merchant are flagged. */
    dateWindowDays: number;
    amountToleranceAbs: number;
    merchantSimilarity: number;
  };
  /** Cap on candidate transactions scored per receipt (keeps bulk runs bounded). */
  maxCandidatesPerReceipt: number;
}

export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  weights: {
    amount: 0.4,
    date: 0.2,
    merchant: 0.3,
    currency: 0.05,
    paymentMethod: 0.05,
  },
  thresholds: {
    auto: 90,
    review: 70,
    possible: 40,
  },
  amount: {
    exactToleranceAbs: 0.01,
    maxRelativeDelta: 0.05,
  },
  date: {
    exactToleranceDays: 0,
    maxDaysAfter: 5,
    maxDaysBefore: 2,
  },
  merchant: {
    floor: 0.35,
    semanticLowerBound: 0.3,
    semanticUpperBound: 0.8,
  },
  duplicates: {
    dateWindowDays: 3,
    amountToleranceAbs: 0.01,
    merchantSimilarity: 0.85,
  },
  maxCandidatesPerReceipt: 50,
};

/** Merge a stored partial override onto the defaults. Unknown keys are ignored. */
export function resolveConfig(raw?: string | null): MatchingConfig {
  if (!raw) return DEFAULT_MATCHING_CONFIG;
  try {
    const parsed = JSON.parse(raw) as Partial<MatchingConfig>;
    return {
      weights: { ...DEFAULT_MATCHING_CONFIG.weights, ...parsed.weights },
      thresholds: { ...DEFAULT_MATCHING_CONFIG.thresholds, ...parsed.thresholds },
      amount: { ...DEFAULT_MATCHING_CONFIG.amount, ...parsed.amount },
      date: { ...DEFAULT_MATCHING_CONFIG.date, ...parsed.date },
      merchant: { ...DEFAULT_MATCHING_CONFIG.merchant, ...parsed.merchant },
      duplicates: { ...DEFAULT_MATCHING_CONFIG.duplicates, ...parsed.duplicates },
      maxCandidatesPerReceipt: parsed.maxCandidatesPerReceipt ?? DEFAULT_MATCHING_CONFIG.maxCandidatesPerReceipt,
    };
  } catch {
    return DEFAULT_MATCHING_CONFIG;
  }
}

export type MatchClassification = 'auto' | 'review' | 'possible' | 'none';

export function classify(score: number, cfg: MatchingConfig): MatchClassification {
  if (score >= cfg.thresholds.auto) return 'auto';
  if (score >= cfg.thresholds.review) return 'review';
  if (score >= cfg.thresholds.possible) return 'possible';
  return 'none';
}
