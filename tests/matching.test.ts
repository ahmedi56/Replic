import { describe, it, expect } from 'vitest';
import { scoreMatch, ReceiptSide, TransactionSide } from '@/lib/matching/score';
import { runMatching } from '@/lib/matching/engine';
import { DEFAULT_MATCHING_CONFIG, resolveConfig, classify } from '@/lib/matching/config';
import { findAllDuplicates, findDuplicate } from '@/lib/matching/duplicates';
import { normalizeMerchant } from '@/lib/matching/normalize';
import type { SemanticProvider } from '@/lib/ai/types';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function receipt(over: Partial<ReceiptSide> = {}): ReceiptSide {
  return {
    id: 'r1',
    merchantNorm: 'carrefour',
    date: d('2026-09-28'),
    total: 47.85,
    currency: 'EUR',
    paymentMethod: 'card',
    ...over,
  };
}

function txn(over: Partial<TransactionSide> = {}): TransactionSide {
  return {
    id: 't1',
    merchantNorm: 'carrefour',
    descriptionNorm: 'carrefour',
    date: d('2026-09-28'),
    amount: -47.85,
    currency: 'EUR',
    paymentMethod: 'card',
    ...over,
  };
}

describe('scoreMatch', () => {
  it('scores a perfect pair as an automatic match', () => {
    const b = scoreMatch(receipt(), txn());
    expect(b.score).toBeGreaterThanOrEqual(DEFAULT_MATCHING_CONFIG.thresholds.auto);
    expect(b.classification).toBe('auto');
    expect(b.veto).toBeUndefined();
  });

  it('compares amounts by absolute value, since bank debits are negative', () => {
    const b = scoreMatch(receipt({ total: 47.85 }), txn({ amount: -47.85 }));
    expect(b.signals.find((s) => s.name === 'amount')!.score).toBe(1);
  });

  it('tolerates a one-cent difference as a rounding artefact', () => {
    const b = scoreMatch(receipt({ total: 47.85 }), txn({ amount: -47.84 }));
    expect(b.signals.find((s) => s.name === 'amount')!.score).toBe(1);
  });

  it('rejects a pair whose amounts are far apart', () => {
    const b = scoreMatch(receipt({ total: 47.85 }), txn({ amount: -120 }));
    expect(b.classification).toBe('none');
    expect(b.veto).toBeTruthy();
  });

  it('accepts a transaction posted a day later', () => {
    const b = scoreMatch(receipt(), txn({ date: d('2026-09-29') }));
    expect(b.score).toBeGreaterThanOrEqual(DEFAULT_MATCHING_CONFIG.thresholds.review);
    expect(b.signals.find((s) => s.name === 'date')!.reason).toMatch(/1 day after/);
  });

  it('rejects a transaction far outside the date window', () => {
    const b = scoreMatch(receipt(), txn({ date: d('2026-10-20') }));
    expect(b.classification).toBe('none');
  });

  it('survives a merchant typo but reports lower merchant confidence', () => {
    const perfect = scoreMatch(receipt(), txn());
    const typo = scoreMatch(receipt(), txn({ merchantNorm: 'carefour', descriptionNorm: 'carefour' }));
    expect(typo.score).toBeLessThan(perfect.score);
    expect(typo.score).toBeGreaterThanOrEqual(DEFAULT_MATCHING_CONFIG.thresholds.review);
  });

  it('never auto-matches across currencies', () => {
    const b = scoreMatch(receipt({ currency: 'EUR' }), txn({ currency: 'USD' }));
    expect(b.classification).not.toBe('auto');
    expect(b.veto).toMatch(/currency/i);
  });

  it('renormalizes weights when a signal is missing rather than penalising it', () => {
    const withMethod = scoreMatch(receipt(), txn());
    const withoutMethod = scoreMatch(receipt({ paymentMethod: null }), txn({ paymentMethod: null }));
    expect(withoutMethod.score).toBeCloseTo(withMethod.score, 1);
    expect(withoutMethod.signals.find((s) => s.name === 'paymentMethod')!.applicability).toBe(0);
  });

  it('explains every signal it used', () => {
    const b = scoreMatch(receipt(), txn());
    for (const s of b.signals) expect(s.reason.length).toBeGreaterThan(3);
  });
});

describe('configuration', () => {
  it('honours overridden weights', () => {
    const merchantHeavy = resolveConfig(JSON.stringify({ weights: { amount: 0.1, merchant: 0.6 } }));
    expect(merchantHeavy.weights.merchant).toBe(0.6);
    expect(merchantHeavy.weights.date).toBe(DEFAULT_MATCHING_CONFIG.weights.date);
  });

  it('honours overridden thresholds', () => {
    const strict = resolveConfig(JSON.stringify({ thresholds: { auto: 99 } }));
    expect(classify(95, strict)).toBe('review');
    expect(classify(95, DEFAULT_MATCHING_CONFIG)).toBe('auto');
  });

  it('falls back to defaults on malformed config', () => {
    expect(resolveConfig('{not json')).toEqual(DEFAULT_MATCHING_CONFIG);
  });
});

describe('runMatching', () => {
  it('matches the obvious pairs and reports the rest as unmatched', async () => {
    const receipts = [
      receipt({ id: 'r1', merchantNorm: 'carrefour', total: 47.85, date: d('2026-09-28') }),
      receipt({ id: 'r2', merchantNorm: 'amazon', total: 39.99, date: d('2026-09-27') }),
      receipt({ id: 'r3', merchantNorm: 'nowhere ltd', total: 500, date: d('2026-09-01') }),
    ];
    const transactions = [
      txn({ id: 't1', merchantNorm: 'carrefour', descriptionNorm: 'pos carrefour', amount: -47.85, date: d('2026-09-28') }),
      txn({ id: 't2', merchantNorm: 'amazon', descriptionNorm: 'amazon eu', amount: -39.99, date: d('2026-09-28') }),
      txn({ id: 't9', merchantNorm: 'rent', descriptionNorm: 'sepa rent', amount: -900, date: d('2026-09-02') }),
    ];

    const result = await runMatching({ receipts, transactions });
    const best = result.proposals.filter((p) => p.isBest);

    expect(best.map((p) => `${p.receiptId}:${p.transactionId}`).sort()).toEqual(['r1:t1', 'r2:t2']);
    expect(result.unmatchedReceiptIds).toEqual(['r3']);
    expect(result.unmatchedTransactionIds).toEqual(['t9']);
    expect(result.stats.auto).toBe(2);
  });

  it('does not match two identical receipts to the same transaction', async () => {
    const receipts = [
      receipt({ id: 'r1', total: 20, date: d('2026-09-28') }),
      receipt({ id: 'r2', total: 20, date: d('2026-09-28') }),
    ];
    const transactions = [txn({ id: 't1', amount: -20, date: d('2026-09-28') })];

    const result = await runMatching({ receipts, transactions });
    const best = result.proposals.filter((p) => p.isBest);
    expect(best).toHaveLength(1);
    expect(result.unmatchedReceiptIds).toHaveLength(1);
  });

  it('keeps the runner-up as a reviewable alternative', async () => {
    const receipts = [receipt({ id: 'r1', total: 20, date: d('2026-09-28') })];
    const transactions = [
      txn({ id: 't1', amount: -20, date: d('2026-09-28') }),
      txn({ id: 't2', amount: -20, date: d('2026-09-29') }),
    ];
    const result = await runMatching({ receipts, transactions });
    expect(result.proposals.length).toBeGreaterThan(1);
    expect(result.proposals.filter((p) => p.isBest)).toHaveLength(1);
  });

  it('only consults the semantic provider for ambiguous merchant pairs', async () => {
    const calls: string[] = [];
    const semantic: SemanticProvider = {
      name: 'spy',
      isAvailable: () => true,
      async compareMerchant(query, candidates) {
        calls.push(query);
        return Object.fromEntries(candidates.map((c) => [c.id, 0.95]));
      },
    };

    const receipts = [
      receipt({ id: 'easy', merchantNorm: 'carrefour', total: 10, date: d('2026-09-28') }),
      receipt({ id: 'hard', merchantNorm: 'amazon marketplace', total: 25, date: d('2026-09-28') }),
    ];
    const transactions = [
      txn({ id: 'te', merchantNorm: 'carrefour', descriptionNorm: 'carrefour', amount: -10, date: d('2026-09-28') }),
      txn({ id: 'th', merchantNorm: 'amzn mktp de', descriptionNorm: 'amzn mktp de', amount: -25, date: d('2026-09-28') }),
    ];

    const result = await runMatching({ receipts, transactions, semantic });
    expect(calls).toEqual(['amazon marketplace']); // the easy pair never escalated
    expect(result.stats.semanticCalls).toBe(1);
    const hard = result.proposals.find((p) => p.receiptId === 'hard' && p.isBest);
    expect(hard?.method).toBe('semantic');
  });

  it('falls back to deterministic scores when the provider throws', async () => {
    const semantic: SemanticProvider = {
      name: 'broken',
      isAvailable: () => true,
      async compareMerchant() {
        throw new Error('provider down');
      },
    };
    const receipts = [receipt({ id: 'hard', merchantNorm: 'amazon marketplace', total: 25, date: d('2026-09-28') })];
    const transactions = [txn({ id: 'th', merchantNorm: 'amzn mktp de', descriptionNorm: 'amzn mktp de', amount: -25, date: d('2026-09-28') })];

    const result = await runMatching({ receipts, transactions, semantic });
    expect(result.proposals.every((p) => p.method === 'deterministic')).toBe(true);
  });

  it('stays bounded on a large dataset', async () => {
    const receipts = Array.from({ length: 300 }, (_, i) =>
      receipt({ id: `r${i}`, total: 10 + (i % 97), date: d('2026-09-15'), merchantNorm: `merchant ${i % 40}` }),
    );
    const transactions = Array.from({ length: 1200 }, (_, i) =>
      txn({
        id: `t${i}`,
        amount: -(10 + (i % 97)),
        date: d('2026-09-15'),
        merchantNorm: `merchant ${i % 40}`,
        descriptionNorm: `merchant ${i % 40}`,
      }),
    );
    const started = Date.now();
    const result = await runMatching({ receipts, transactions });
    expect(Date.now() - started).toBeLessThan(5000);
    // Candidate capping must keep the pair count far below the 360,000 cartesian product.
    expect(result.stats.pairsScored).toBeLessThan(300 * DEFAULT_MATCHING_CONFIG.maxCandidatesPerReceipt + 1);
  });
});

describe('duplicate detection', () => {
  const base = {
    checksum: 'aaa',
    merchantNorm: 'carrefour',
    date: d('2026-09-28'),
    total: 47.85,
    invoiceNumber: null as string | null,
    createdAt: new Date('2026-09-28T10:00:00Z'),
  };

  it('flags a byte-identical re-upload with full confidence', () => {
    const f = findDuplicate(
      { ...base, id: 'b', createdAt: new Date('2026-09-28T11:00:00Z') },
      [{ ...base, id: 'a' }],
    );
    expect(f?.kind).toBe('identical_file');
    expect(f?.confidence).toBe(1);
    expect(f?.duplicateOfId).toBe('a'); // the older receipt stays the original
    expect(f?.receiptId).toBe('b');
  });

  it('flags a shared invoice number', () => {
    const f = findDuplicate(
      { ...base, id: 'b', checksum: 'zzz', invoiceNumber: 'INV-48291', createdAt: new Date('2026-09-29T10:00:00Z') },
      [{ ...base, id: 'a', invoiceNumber: 'inv-48291' }],
    );
    expect(f?.kind).toBe('invoice_number');
  });

  it('flags the same merchant, amount and date captured twice', () => {
    const f = findDuplicate({ ...base, id: 'b', checksum: 'zzz', createdAt: new Date('2026-09-28T12:00:00Z') }, [{ ...base, id: 'a' }]);
    expect(f?.kind).toBe('merchant_amount_date');
    expect(f?.confidence).toBeGreaterThan(0.9);
  });

  it('does not flag the same merchant on a different day for a different amount', () => {
    const f = findDuplicate(
      { ...base, id: 'b', checksum: 'zzz', total: 12.4, date: d('2026-09-20'), createdAt: new Date('2026-09-20T10:00:00Z') },
      [{ ...base, id: 'a' }],
    );
    expect(f).toBeNull();
  });

  it('flags each duplicate once in a full scan', () => {
    const findings = findAllDuplicates([
      { ...base, id: 'a' },
      { ...base, id: 'b', createdAt: new Date('2026-09-28T11:00:00Z') },
      { ...base, id: 'c', createdAt: new Date('2026-09-28T12:00:00Z') },
      { ...base, id: 'd', checksum: 'other', merchantNorm: 'netflix', total: 9.99, createdAt: new Date('2026-09-28T13:00:00Z') },
    ]);
    expect(findings.map((f) => f.receiptId).sort()).toEqual(['b', 'c']);
  });
});

describe('end-to-end normalization into matching', () => {
  it('matches a receipt merchant against a noisy bank description', async () => {
    const receipts = [receipt({ id: 'r1', merchantNorm: normalizeMerchant('Carrefour'), total: 47.85, date: d('2026-09-28') })];
    const transactions = [
      txn({
        id: 't1',
        merchantNorm: normalizeMerchant('POS CARREFOUR MARKET TUNIS 2391'),
        descriptionNorm: 'pos carrefour market tunis 2391',
        amount: -47.85,
        date: d('2026-09-29'),
      }),
    ];
    const result = await runMatching({ receipts, transactions });
    const best = result.proposals.find((p) => p.isBest)!;
    expect(best.breakdown.score).toBeGreaterThanOrEqual(DEFAULT_MATCHING_CONFIG.thresholds.auto);
  });
});
