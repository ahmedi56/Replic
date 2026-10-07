/**
 * The matching run.
 *
 * Deliberately ordered so the cheap, deterministic work happens first and an AI provider
 * is only consulted for the small set of pairs where the maths is genuinely undecided:
 *
 *   1. narrow  — index transactions by amount so each receipt scores tens, not thousands
 *   2. score   — deterministic multi-factor scoring (score.ts)
 *   3. escalate— only merchant pairs inside the ambiguous band go to the semantic provider
 *   4. assign  — resolve contention so one transaction isn't auto-matched to two receipts
 *
 * Pure: no database, no I/O beyond the injected semantic provider. That's what makes it
 * testable and what keeps a bulk run predictable.
 */
import { MatchingConfig, DEFAULT_MATCHING_CONFIG } from './config';
import { scoreMatch, ReceiptSide, TransactionSide, MatchBreakdown, daysBetween } from './score';
import { merchantSimilarity } from './similarity';
import { toMinorUnits } from './normalize';
import type { SemanticProvider } from '../ai/types';

export interface MatchProposal {
  receiptId: string;
  transactionId: string;
  breakdown: MatchBreakdown;
  method: 'deterministic' | 'semantic';
  /** True for the pair that won assignment for this receipt. */
  isBest: boolean;
}

export interface MatchRunResult {
  proposals: MatchProposal[];
  unmatchedReceiptIds: string[];
  unmatchedTransactionIds: string[];
  stats: {
    receiptsConsidered: number;
    transactionsConsidered: number;
    pairsScored: number;
    semanticCalls: number;
    auto: number;
    review: number;
    possible: number;
  };
}

/**
 * Bucket transactions by rounded absolute amount so candidate lookup is O(1) per receipt
 * instead of a full scan. The bucket width is the amount tolerance, and neighbours are
 * probed too, so near-misses inside the tolerance are not lost at a bucket boundary.
 */
function buildAmountIndex(transactions: TransactionSide[], cfg: MatchingConfig) {
  const index = new Map<number, TransactionSide[]>();
  for (const t of transactions) {
    const key = Math.round(Math.abs(t.amount));
    const bucket = index.get(key);
    if (bucket) bucket.push(t);
    else index.set(key, [t]);
  }
  return {
    candidatesFor(receiptTotal: number): TransactionSide[] {
      const center = Math.round(Math.abs(receiptTotal));
      // Widen by the relative tolerance, minimum ±1 to cover rounding across a bucket edge.
      const span = Math.max(1, Math.ceil(Math.abs(receiptTotal) * cfg.amount.maxRelativeDelta) + 1);
      const out: TransactionSide[] = [];
      for (let k = center - span; k <= center + span; k++) {
        const bucket = index.get(k);
        if (bucket) out.push(...bucket);
      }
      return out;
    },
  };
}

function withinDateWindow(r: ReceiptSide, t: TransactionSide, cfg: MatchingConfig): boolean {
  if (!r.date) return true; // can't narrow on a missing date; scoring will penalise it
  const diff = daysBetween(r.date, t.date);
  return diff >= -cfg.date.maxDaysBefore && diff <= cfg.date.maxDaysAfter;
}

function amountPlausible(r: ReceiptSide, t: TransactionSide, cfg: MatchingConfig): boolean {
  if (r.total == null) return true;
  const rm = toMinorUnits(Math.abs(r.total));
  const tm = toMinorUnits(Math.abs(t.amount));
  const delta = Math.abs(rm - tm);
  if (delta <= toMinorUnits(cfg.amount.exactToleranceAbs)) return true;
  return delta / Math.max(rm, tm, 1) <= cfg.amount.maxRelativeDelta;
}

export async function runMatching(params: {
  receipts: ReceiptSide[];
  transactions: TransactionSide[];
  config?: MatchingConfig;
  semantic?: SemanticProvider | null;
}): Promise<MatchRunResult> {
  const cfg = params.config ?? DEFAULT_MATCHING_CONFIG;
  const { receipts, transactions } = params;
  const index = buildAmountIndex(transactions, cfg);

  let pairsScored = 0;
  let semanticCalls = 0;

  // Step 1-3: score candidates per receipt.
  const scoredByReceipt = new Map<string, MatchProposal[]>();

  for (const receipt of receipts) {
    const pool = receipt.total != null ? index.candidatesFor(receipt.total) : transactions;
    const candidates = pool
      .filter((t) => amountPlausible(receipt, t, cfg) && withinDateWindow(receipt, t, cfg))
      .slice(0, cfg.maxCandidatesPerReceipt);

    const scored: MatchProposal[] = [];
    const ambiguous: Array<{ t: TransactionSide; breakdown: MatchBreakdown }> = [];

    for (const t of candidates) {
      const breakdown = scoreMatch(receipt, t, cfg);
      pairsScored++;

      // Escalate only when merchant similarity sits in the undecided band and the rest
      // of the signals are strong enough that resolving the merchant would change the call.
      const rm = receipt.merchantNorm;
      const tm = t.merchantNorm || t.descriptionNorm;
      if (params.semantic?.isAvailable() && rm && tm) {
        const sim = merchantSimilarity(rm, tm);
        const amountSignal = breakdown.signals.find((s) => s.name === 'amount')!;
        if (
          sim >= cfg.merchant.semanticLowerBound &&
          sim < cfg.merchant.semanticUpperBound &&
          amountSignal.score > 0.9 &&
          !breakdown.veto
        ) {
          ambiguous.push({ t, breakdown });
          continue;
        }
      }

      if (breakdown.classification !== 'none') {
        scored.push({ receiptId: receipt.id, transactionId: t.id, breakdown, method: 'deterministic', isBest: false });
      }
    }

    // Step 3: one batched semantic call per receipt, never one per pair.
    if (ambiguous.length && params.semantic) {
      semanticCalls++;
      let similarities: Record<string, number> = {};
      try {
        similarities = await params.semantic.compareMerchant(
          receipt.merchantNorm ?? '',
          ambiguous.map((a) => ({ id: a.t.id, text: a.t.merchantNorm || a.t.descriptionNorm })),
        );
      } catch {
        similarities = {}; // provider failure falls back to deterministic scores
      }
      for (const { t, breakdown } of ambiguous) {
        const semanticSim = similarities[t.id];
        const finalBreakdown = semanticSim != null ? scoreMatch(receipt, t, cfg, semanticSim) : breakdown;
        if (finalBreakdown.classification !== 'none') {
          scored.push({
            receiptId: receipt.id,
            transactionId: t.id,
            breakdown: finalBreakdown,
            method: semanticSim != null ? 'semantic' : 'deterministic',
            isBest: false,
          });
        }
      }
    }

    scored.sort((a, b) => b.breakdown.score - a.breakdown.score);
    if (scored.length) scoredByReceipt.set(receipt.id, scored);
  }

  // Step 4: assignment. Greedy over all pairs by score — a transaction can only be the
  // *best* candidate for one receipt, so two receipts of the same amount on the same day
  // don't both auto-match to the same bank line.
  const allPairs = [...scoredByReceipt.values()].flat().sort((a, b) => b.breakdown.score - a.breakdown.score);
  const claimedTransactions = new Set<string>();
  const claimedReceipts = new Set<string>();

  for (const pair of allPairs) {
    if (claimedReceipts.has(pair.receiptId) || claimedTransactions.has(pair.transactionId)) continue;
    pair.isBest = true;
    claimedReceipts.add(pair.receiptId);
    claimedTransactions.add(pair.transactionId);
  }

  // A losing pair is still worth keeping as an alternative for the review screen, but it
  // must never be auto-confirmed.
  const proposals = allPairs.filter((p) => p.isBest || p.breakdown.classification !== 'none');

  const best = proposals.filter((p) => p.isBest);
  const stats = {
    receiptsConsidered: receipts.length,
    transactionsConsidered: transactions.length,
    pairsScored,
    semanticCalls,
    auto: best.filter((p) => p.breakdown.classification === 'auto').length,
    review: best.filter((p) => p.breakdown.classification === 'review').length,
    possible: best.filter((p) => p.breakdown.classification === 'possible').length,
  };

  return {
    proposals,
    unmatchedReceiptIds: receipts.filter((r) => !claimedReceipts.has(r.id)).map((r) => r.id),
    unmatchedTransactionIds: transactions.filter((t) => !claimedTransactions.has(t.id)).map((t) => t.id),
    stats,
  };
}
