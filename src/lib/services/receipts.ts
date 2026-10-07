import 'server-only';
import { and, eq, inArray, desc, sql } from 'drizzle-orm';
import { db } from '@/db';
import { receipts, receiptExtractions, categories, merchants } from '@/db/schema';
import { newId } from '../ids';
import { putDocument, type ValidatedUpload } from '../storage';
import { extractReceipt } from '../ai/registry';
import { normalizeMerchant } from '../matching/normalize';
import { findDuplicate, type DuplicateCandidateInput } from '../matching/duplicates';
import { getMatchingConfig } from './org';
import { suggestCategory } from './categorize';
import { recordAudit } from '../audit';
import { matchReceipts } from './matching';
import type { AuthContext } from '../auth/session';
import type { ExtractedFields, FieldConfidence } from '../ai/types';

/**
 * The upload pipeline.
 *
 * Order matters and is deliberate: the document is stored and the row committed *before*
 * extraction runs, so a provider failure can never lose a user's file. Extraction,
 * duplicate detection and matching then update the row in place, each one moving the
 * receipt through the status states the UI renders.
 */

export interface IngestResult {
  receiptId: string;
  status: string;
  duplicateOf: string | null;
  overallConfidence: number;
  matchedTransactionId: string | null;
  matchScore: number | null;
}

export async function ingestReceipt(auth: AuthContext, file: ValidatedUpload): Promise<IngestResult> {
  const receiptId = newId('rcp');
  const storageKey = await putDocument(auth.organizationId, file);

  await db.insert(receipts).values({
    id: receiptId,
    organizationId: auth.organizationId,
    storageKey,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    checksum: file.checksum,
    status: 'processing',
  });

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    actorLabel: auth.name ?? auth.email,
    action: 'receipt.uploaded',
    entityType: 'receipt',
    entityId: receiptId,
    detail: file.originalName,
  });

  // --- Extraction -------------------------------------------------------------
  let fields: ExtractedFields;
  let confidence: FieldConfidence;
  let overallConfidence = 0;
  let provider = 'local';

  try {
    await db.update(receipts).set({ status: 'extracting', updatedAt: new Date() }).where(eq(receipts.id, receiptId));
    const result = await extractReceipt({ bytes: file.bytes, mimeType: file.mimeType, originalName: file.originalName });
    fields = result.fields;
    confidence = result.confidence;
    overallConfidence = result.overallConfidence;
    provider = result.provider;
  } catch {
    await db
      .update(receipts)
      .set({ status: 'failed', failureCode: 'extraction_failed', updatedAt: new Date() })
      .where(eq(receipts.id, receiptId));
    return { receiptId, status: 'failed', duplicateOf: null, overallConfidence: 0, matchedTransactionId: null, matchScore: null };
  }

  const merchantNorm = fields.merchant ? normalizeMerchant(fields.merchant) : null;
  const merchantId = merchantNorm ? await upsertMerchant(auth.organizationId, fields.merchant!, merchantNorm) : null;

  await db.insert(receiptExtractions).values({
    id: newId('ext'),
    receiptId,
    merchantRaw: fields.merchant,
    merchantNorm,
    merchantId,
    date: fields.date ? new Date(`${fields.date}T00:00:00.000Z`) : null,
    total: fields.total,
    subtotal: fields.subtotal,
    tax: fields.tax,
    currency: fields.currency,
    invoiceNumber: fields.invoiceNumber,
    paymentMethod: fields.paymentMethod,
    items: fields.items.length ? JSON.stringify(fields.items) : null,
    fieldConfidence: JSON.stringify(confidence),
    overallConfidence,
    provider,
  });

  await recordAudit({
    organizationId: auth.organizationId,
    action: 'receipt.extracted',
    entityType: 'receipt',
    entityId: receiptId,
    detail: `via ${provider}, confidence ${Math.round(overallConfidence * 100)}%`,
  });

  // Category suggestion — a starting point the user can override at any time.
  const suggested = suggestCategory(merchantNorm, fields.merchant);
  if (suggested) {
    const cat = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.organizationId, auth.organizationId), eq(categories.name, suggested)))
      .limit(1);
    if (cat[0]) await db.update(receipts).set({ categoryId: cat[0].id }).where(eq(receipts.id, receiptId));
  }

  // --- Duplicate detection ----------------------------------------------------
  const duplicate = await checkDuplicate(auth.organizationId, receiptId);
  if (duplicate) {
    await db
      .update(receipts)
      .set({ isDuplicate: true, duplicateOfId: duplicate.duplicateOfId, status: 'needs_review', updatedAt: new Date() })
      .where(eq(receipts.id, receiptId));
    await recordAudit({
      organizationId: auth.organizationId,
      action: 'receipt.duplicate_flagged',
      entityType: 'receipt',
      entityId: receiptId,
      detail: duplicate.reason,
    });
    return {
      receiptId,
      status: 'needs_review',
      duplicateOf: duplicate.duplicateOfId,
      overallConfidence,
      matchedTransactionId: null,
      matchScore: null,
    };
  }

  // --- Matching ---------------------------------------------------------------
  await db.update(receipts).set({ status: 'matching', updatedAt: new Date() }).where(eq(receipts.id, receiptId));
  const matchOutcome = await matchReceipts(auth, [receiptId]);
  const mine = matchOutcome.results.find((r) => r.receiptId === receiptId);

  const finalStatus = mine?.status ?? (overallConfidence < 0.6 ? 'needs_review' : 'completed');
  await db.update(receipts).set({ status: finalStatus, updatedAt: new Date() }).where(eq(receipts.id, receiptId));

  return {
    receiptId,
    status: finalStatus,
    duplicateOf: null,
    overallConfidence,
    matchedTransactionId: mine?.transactionId ?? null,
    matchScore: mine?.score ?? null,
  };
}

async function upsertMerchant(organizationId: string, name: string, normalized: string): Promise<string> {
  const existing = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(and(eq(merchants.organizationId, organizationId), eq(merchants.normalized, normalized)))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const id = newId('mch');
  await db.insert(merchants).values({ id, organizationId, name, normalized });
  return id;
}

/** Compare one receipt against the org's existing receipts. */
export async function checkDuplicate(organizationId: string, receiptId: string) {
  const cfg = await getMatchingConfig(organizationId);

  const rows = await db
    .select({
      id: receipts.id,
      checksum: receipts.checksum,
      createdAt: receipts.createdAt,
      isDuplicate: receipts.isDuplicate,
      merchantNorm: receiptExtractions.merchantNorm,
      date: receiptExtractions.date,
      total: receiptExtractions.total,
      invoiceNumber: receiptExtractions.invoiceNumber,
    })
    .from(receipts)
    .leftJoin(receiptExtractions, eq(receiptExtractions.receiptId, receipts.id))
    .where(eq(receipts.organizationId, organizationId));

  const toInput = (r: (typeof rows)[number]): DuplicateCandidateInput => ({
    id: r.id,
    checksum: r.checksum,
    merchantNorm: r.merchantNorm,
    date: r.date,
    total: r.total,
    invoiceNumber: r.invoiceNumber,
    createdAt: r.createdAt,
  });

  const candidate = rows.find((r) => r.id === receiptId);
  if (!candidate) return null;

  // Already-flagged duplicates are not themselves candidates to duplicate against.
  const others = rows.filter((r) => r.id !== receiptId && !r.isDuplicate).map(toInput);
  return findDuplicate(toInput(candidate), others, cfg);
}

export interface ReceiptFilters {
  status?: string;
  categoryId?: string;
  search?: string;
  sort?: 'newest' | 'oldest' | 'amount_desc' | 'amount_asc' | 'confidence_asc';
  page?: number;
  pageSize?: number;
}

/**
 * Paginated, filtered receipt list.
 * Always ordered and limited at the database — the browser never receives the full library.
 */
export async function listReceipts(organizationId: string, filters: ReceiptFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));

  const conditions = [eq(receipts.organizationId, organizationId)];
  if (filters.status === 'duplicates') conditions.push(eq(receipts.isDuplicate, true));
  else if (filters.status) conditions.push(eq(receipts.status, filters.status));
  if (filters.categoryId) conditions.push(eq(receipts.categoryId, filters.categoryId));

  if (filters.search) {
    const term = `%${filters.search.toLowerCase()}%`;
    conditions.push(
      sql`(lower(${receiptExtractions.merchantRaw}) like ${term}
        or lower(${receiptExtractions.invoiceNumber}) like ${term}
        or lower(${receipts.originalName}) like ${term}
        or cast(${receiptExtractions.total} as text) like ${term})`,
    );
  }

  const order = {
    newest: desc(receipts.createdAt),
    oldest: receipts.createdAt,
    amount_desc: desc(receiptExtractions.total),
    amount_asc: receiptExtractions.total,
    confidence_asc: receiptExtractions.overallConfidence,
  }[filters.sort ?? 'newest'];

  const base = db
    .select({
      id: receipts.id,
      status: receipts.status,
      originalName: receipts.originalName,
      mimeType: receipts.mimeType,
      createdAt: receipts.createdAt,
      isDuplicate: receipts.isDuplicate,
      duplicateOfId: receipts.duplicateOfId,
      categoryId: receipts.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      merchantRaw: receiptExtractions.merchantRaw,
      merchantNorm: receiptExtractions.merchantNorm,
      date: receiptExtractions.date,
      total: receiptExtractions.total,
      currency: receiptExtractions.currency,
      invoiceNumber: receiptExtractions.invoiceNumber,
      overallConfidence: receiptExtractions.overallConfidence,
      // Derived here rather than inferred from receipt.status: "processed" and "matched"
      // are different facts, and the list column is about the latter.
      matchStatus: sql<string | null>`(
        select m.status from matches m
        where m.receipt_id = ${receipts.id} and m.status != 'rejected'
        order by case m.status when 'confirmed' then 0 when 'auto' then 1 else 2 end
        limit 1
      )`,
    })
    .from(receipts)
    .leftJoin(receiptExtractions, eq(receiptExtractions.receiptId, receipts.id))
    .leftJoin(categories, eq(categories.id, receipts.categoryId))
    .where(and(...conditions));

  const rows = await base.orderBy(order).limit(pageSize).offset((page - 1) * pageSize);

  const countRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(receipts)
    .leftJoin(receiptExtractions, eq(receiptExtractions.receiptId, receipts.id))
    .where(and(...conditions));

  return { rows, total: Number(countRows[0]?.count ?? 0), page, pageSize };
}

export async function getReceipt(organizationId: string, receiptId: string) {
  const rows = await db
    .select({
      receipt: receipts,
      extraction: receiptExtractions,
      categoryName: categories.name,
      categoryColor: categories.color,
    })
    .from(receipts)
    .leftJoin(receiptExtractions, eq(receiptExtractions.receiptId, receipts.id))
    .leftJoin(categories, eq(categories.id, receipts.categoryId))
    // Tenant scoping is part of the lookup, not a check afterwards.
    .where(and(eq(receipts.id, receiptId), eq(receipts.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteReceipts(auth: AuthContext, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const owned = await db
    .select({ id: receipts.id })
    .from(receipts)
    .where(and(eq(receipts.organizationId, auth.organizationId), inArray(receipts.id, ids)));
  const ownedIds = owned.map((r) => r.id);
  if (!ownedIds.length) return 0;

  await db.delete(receipts).where(and(eq(receipts.organizationId, auth.organizationId), inArray(receipts.id, ownedIds)));
  for (const id of ownedIds) {
    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorLabel: auth.name ?? auth.email,
      action: 'receipt.deleted',
      entityType: 'receipt',
      entityId: id,
    });
  }
  return ownedIds.length;
}
