/**
 * The scoring core.
 *
 * Every match carries the reason it happened. `scoreMatch` returns not just a number
 * but a per-signal breakdown with human-readable reasons — that object is what the
 * "Why matched?" panel renders, so the UI can never drift from the actual maths.
 */
import { MatchingConfig, DEFAULT_MATCHING_CONFIG, classify, MatchClassification } from './config';
import { merchantSimilarity } from './similarity';
import { toMinorUnits } from './normalize';

export interface ReceiptSide {
  id: string;
  merchantNorm: string | null;
  date: Date | null;
  total: number | null;
  currency: string | null;
  paymentMethod: string | null;
}

export interface TransactionSide {
  id: string;
  merchantNorm: string | null;
  descriptionNorm: string;
  date: Date;
  /** Signed as stored; comparison uses the absolute value. */
  amount: number;
  currency: string;
  paymentMethod: string | null;
}

export type SignalName = 'amount' | 'date' | 'merchant' | 'currency' | 'paymentMethod';

export interface Signal {
  name: SignalName;
  /** 0-1 before weighting. */
  score: number;
  weight: number;
  /** 0-1; how much this signal should count. Missing data lowers it. */
  applicability: number;
  reason: string;
  positive: boolean;
}

export interface MatchBreakdown {
  score: number;
  classification: MatchClassification;
  signals: Signal[];
  /** Set when a hard rule vetoed the pair regardless of the weighted score. */
  veto?: string;
}

const DAY_MS = 86_400_000;

export function daysBetween(a: Date, b: Date): number {
  const ua = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const ub = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((ub - ua) / DAY_MS);
}

function scoreAmount(r: ReceiptSide, t: TransactionSide, cfg: MatchingConfig): Omit<Signal, 'weight'> {
  if (r.total == null) {
    return { name: 'amount', score: 0, applicability: 0, reason: 'Receipt total missing', positive: false };
  }
  const receiptMinor = toMinorUnits(Math.abs(r.total));
  const txnMinor = toMinorUnits(Math.abs(t.amount));
  const deltaMinor = Math.abs(receiptMinor - txnMinor);
  const delta = deltaMinor / 100;

  if (deltaMinor <= toMinorUnits(cfg.amount.exactToleranceAbs)) {
    return { name: 'amount', score: 1, applicability: 1, reason: 'Exact amount', positive: true };
  }

  const base = Math.max(receiptMinor, txnMinor) || 1;
  const relative = deltaMinor / base;
  if (relative > cfg.amount.maxRelativeDelta) {
    return {
      name: 'amount',
      score: 0,
      applicability: 1,
      reason: `Amounts differ by ${delta.toFixed(2)}`,
      positive: false,
    };
  }
  // Linear decay across the tolerated band.
  const score = 1 - relative / cfg.amount.maxRelativeDelta;
  return {
    name: 'amount',
    score,
    applicability: 1,
    reason: `Amounts differ by ${delta.toFixed(2)}`,
    positive: score >= 0.5,
  };
}

function scoreDate(r: ReceiptSide, t: TransactionSide, cfg: MatchingConfig): Omit<Signal, 'weight'> {
  if (!r.date) {
    return { name: 'date', score: 0, applicability: 0, reason: 'Receipt date missing', positive: false };
  }
  // Positive = transaction posted after the receipt, which is the normal direction.
  const diff = daysBetween(r.date, t.date);
  const abs = Math.abs(diff);

  if (abs <= cfg.date.exactToleranceDays) {
    return { name: 'date', score: 1, applicability: 1, reason: 'Same date', positive: true };
  }

  const limit = diff >= 0 ? cfg.date.maxDaysAfter : cfg.date.maxDaysBefore;
  if (abs > limit) {
    return {
      name: 'date',
      score: 0,
      applicability: 1,
      reason: `${abs} days ${diff > 0 ? 'after' : 'before'} receipt, outside tolerance`,
      positive: false,
    };
  }

  const score = 1 - abs / (limit + 1);
  const direction = diff > 0 ? 'after' : 'before';
  return {
    name: 'date',
    score,
    applicability: 1,
    reason: `Transaction ${abs} day${abs === 1 ? '' : 's'} ${direction} receipt`,
    positive: true,
  };
}

function scoreMerchant(
  r: ReceiptSide,
  t: TransactionSide,
  cfg: MatchingConfig,
  semanticOverride?: number,
): Omit<Signal, 'weight'> {
  const rm = r.merchantNorm;
  const tm = t.merchantNorm || t.descriptionNorm;
  if (!rm || !tm) {
    return { name: 'merchant', score: 0, applicability: 0, reason: 'Merchant unavailable', positive: false };
  }

  const deterministic = merchantSimilarity(rm, tm);
  const sim = semanticOverride != null ? Math.max(deterministic, semanticOverride) : deterministic;

  if (sim < cfg.merchant.floor) {
    return {
      name: 'merchant',
      score: 0,
      applicability: 1,
      reason: `Merchant similarity ${Math.round(sim * 100)}%, too low`,
      positive: false,
    };
  }

  // Rescale the usable band [floor, 1] onto [0, 1] so the floor isn't rewarded.
  const score = (sim - cfg.merchant.floor) / (1 - cfg.merchant.floor);
  const label = semanticOverride != null && semanticOverride > deterministic ? ' (semantic)' : '';
  return {
    name: 'merchant',
    score,
    applicability: 1,
    reason: `Merchant similarity ${Math.round(sim * 100)}%${label}`,
    positive: sim >= 0.7,
  };
}

function scoreCurrency(r: ReceiptSide, t: TransactionSide): Omit<Signal, 'weight'> {
  if (!r.currency) {
    return { name: 'currency', score: 0, applicability: 0, reason: 'Receipt currency missing', positive: false };
  }
  const same = r.currency.toUpperCase() === t.currency.toUpperCase();
  return {
    name: 'currency',
    score: same ? 1 : 0,
    applicability: 1,
    reason: same ? `Same currency (${t.currency.toUpperCase()})` : `Currency mismatch: ${r.currency.toUpperCase()} vs ${t.currency.toUpperCase()}`,
    positive: same,
  };
}

function scorePaymentMethod(r: ReceiptSide, t: TransactionSide): Omit<Signal, 'weight'> {
  if (!r.paymentMethod || !t.paymentMethod) {
    return { name: 'paymentMethod', score: 0, applicability: 0, reason: 'Payment method unknown', positive: false };
  }
  const same = r.paymentMethod === t.paymentMethod;
  return {
    name: 'paymentMethod',
    score: same ? 1 : 0,
    applicability: 1,
    reason: same ? `Both paid by ${t.paymentMethod}` : `Payment method differs: ${r.paymentMethod} vs ${t.paymentMethod}`,
    positive: same,
  };
}

/**
 * Score one receipt/transaction pair.
 *
 * Weights are renormalized over the signals that actually apply, so a receipt with no
 * detected payment method isn't penalised for it — it just leans more on the rest.
 */
export function scoreMatch(
  receipt: ReceiptSide,
  transaction: TransactionSide,
  cfg: MatchingConfig = DEFAULT_MATCHING_CONFIG,
  semanticMerchantSimilarity?: number,
): MatchBreakdown {
  const raw = [
    scoreAmount(receipt, transaction, cfg),
    scoreDate(receipt, transaction, cfg),
    scoreMerchant(receipt, transaction, cfg, semanticMerchantSimilarity),
    scoreCurrency(receipt, transaction),
    scorePaymentMethod(receipt, transaction),
  ];

  const signals: Signal[] = raw.map((s) => ({ ...s, weight: cfg.weights[s.name] }));

  const effectiveTotal = signals.reduce((sum, s) => sum + s.weight * s.applicability, 0);
  const weighted = signals.reduce((sum, s) => sum + s.score * s.weight * s.applicability, 0);
  let score = effectiveTotal > 0 ? (weighted / effectiveTotal) * 100 : 0;

  // Hard vetoes: signals that should override a flattering weighted average.
  let veto: string | undefined;
  const amount = signals.find((s) => s.name === 'amount')!;
  const currency = signals.find((s) => s.name === 'currency')!;
  const date = signals.find((s) => s.name === 'date')!;

  if (amount.applicability === 1 && amount.score === 0) {
    veto = 'Amounts are too far apart';
  } else if (currency.applicability === 1 && currency.score === 0) {
    // Different currencies can still be the same purchase (FX), but never automatically.
    veto = 'Currency mismatch: needs a human';
    score = Math.min(score, cfg.thresholds.auto - 1);
  } else if (date.applicability === 1 && date.score === 0) {
    veto = 'Dates are outside the tolerance window';
  }

  if (veto && (amount.score === 0 || date.score === 0)) {
    score = Math.min(score, cfg.thresholds.possible - 1);
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score: Math.round(score * 10) / 10,
    classification: classify(score, cfg),
    signals,
    veto,
  };
}

/** Compact form persisted on the match row and rendered in the review UI. */
export function serializeBreakdown(b: MatchBreakdown): string {
  return JSON.stringify({
    score: b.score,
    classification: b.classification,
    veto: b.veto ?? null,
    signals: b.signals.map((s) => ({
      name: s.name,
      score: Math.round(s.score * 100),
      weight: s.weight,
      applicable: s.applicability > 0,
      reason: s.reason,
      positive: s.positive,
    })),
  });
}

export interface StoredBreakdown {
  score: number;
  classification: MatchClassification;
  veto: string | null;
  signals: Array<{
    name: SignalName;
    score: number;
    weight: number;
    applicable: boolean;
    reason: string;
    positive: boolean;
  }>;
}

export function parseBreakdown(raw: string): StoredBreakdown | null {
  try {
    return JSON.parse(raw) as StoredBreakdown;
  } catch {
    return null;
  }
}
