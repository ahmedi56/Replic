import 'server-only';
import { and, eq, inArray, ne, or, desc, sql, gte, lte } from 'drizzle-orm';
import { db } from '@/db';
import { receipts, receiptExtractions, transactions, matches, categories } from '@/db/schema';
import { newId } from '../ids';
import { runMatching } from '../matching/engine';
import { serializeBreakdown, scoreMatch, parseBreakdown, type ReceiptSide, type TransactionSide } from '../matching/score';
import { classify } from '../matching/config';
import { getSemanticProvider } from '../ai/registry';
import { getMatchingConfig } from './org';
import { recordAudit, recordAuditBatch } from '../audit';
import { notFound } from '../api';
import type { AuthContext } from '../auth/session';

export interface MatchOutcome {
  receiptId: string;
  transactionId: string | null;
  score: number | null;
  status: 'completed' | 'needs_review' | 'unmatched';
}

/**
 * Run matching for a set of receipts (or the whole organization when none is given).
 *
 * Candidate transactions are narrowed in SQL before the engine sees them: only
 * transactions that are still free, inside the date window, and near the right amount.
 * A confirmed match is never overwritten by a re-run.
 */
export async function matchReceipts(
  auth: AuthContext,
  receiptIds?: string[],
): Promise<{ results: MatchOutcome[]; stats: { auto: number; review: number; unmatched: number } }> {
  const cfg = await getMatchingConfig(auth.organizationId);

  const receiptRows = await db
    .select({
      id: receipts.id,
      merchantNorm: receiptExtractions.merchantNorm,
      date: receiptExtractions.date,
      total: receiptExtractions.total,
      currency: receiptExtractions.currency,
      paymentMethod: receiptExtractions.paymentMethod,
    })
    .from(receipts)
    .leftJoin(receiptExtractions, eq(receiptExtractions.receiptId, receipts.id))
    .where(
      and(
        eq(receipts.organizationId, auth.organizationId),
        eq(receipts.isDuplicate, false),
        receiptIds?.length ? inArray(receipts.id, receiptIds) : undefined,
      ),
    );

  if (!receiptRows.length) return { results: [], stats: { auto: 0, review: 0, unmatched: 0 } };

  // Transactions already locked into a confirmed match are out of the running.
  const confirmed = await db
    .select({ transactionId: matches.transactionId, receiptId: matches.receiptId })
    .from(matches)
    .where(and(eq(matches.organizationId, auth.organizationId), inArray(matches.status, ['confirmed', 'auto'])));

  const lockedTransactions = new Set(confirmed.map((c) => c.transactionId));
  const lockedReceipts = new Set(confirmed.map((c) => c.receiptId));

  const candidateReceipts: ReceiptSide[] = receiptRows
    .filter((r) => !lockedReceipts.has(r.id))
    .map((r) => ({
      id: r.id,
      merchantNorm: r.merchantNorm,
      date: r.date,
      total: r.total,
      currency: r.currency,
      paymentMethod: r.paymentMethod,
    }));

  if (!candidateReceipts.length) {
    return { results: [], stats: { auto: 0, review: 0, unmatched: 0 } };
  }

  // Narrow transactions by the date span covered by these receipts, in SQL.
  const dates = candidateReceipts.map((r) => r.date?.getTime()).filter((t): t is number => t != null);
  const dayMs = 86_400_000;
  const dateFilter = dates.length
    ? and(
        gte(transactions.date, new Date(Math.min(...dates) - cfg.date.maxDaysBefore * dayMs)),
        lte(transactions.date, new Date(Math.max(...dates) + cfg.date.maxDaysAfter * dayMs)),
      )
    : undefined;

  const txnRows = await db
    .select({
      id: transactions.id,
      merchantNorm: transactions.merchantNorm,
      descriptionNorm: transactions.descriptionNorm,
      date: transactions.date,
      amount: transactions.amount,
      currency: transactions.currency,
      paymentMethod: transactions.paymentMethod,
    })
    .from(transactions)
    .where(and(eq(transactions.organizationId, auth.organizationId), dateFilter));

  const candidateTransactions: TransactionSide[] = txnRows
    .filter((t) => !lockedTransactions.has(t.id))
    .map((t) => ({
      id: t.id,
      merchantNorm: t.merchantNorm,
      descriptionNorm: t.descriptionNorm,
      date: t.date,
      amount: t.amount,
      currency: t.currency,
      paymentMethod: t.paymentMethod,
    }));

  const run = await runMatching({
    receipts: candidateReceipts,
    transactions: candidateTransactions,
    config: cfg,
    semantic: getSemanticProvider(),
  });

  // Clear previous *unconfirmed* proposals for these receipts, then write the new ones.
  const ids = candidateReceipts.map((r) => r.id);
  await db
    .delete(matches)
    .where(
      and(
        eq(matches.organizationId, auth.organizationId),
        inArray(matches.receiptId, ids),
        inArray(matches.status, ['suggested', 'rejected', 'alternate']),
      ),
    );

  const rejected = await db
    .select({ receiptId: matches.receiptId, transactionId: matches.transactionId })
    .from(matches)
    .where(and(eq(matches.organizationId, auth.organizationId), eq(matches.status, 'rejected')));
  const rejectedPairs = new Set(rejected.map((r) => `${r.receiptId}:${r.transactionId}`));

  const results: MatchOutcome[] = [];
  const auditEntries: Parameters<typeof recordAudit>[0][] = [];
  const toInsert: (typeof matches.$inferInsert)[] = [];

  for (const proposal of run.proposals) {
    // A pair the user already rejected must not come back on the next run.
    if (rejectedPairs.has(`${proposal.receiptId}:${proposal.transactionId}`)) continue;

    const isAuto = proposal.isBest && proposal.breakdown.classification === 'auto';
    // Only the winning pair for a receipt is ever queued for review. Runner-ups are kept
    // as `alternate` so the detail page can offer them, but they must not cost the user a
    // decision — a receipt that already matched at 100% shouldn't also ask about its
    // second-best candidate.
    const status = isAuto ? 'auto' : proposal.isBest ? 'suggested' : 'alternate';
    toInsert.push({
      id: newId('mat'),
      organizationId: auth.organizationId,
      receiptId: proposal.receiptId,
      transactionId: proposal.transactionId,
      score: proposal.breakdown.score,
      status,
      breakdown: serializeBreakdown(proposal.breakdown),
      method: proposal.method,
    });

    if (proposal.isBest) {
      auditEntries.push({
        organizationId: auth.organizationId,
        action: isAuto ? 'match.auto' : 'match.suggested',
        entityType: 'receipt',
        entityId: proposal.receiptId,
        detail: `${proposal.breakdown.score}% via ${proposal.method}`,
      });
      results.push({
        receiptId: proposal.receiptId,
        transactionId: proposal.transactionId,
        score: proposal.breakdown.score,
        status: isAuto ? 'completed' : 'needs_review',
      });
    }
  }

  if (toInsert.length) await db.insert(matches).values(toInsert).onConflictDoNothing();
  await recordAuditBatch(auditEntries);

  for (const receiptId of run.unmatchedReceiptIds) {
    results.push({ receiptId, transactionId: null, score: null, status: 'unmatched' });
  }

  // Reflect the outcome on each receipt's own status.
  for (const r of results) {
    const status = r.status === 'completed' ? 'completed' : r.status === 'needs_review' ? 'needs_review' : 'completed';
    await db
      .update(receipts)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(receipts.id, r.receiptId), eq(receipts.organizationId, auth.organizationId)));
  }

  return {
    results,
    stats: {
      auto: results.filter((r) => r.status === 'completed').length,
      review: results.filter((r) => r.status === 'needs_review').length,
      unmatched: results.filter((r) => r.status === 'unmatched').length,
    },
  };
}

/** The full row set behind the Matched / Needs Review screens. */
export async function listMatches(
  organizationId: string,
  opts: { status?: 'matched' | 'review'; search?: string; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));

  const statusFilter =
    opts.status === 'matched'
      ? inArray(matches.status, ['confirmed', 'auto'])
      : opts.status === 'review'
        ? eq(matches.status, 'suggested')
        : inArray(matches.status, ['suggested', 'confirmed', 'auto']);

  const conditions = [eq(matches.organizationId, organizationId), statusFilter];
  if (opts.search) {
    const term = `%${opts.search.toLowerCase()}%`;
    conditions.push(
      sql`(lower(${receiptExtractions.merchantRaw}) like ${term} or lower(${transactions.descriptionRaw}) like ${term})`,
    );
  }

  const rows = await db
    .select({
      matchId: matches.id,
      score: matches.score,
      status: matches.status,
      breakdown: matches.breakdown,
      method: matches.method,
      receiptId: receipts.id,
      receiptName: receipts.originalName,
      receiptMime: receipts.mimeType,
      merchantRaw: receiptExtractions.merchantRaw,
      receiptDate: receiptExtractions.date,
      receiptTotal: receiptExtractions.total,
      receiptCurrency: receiptExtractions.currency,
      receiptConfidence: receiptExtractions.overallConfidence,
      transactionId: transactions.id,
      descriptionRaw: transactions.descriptionRaw,
      transactionDate: transactions.date,
      amount: transactions.amount,
      transactionCurrency: transactions.currency,
      categoryName: categories.name,
      categoryColor: categories.color,
    })
    .from(matches)
    .innerJoin(receipts, eq(receipts.id, matches.receiptId))
    .leftJoin(receiptExtractions, eq(receiptExtractions.receiptId, receipts.id))
    .innerJoin(transactions, eq(transactions.id, matches.transactionId))
    .leftJoin(categories, eq(categories.id, receipts.categoryId))
    .where(and(...conditions))
    // Needs Review is ordered highest-confidence first: the quickest wins come first.
    .orderBy(desc(matches.score))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const countRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(matches)
    .innerJoin(receipts, eq(receipts.id, matches.receiptId))
    .leftJoin(receiptExtractions, eq(receiptExtractions.receiptId, receipts.id))
    .innerJoin(transactions, eq(transactions.id, matches.transactionId))
    .where(and(...conditions));

  return {
    rows: rows.map((r) => ({ ...r, parsedBreakdown: parseBreakdown(r.breakdown) })),
    total: Number(countRows[0]?.count ?? 0),
    page,
    pageSize,
  };
}

export async function confirmMatch(auth: AuthContext, matchId: string): Promise<void> {
  const row = await requireMatch(auth.organizationId, matchId);

  await db
    .update(matches)
    .set({ status: 'confirmed', confirmedBy: auth.userId, updatedAt: new Date() })
    .where(eq(matches.id, matchId));

  // Confirming one pair retires the competing proposals on both sides.
  await db
    .delete(matches)
    .where(
      and(
        eq(matches.organizationId, auth.organizationId),
        inArray(matches.status, ['suggested', 'alternate']),
        or(eq(matches.receiptId, row.receiptId), eq(matches.transactionId, row.transactionId)),
        ne(matches.id, matchId),
      ),
    );

  await db
    .update(receipts)
    .set({ status: 'completed', updatedAt: new Date() })
    .where(and(eq(receipts.id, row.receiptId), eq(receipts.organizationId, auth.organizationId)));

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    actorLabel: auth.name ?? auth.email,
    action: 'match.confirmed',
    entityType: 'match',
    entityId: matchId,
    detail: `receipt ${row.receiptId} ↔ transaction ${row.transactionId} at ${row.score}%`,
  });
}

export async function rejectMatch(auth: AuthContext, matchId: string): Promise<void> {
  const row = await requireMatch(auth.organizationId, matchId);

  // Kept as a tombstone rather than deleted, so the next run doesn't re-propose it.
  await db.update(matches).set({ status: 'rejected', updatedAt: new Date() }).where(eq(matches.id, matchId));

  const remaining = await db
    .select({ id: matches.id })
    .from(matches)
    .where(
      and(eq(matches.organizationId, auth.organizationId), eq(matches.receiptId, row.receiptId), inArray(matches.status, ['suggested', 'alternate', 'confirmed', 'auto'])),
    );

  await db
    .update(receipts)
    .set({ status: remaining.length ? 'needs_review' : 'completed', updatedAt: new Date() })
    .where(and(eq(receipts.id, row.receiptId), eq(receipts.organizationId, auth.organizationId)));

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    actorLabel: auth.name ?? auth.email,
    action: 'match.rejected',
    entityType: 'match',
    entityId: matchId,
  });
}

/** Manual pairing from the receipt detail page. Scored like any other match, for transparency. */
export async function createManualMatch(auth: AuthContext, receiptId: string, transactionId: string): Promise<string> {
  const cfg = await getMatchingConfig(auth.organizationId);

  const receiptRow = (
    await db
      .select({
        id: receipts.id,
        merchantNorm: receiptExtractions.merchantNorm,
        date: receiptExtractions.date,
        total: receiptExtractions.total,
        currency: receiptExtractions.currency,
        paymentMethod: receiptExtractions.paymentMethod,
      })
      .from(receipts)
      .leftJoin(receiptExtractions, eq(receiptExtractions.receiptId, receipts.id))
      .where(and(eq(receipts.id, receiptId), eq(receipts.organizationId, auth.organizationId)))
      .limit(1)
  )[0];

  const txnRow = (
    await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.organizationId, auth.organizationId)))
      .limit(1)
  )[0];

  if (!receiptRow || !txnRow) throw notFound('Receipt or transaction not found');

  const breakdown = scoreMatch(
    {
      id: receiptRow.id,
      merchantNorm: receiptRow.merchantNorm,
      date: receiptRow.date,
      total: receiptRow.total,
      currency: receiptRow.currency,
      paymentMethod: receiptRow.paymentMethod,
    },
    {
      id: txnRow.id,
      merchantNorm: txnRow.merchantNorm,
      descriptionNorm: txnRow.descriptionNorm,
      date: txnRow.date,
      amount: txnRow.amount,
      currency: txnRow.currency,
      paymentMethod: txnRow.paymentMethod,
    },
    cfg,
  );

  // Clear whatever else was proposed for either side.
  await db
    .delete(matches)
    .where(
      and(
        eq(matches.organizationId, auth.organizationId),
        inArray(matches.status, ['suggested', 'alternate']),
        or(eq(matches.receiptId, receiptId), eq(matches.transactionId, transactionId)),
      ),
    );

  const id = newId('mat');
  await db
    .insert(matches)
    .values({
      id,
      organizationId: auth.organizationId,
      receiptId,
      transactionId,
      score: breakdown.score,
      status: 'confirmed',
      breakdown: serializeBreakdown(breakdown),
      method: 'manual',
      confirmedBy: auth.userId,
    })
    .onConflictDoUpdate({
      target: [matches.receiptId, matches.transactionId],
      set: { status: 'confirmed', method: 'manual', confirmedBy: auth.userId, updatedAt: new Date() },
    });

  await db
    .update(receipts)
    .set({ status: 'completed', updatedAt: new Date() })
    .where(and(eq(receipts.id, receiptId), eq(receipts.organizationId, auth.organizationId)));

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    actorLabel: auth.name ?? auth.email,
    action: 'match.manual',
    entityType: 'match',
    entityId: id,
    detail: `manually matched at ${breakdown.score}%`,
  });
  return id;
}

export async function unlinkMatch(auth: AuthContext, matchId: string): Promise<void> {
  const row = await requireMatch(auth.organizationId, matchId);
  await db.delete(matches).where(and(eq(matches.id, matchId), eq(matches.organizationId, auth.organizationId)));
  await db
    .update(receipts)
    .set({ status: 'completed', updatedAt: new Date() })
    .where(and(eq(receipts.id, row.receiptId), eq(receipts.organizationId, auth.organizationId)));
  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    actorLabel: auth.name ?? auth.email,
    action: 'match.unlinked',
    entityType: 'match',
    entityId: matchId,
  });
}

async function requireMatch(organizationId: string, matchId: string) {
  const rows = await db
    .select()
    .from(matches)
    .where(and(eq(matches.id, matchId), eq(matches.organizationId, organizationId)))
    .limit(1);
  if (!rows[0]) throw notFound('Match not found');
  return rows[0];
}

/** Transactions with no live match — one half of the Unmatched view. */
export async function listUnmatchedTransactions(organizationId: string, opts: { page?: number; pageSize?: number; search?: string } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));

  const live = db
    .select({ id: matches.transactionId })
    .from(matches)
    .where(and(eq(matches.organizationId, organizationId), inArray(matches.status, ['suggested', 'confirmed', 'auto'])));

  const conditions = [eq(transactions.organizationId, organizationId), sql`${transactions.id} not in ${live}`];
  if (opts.search) {
    const term = `%${opts.search.toLowerCase()}%`;
    conditions.push(sql`lower(${transactions.descriptionRaw}) like ${term}`);
  }

  const rows = await db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.date))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const countRows = await db.select({ count: sql<number>`count(*)` }).from(transactions).where(and(...conditions));
  return { rows, total: Number(countRows[0]?.count ?? 0), page, pageSize };
}

/** Receipts with no live match — the other half. */
export async function listUnmatchedReceipts(organizationId: string, opts: { page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));

  const live = db
    .select({ id: matches.receiptId })
    .from(matches)
    .where(and(eq(matches.organizationId, organizationId), inArray(matches.status, ['suggested', 'confirmed', 'auto'])));

  const conditions = [
    eq(receipts.organizationId, organizationId),
    eq(receipts.isDuplicate, false),
    sql`${receipts.id} not in ${live}`,
  ];

  const rows = await db
    .select({
      id: receipts.id,
      originalName: receipts.originalName,
      status: receipts.status,
      createdAt: receipts.createdAt,
      merchantRaw: receiptExtractions.merchantRaw,
      date: receiptExtractions.date,
      total: receiptExtractions.total,
      currency: receiptExtractions.currency,
      overallConfidence: receiptExtractions.overallConfidence,
    })
    .from(receipts)
    .leftJoin(receiptExtractions, eq(receiptExtractions.receiptId, receipts.id))
    .where(and(...conditions))
    .orderBy(desc(receipts.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const countRows = await db.select({ count: sql<number>`count(*)` }).from(receipts).where(and(...conditions));
  return { rows, total: Number(countRows[0]?.count ?? 0), page, pageSize };
}

/** Candidate transactions offered when a user matches a receipt by hand. */
export async function suggestTransactionsForReceipt(organizationId: string, receiptId: string, search?: string) {
  const cfg = await getMatchingConfig(organizationId);
  const receiptRow = (
    await db
      .select({
        id: receipts.id,
        merchantNorm: receiptExtractions.merchantNorm,
        date: receiptExtractions.date,
        total: receiptExtractions.total,
        currency: receiptExtractions.currency,
        paymentMethod: receiptExtractions.paymentMethod,
      })
      .from(receipts)
      .leftJoin(receiptExtractions, eq(receiptExtractions.receiptId, receipts.id))
      .where(and(eq(receipts.id, receiptId), eq(receipts.organizationId, organizationId)))
      .limit(1)
  )[0];
  if (!receiptRow) return [];

  const conditions = [eq(transactions.organizationId, organizationId)];
  if (search) {
    const term = `%${search.toLowerCase()}%`;
    conditions.push(sql`lower(${transactions.descriptionRaw}) like ${term}`);
  }

  const txnRows = await db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.date))
    .limit(search ? 25 : 400);

  const side: ReceiptSide = {
    id: receiptRow.id,
    merchantNorm: receiptRow.merchantNorm,
    date: receiptRow.date,
    total: receiptRow.total,
    currency: receiptRow.currency,
    paymentMethod: receiptRow.paymentMethod,
  };

  return txnRows
    .map((t) => {
      const breakdown = scoreMatch(
        side,
        {
          id: t.id,
          merchantNorm: t.merchantNorm,
          descriptionNorm: t.descriptionNorm,
          date: t.date,
          amount: t.amount,
          currency: t.currency,
          paymentMethod: t.paymentMethod,
        },
        cfg,
      );
      return { transaction: t, score: breakdown.score, classification: classify(breakdown.score, cfg) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

/** Every live pairing for one receipt: the winner plus any alternates worth offering. */
export async function listMatchesForReceipt(organizationId: string, receiptId: string) {
  const rows = await db
    .select({
      matchId: matches.id,
      score: matches.score,
      status: matches.status,
      breakdown: matches.breakdown,
      method: matches.method,
      transactionId: transactions.id,
      descriptionRaw: transactions.descriptionRaw,
      transactionDate: transactions.date,
      amount: transactions.amount,
      transactionCurrency: transactions.currency,
    })
    .from(matches)
    .innerJoin(transactions, eq(transactions.id, matches.transactionId))
    .where(
      and(
        eq(matches.organizationId, organizationId),
        eq(matches.receiptId, receiptId),
        inArray(matches.status, ['suggested', 'alternate', 'confirmed', 'auto']),
      ),
    )
    .orderBy(desc(matches.score));

  return rows.map((r) => ({ ...r, parsedBreakdown: parseBreakdown(r.breakdown) }));
}
