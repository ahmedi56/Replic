import 'server-only';
import { and, eq, inArray, desc, sql } from 'drizzle-orm';
import { db } from '@/db';
import { receipts, receiptExtractions, transactions, matches, categories } from '@/db/schema';
import { recordAudit } from '../audit';
import type { AuthContext } from '../auth/session';

export type ExportScope = 'all' | 'matched' | 'review' | 'unmatched';

const COLUMNS = [
  'Receipt ID',
  'Receipt file',
  'Merchant',
  'Receipt date',
  'Amount',
  'Currency',
  'VAT',
  'Invoice number',
  'Category',
  'Transaction ID',
  'Bank description',
  'Transaction date',
  'Transaction amount',
  'Match confidence',
  'Match method',
  'Status',
];

/** A plain number, including negatives and decimals — never a formula. */
const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * RFC 4180 quoting, plus a guard against spreadsheet formula injection.
 *
 * Excel and Sheets execute a cell beginning with =, +, @, tab or CR, so those are
 * neutralised with a leading apostrophe. A leading "-" can also begin a formula, but
 * financial exports are full of negative amounts — quoting those would turn every debit
 * into text — so "-" is only escaped when the value isn't a plain number.
 */
function csvCell(value: unknown): string {
  if (value == null) return '';
  let s = String(value);
  if (/^[=+@\t\r]/.test(s) || (s.startsWith('-') && !NUMERIC.test(s))) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function isoDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : '';
}

export async function buildExportCsv(auth: AuthContext, scope: ExportScope = 'all'): Promise<string> {
  const rows = await collectRows(auth.organizationId, scope);

  const lines = [COLUMNS.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.receiptId,
        r.receiptName,
        r.merchant,
        isoDate(r.receiptDate),
        r.receiptTotal ?? '',
        r.receiptCurrency ?? '',
        r.tax ?? '',
        r.invoiceNumber ?? '',
        r.categoryName ?? '',
        r.transactionId ?? '',
        r.descriptionRaw ?? '',
        isoDate(r.transactionDate),
        r.amount ?? '',
        r.score != null ? `${r.score}%` : '',
        r.method ?? '',
        r.statusLabel,
      ]
        .map(csvCell)
        .join(','),
    );
  }

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    actorLabel: auth.name ?? auth.email,
    action: 'export.generated',
    entityType: 'organization',
    entityId: auth.organizationId,
    detail: `${scope}: ${rows.length} rows`,
  });

  // The BOM makes Excel open UTF-8 correctly without an import wizard.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

async function collectRows(organizationId: string, scope: ExportScope) {
  const matchStatus =
    scope === 'matched' ? inArray(matches.status, ['confirmed', 'auto']) : scope === 'review' ? eq(matches.status, 'suggested') : undefined;

  const joined = await db
    .select({
      receiptId: receipts.id,
      receiptName: receipts.originalName,
      merchant: receiptExtractions.merchantRaw,
      receiptDate: receiptExtractions.date,
      receiptTotal: receiptExtractions.total,
      receiptCurrency: receiptExtractions.currency,
      tax: receiptExtractions.tax,
      invoiceNumber: receiptExtractions.invoiceNumber,
      categoryName: categories.name,
      isDuplicate: receipts.isDuplicate,
      matchStatus: matches.status,
      score: matches.score,
      method: matches.method,
      transactionId: transactions.id,
      descriptionRaw: transactions.descriptionRaw,
      transactionDate: transactions.date,
      amount: transactions.amount,
    })
    .from(receipts)
    .leftJoin(receiptExtractions, eq(receiptExtractions.receiptId, receipts.id))
    .leftJoin(categories, eq(categories.id, receipts.categoryId))
    .leftJoin(matches, and(eq(matches.receiptId, receipts.id), inArray(matches.status, ['suggested', 'confirmed', 'auto'])))
    .leftJoin(transactions, eq(transactions.id, matches.transactionId))
    .where(and(eq(receipts.organizationId, organizationId), matchStatus))
    .orderBy(desc(receipts.createdAt));

  const mapped = joined.map((r) => ({
    ...r,
    statusLabel: r.isDuplicate
      ? 'Duplicate'
      : r.matchStatus === 'confirmed' || r.matchStatus === 'auto'
        ? 'Matched'
        : r.matchStatus === 'suggested'
          ? 'Needs review'
          : 'Unmatched',
  }));

  if (scope === 'unmatched') {
    // Unmatched transactions belong in this view too — a bank line with no receipt is
    // exactly what an accountant is looking for.
    const orphanTransactions = await db
      .select({
        transactionId: transactions.id,
        descriptionRaw: transactions.descriptionRaw,
        transactionDate: transactions.date,
        amount: transactions.amount,
        currency: transactions.currency,
        categoryName: categories.name,
      })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          eq(transactions.organizationId, organizationId),
          sql`${transactions.id} not in ${db
            .select({ id: matches.transactionId })
            .from(matches)
            .where(and(eq(matches.organizationId, organizationId), inArray(matches.status, ['suggested', 'confirmed', 'auto'])))}`,
        ),
      )
      .orderBy(desc(transactions.date));

    return [
      ...mapped.filter((r) => r.statusLabel === 'Unmatched'),
      ...orphanTransactions.map((t) => ({
        receiptId: '',
        receiptName: '',
        merchant: null,
        receiptDate: null,
        receiptTotal: null,
        receiptCurrency: t.currency,
        tax: null,
        invoiceNumber: null,
        categoryName: t.categoryName,
        isDuplicate: false,
        matchStatus: null,
        score: null,
        method: null,
        transactionId: t.transactionId,
        descriptionRaw: t.descriptionRaw,
        transactionDate: t.transactionDate,
        amount: t.amount,
        statusLabel: 'Transaction without receipt',
      })),
    ];
  }

  return mapped;
}
