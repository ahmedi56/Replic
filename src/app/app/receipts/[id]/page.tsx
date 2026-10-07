import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAuth } from '@/lib/auth/session';
import { getReceipt } from '@/lib/services/receipts';
import { getAuditTrailFor } from '@/lib/services/stats';
import { listCategories } from '@/lib/services/org';
import { listMatchesForReceipt } from '@/lib/services/matching';
import { ReceiptDetail } from './detail';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return { title: 'Receipt' };
  const row = await getReceipt(auth.organizationId, (await params).id);
  return { title: row?.extraction?.merchantRaw ?? row?.receipt.originalName ?? 'Receipt' };
}

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) redirect('/login');

  const { id } = await params;
  const row = await getReceipt(auth.organizationId, id);
  if (!row) notFound();

  const [audit, categories, linked] = await Promise.all([
    getAuditTrailFor(auth.organizationId, 'receipt', id),
    listCategories(auth.organizationId),
    listMatchesForReceipt(auth.organizationId, id),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/app/receipts" className="mb-4 inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
        ← All receipts
      </Link>
      <ReceiptDetail
        receipt={{
          id: row.receipt.id,
          originalName: row.receipt.originalName,
          mimeType: row.receipt.mimeType,
          sizeBytes: row.receipt.sizeBytes,
          status: row.receipt.status,
          isDuplicate: row.receipt.isDuplicate,
          duplicateOfId: row.receipt.duplicateOfId,
          categoryId: row.receipt.categoryId,
          createdAt: row.receipt.createdAt.toISOString(),
        }}
        extraction={
          row.extraction
            ? {
                merchantRaw: row.extraction.merchantRaw,
                date: row.extraction.date ? row.extraction.date.toISOString().slice(0, 10) : null,
                total: row.extraction.total,
                subtotal: row.extraction.subtotal,
                tax: row.extraction.tax,
                currency: row.extraction.currency,
                invoiceNumber: row.extraction.invoiceNumber,
                paymentMethod: row.extraction.paymentMethod,
                items: row.extraction.items,
                fieldConfidence: row.extraction.fieldConfidence,
                overallConfidence: row.extraction.overallConfidence,
                provider: row.extraction.provider,
                editedByUser: row.extraction.editedByUser,
              }
            : null
        }
        categories={categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
        matches={linked.map((m) => ({
          matchId: m.matchId,
          status: m.status,
          score: m.score,
          method: m.method,
          breakdown: m.parsedBreakdown,
          transactionId: m.transactionId,
          descriptionRaw: m.descriptionRaw,
          transactionDate: m.transactionDate.toISOString(),
          amount: m.amount,
          currency: m.transactionCurrency,
        }))}
        audit={audit.map((a) => ({
          id: a.id,
          action: a.action,
          actorLabel: a.actorLabel,
          detail: a.detail,
          createdAt: a.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
