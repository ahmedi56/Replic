import 'server-only';
import { and, eq, inArray, desc, sql } from 'drizzle-orm';
import { db } from '@/db';
import { receipts, transactions, matches, auditLogs, categories, receiptExtractions } from '@/db/schema';

export interface DashboardStats {
  receipts: number;
  transactions: number;
  matched: number;
  needsReview: number;
  unmatchedReceipts: number;
  unmatchedTransactions: number;
  duplicates: number;
  reconciliationRate: number;
  totalMatchedValue: number;
  currency: string;
}

/** Every dashboard number in one query pass — no N+1, nothing computed in the browser. */
export async function getDashboardStats(organizationId: string): Promise<DashboardStats> {
  const scalar = async (q: Promise<Array<{ count: number }>>) => Number((await q)[0]?.count ?? 0);

  const receiptCount = await scalar(
    db
      .select({ count: sql<number>`count(*)` })
      .from(receipts)
      .where(and(eq(receipts.organizationId, organizationId), eq(receipts.isDuplicate, false))),
  );

  const duplicates = await scalar(
    db
      .select({ count: sql<number>`count(*)` })
      .from(receipts)
      .where(and(eq(receipts.organizationId, organizationId), eq(receipts.isDuplicate, true))),
  );

  const transactionCount = await scalar(
    db.select({ count: sql<number>`count(*)` }).from(transactions).where(eq(transactions.organizationId, organizationId)),
  );

  const matched = await scalar(
    db
      .select({ count: sql<number>`count(*)` })
      .from(matches)
      .where(and(eq(matches.organizationId, organizationId), inArray(matches.status, ['confirmed', 'auto']))),
  );

  const needsReview = await scalar(
    db
      .select({ count: sql<number>`count(*)` })
      .from(matches)
      .where(and(eq(matches.organizationId, organizationId), eq(matches.status, 'suggested'))),
  );

  const liveReceiptIds = db
    .select({ id: matches.receiptId })
    .from(matches)
    .where(and(eq(matches.organizationId, organizationId), inArray(matches.status, ['suggested', 'confirmed', 'auto'])));

  const liveTransactionIds = db
    .select({ id: matches.transactionId })
    .from(matches)
    .where(and(eq(matches.organizationId, organizationId), inArray(matches.status, ['suggested', 'confirmed', 'auto'])));

  const unmatchedReceipts = await scalar(
    db
      .select({ count: sql<number>`count(*)` })
      .from(receipts)
      .where(
        and(
          eq(receipts.organizationId, organizationId),
          eq(receipts.isDuplicate, false),
          sql`${receipts.id} not in ${liveReceiptIds}`,
        ),
      ),
  );

  const unmatchedTransactions = await scalar(
    db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(and(eq(transactions.organizationId, organizationId), sql`${transactions.id} not in ${liveTransactionIds}`)),
  );

  const valueRows = await db
    .select({ total: sql<number>`coalesce(sum(abs(${transactions.amount})), 0)`, currency: transactions.currency })
    .from(matches)
    .innerJoin(transactions, eq(transactions.id, matches.transactionId))
    .where(and(eq(matches.organizationId, organizationId), inArray(matches.status, ['confirmed', 'auto'])))
    .groupBy(transactions.currency)
    .orderBy(desc(sql`sum(abs(${transactions.amount}))`))
    .limit(1);

  // Reconciliation rate = share of receipts that have reached a settled match.
  const reconciliationRate = receiptCount > 0 ? Math.round((matched / receiptCount) * 1000) / 10 : 0;

  return {
    receipts: receiptCount,
    transactions: transactionCount,
    matched,
    needsReview,
    unmatchedReceipts,
    unmatchedTransactions,
    duplicates,
    reconciliationRate: Math.min(100, reconciliationRate),
    totalMatchedValue: Number(valueRows[0]?.total ?? 0),
    currency: valueRows[0]?.currency ?? 'EUR',
  };
}

export async function getRecentActivity(organizationId: string, limit = 12) {
  return db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      actorLabel: auditLogs.actorLabel,
      detail: auditLogs.detail,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(eq(auditLogs.organizationId, organizationId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

export async function getAuditTrailFor(organizationId: string, entityType: string, entityId: string) {
  return db
    .select()
    .from(auditLogs)
    .where(
      and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(50);
}

/** Spend by category across reconciled receipts — the one chart on the dashboard. */
export async function getCategoryBreakdown(organizationId: string) {
  return db
    .select({
      name: sql<string>`coalesce(${categories.name}, 'Uncategorised')`,
      color: sql<string>`coalesce(${categories.color}, '#94A3B8')`,
      total: sql<number>`coalesce(sum(${receiptExtractions.total}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(receipts)
    .leftJoin(receiptExtractions, eq(receiptExtractions.receiptId, receipts.id))
    .leftJoin(categories, eq(categories.id, receipts.categoryId))
    .where(and(eq(receipts.organizationId, organizationId), eq(receipts.isDuplicate, false)))
    .groupBy(sql`coalesce(${categories.name}, 'Uncategorised')`, sql`coalesce(${categories.color}, '#94A3B8')`)
    .orderBy(desc(sql`sum(${receiptExtractions.total})`))
    .limit(9);
}
