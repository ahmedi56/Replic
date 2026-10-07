import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAuth } from '@/lib/auth/session';
import { listUnmatchedReceipts, listUnmatchedTransactions } from '@/lib/services/matching';
import { Card, ConfidenceBadge, EmptyState } from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/format';
import { ExportMenu } from '../_components/export-menu';
import { RematchButton } from '../_components/rematch-button';

export const metadata = { title: 'Unmatched' };
export const dynamic = 'force-dynamic';

/**
 * Two lists, deliberately side by side.
 *
 * A receipt with no transaction and a transaction with no receipt are different problems:
 * the first usually means a personal payment or a missing import, the second means missing
 * paperwork. Collapsing them into one "unmatched" pile loses that.
 */
export default async function UnmatchedPage({ searchParams }: { searchParams: Promise<{ rp?: string; tp?: string }> }) {
  const auth = await getAuth();
  if (!auth) redirect('/login');

  const sp = await searchParams;
  const [receiptSide, transactionSide] = await Promise.all([
    listUnmatchedReceipts(auth.organizationId, { page: Number(sp.rp ?? 1), pageSize: 15 }),
    listUnmatchedTransactions(auth.organizationId, { page: Number(sp.tp ?? 1), pageSize: 15 }),
  ]);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Unmatched</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            What&apos;s left after matching, and which side of the ledger it&apos;s missing from.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RematchButton />
          <ExportMenu defaultScope="unmatched" />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {/* Receipts with no transaction */}
        <Card className="overflow-hidden">
          <div className="border-b px-5 py-3.5">
            <h2 className="text-sm font-semibold">Receipts with no transaction</h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span className="num">{receiptSide.total}</span> · often cash, a personal card, or a statement you
              haven&apos;t imported yet
            </p>
          </div>
          {receiptSide.rows.length === 0 ? (
            <EmptyState title="Nothing here" description="Every receipt has been paired with a transaction." />
          ) : (
            <ul className="divide-y">
              {receiptSide.rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link href={`/app/receipts/${row.id}`} className="block truncate text-sm font-medium hover:underline">
                      {row.merchantRaw ?? row.originalName}
                    </Link>
                    <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                      {formatDate(row.date)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <ConfidenceBadge value={row.overallConfidence} />
                    <span className="num text-sm font-medium">{formatMoney(row.total, row.currency ?? 'EUR')}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Transactions with no receipt */}
        <Card className="overflow-hidden">
          <div className="border-b px-5 py-3.5">
            <h2 className="text-sm font-semibold">Transactions with no receipt</h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span className="num">{transactionSide.total}</span> · missing paperwork, fees, or transfers
            </p>
          </div>
          {transactionSide.rows.length === 0 ? (
            <EmptyState title="Nothing here" description="Every transaction has a receipt against it." />
          ) : (
            <ul className="divide-y">
              {transactionSide.rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={row.descriptionRaw}>
                      {row.descriptionRaw}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                      {formatDate(row.date)}
                    </p>
                  </div>
                  <span className="num shrink-0 text-sm font-medium" style={{ color: row.amount > 0 ? 'var(--accent-ink)' : undefined }}>
                    {row.amount < 0 ? '−' : '+'}
                    {formatMoney(row.amount, row.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
