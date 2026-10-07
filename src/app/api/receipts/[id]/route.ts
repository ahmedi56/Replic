import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { receipts, receiptExtractions, categories } from '@/db/schema';
import { withAuth, notFound, ApiError } from '@/lib/api';
import { getReceipt, deleteReceipts, checkDuplicate } from '@/lib/services/receipts';
import { getAuditTrailFor } from '@/lib/services/stats';
import { matchReceipts } from '@/lib/services/matching';
import { normalizeMerchant } from '@/lib/matching/normalize';
import { computeOverall } from '@/lib/extraction/parse-text';
import { recordAudit } from '@/lib/audit';

const patchSchema = z.object({
  merchant: z.string().max(200).nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  total: z.number().finite().nullable().optional(),
  subtotal: z.number().finite().nullable().optional(),
  tax: z.number().finite().nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  invoiceNumber: z.string().max(60).nullable().optional(),
  paymentMethod: z.enum(['card', 'cash', 'transfer', 'direct_debit']).nullable().optional(),
  categoryId: z.string().max(60).nullable().optional(),
  isDuplicate: z.boolean().optional(),
  rematch: z.boolean().optional(),
});

export const GET = withAuth<{ id: string }>(async (auth, _req, { id }) => {
  const row = await getReceipt(auth.organizationId, id);
  if (!row) throw notFound('Receipt not found');
  const audit = await getAuditTrailFor(auth.organizationId, 'receipt', id);
  return NextResponse.json({ ...row, audit });
});

/**
 * Edit extracted fields.
 *
 * A user edit is authoritative: the edited field's confidence becomes 1 and the row is
 * marked `editedByUser`, so a later re-run never silently overwrites a human correction.
 */
export const PATCH = withAuth<{ id: string }>(async (auth, req, { id }) => {
  const body = patchSchema.parse(await req.json());
  const existing = await getReceipt(auth.organizationId, id);
  if (!existing) throw notFound('Receipt not found');

  if (body.categoryId) {
    const owned = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, body.categoryId), eq(categories.organizationId, auth.organizationId)))
      .limit(1);
    if (!owned[0]) throw new ApiError(400, 'Unknown category');
  }

  if (body.categoryId !== undefined || body.isDuplicate !== undefined) {
    await db
      .update(receipts)
      .set({
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.isDuplicate !== undefined
          ? { isDuplicate: body.isDuplicate, duplicateOfId: body.isDuplicate ? existing.receipt.duplicateOfId : null }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(receipts.id, id), eq(receipts.organizationId, auth.organizationId)));

    if (body.isDuplicate === false) {
      await recordAudit({
        organizationId: auth.organizationId,
        userId: auth.userId,
        actorLabel: auth.name ?? auth.email,
        action: 'receipt.duplicate_cleared',
        entityType: 'receipt',
        entityId: id,
      });
    }
  }

  const fieldKeys = ['merchant', 'date', 'total', 'subtotal', 'tax', 'currency', 'invoiceNumber', 'paymentMethod'] as const;
  const touched = fieldKeys.filter((k) => body[k] !== undefined);

  if (touched.length) {
    if (!existing.extraction) throw new ApiError(409, 'This receipt has no extraction to edit yet');

    const confidence: Record<string, number> = existing.extraction.fieldConfidence
      ? JSON.parse(existing.extraction.fieldConfidence)
      : {};
    for (const key of touched) confidence[key] = 1; // a human read it

    const merchantNorm = body.merchant !== undefined ? (body.merchant ? normalizeMerchant(body.merchant) : null) : existing.extraction.merchantNorm;

    const nextFields = {
      merchant: body.merchant !== undefined ? body.merchant : existing.extraction.merchantRaw,
      date: body.date !== undefined ? body.date : existing.extraction.date?.toISOString().slice(0, 10) ?? null,
      total: body.total !== undefined ? body.total : existing.extraction.total,
      subtotal: body.subtotal !== undefined ? body.subtotal : existing.extraction.subtotal,
      tax: body.tax !== undefined ? body.tax : existing.extraction.tax,
      currency: body.currency !== undefined ? body.currency : existing.extraction.currency,
      invoiceNumber: body.invoiceNumber !== undefined ? body.invoiceNumber : existing.extraction.invoiceNumber,
      paymentMethod: body.paymentMethod !== undefined ? body.paymentMethod : existing.extraction.paymentMethod,
      items: [],
    };

    await db
      .update(receiptExtractions)
      .set({
        merchantRaw: nextFields.merchant,
        merchantNorm,
        date: nextFields.date ? new Date(`${nextFields.date}T00:00:00.000Z`) : null,
        total: nextFields.total,
        subtotal: nextFields.subtotal,
        tax: nextFields.tax,
        currency: nextFields.currency,
        invoiceNumber: nextFields.invoiceNumber,
        paymentMethod: nextFields.paymentMethod,
        fieldConfidence: JSON.stringify(confidence),
        overallConfidence: computeOverall(nextFields, confidence),
        editedByUser: true,
      })
      .where(eq(receiptExtractions.receiptId, id));

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorLabel: auth.name ?? auth.email,
      action: 'receipt.edited',
      entityType: 'receipt',
      entityId: id,
      detail: `edited ${touched.join(', ')}`,
    });

    // Re-check duplicates: an edit can reveal one that the original extraction missed.
    const duplicate = await checkDuplicate(auth.organizationId, id);
    if (duplicate && body.isDuplicate === undefined) {
      await db
        .update(receipts)
        .set({ isDuplicate: true, duplicateOfId: duplicate.duplicateOfId })
        .where(and(eq(receipts.id, id), eq(receipts.organizationId, auth.organizationId)));
    }
  }

  if (body.rematch !== false && touched.length) {
    await matchReceipts(auth, [id]);
  }

  const updated = await getReceipt(auth.organizationId, id);
  return NextResponse.json(updated);
});

export const DELETE = withAuth<{ id: string }>(async (auth, _req, { id }) => {
  const deleted = await deleteReceipts(auth, [id]);
  if (!deleted) throw notFound('Receipt not found');
  return NextResponse.json({ ok: true });
});
