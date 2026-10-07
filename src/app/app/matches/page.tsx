import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAuth } from '@/lib/auth/session';
import { listMatches } from '@/lib/services/matching';
import { Card, ConfidenceBadge, EmptyState } from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/format';
import { ExportMenu } from '../_components/export-menu';
import { SearchBar } from '../_components/search-bar';
import { ServerPagination } from '../_components/server-pagination';

export const metadata = { title: 'Matched' };
export const dynamic = 'force-dynamic';

export default async function MatchesPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  const auth = await getAuth();
  if (!auth) redirect('/login');

  const { page, q } = await searchParams;
  const result = await listMatches(auth.organizationId, { status: 'matched', page: Number(page ?? 1), search: q, pageSize: 25 });

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Matched</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            <span className="num">{result.total.toLocaleString('en-GB')}</span> receipt
            {result.total === 1 ? '' : 's'} paired with a bank transaction.
          </p>
        </div>
        <ExportMenu defaultScope="matched" />
      </div>

      <SearchBar placeholder="Search merchant or bank description…" />

      <Card className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState
            title={q ? 'No matches found' : 'No matches yet'}
            description={q ? 'Try a different search term.' : 'Upload receipts and import a bank statement, and matches will appear here.'}
            action={
              !q ? (
                <Link href="/app/upload" className="btn btn-accent">
                  Upload receipts
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead className="border-b" style={{ background: 'var(--surface-sunken)' }}>
                  <tr>
                    <th className="table-head">Merchant</th>
                    <th className="table-head">Bank description</th>
                    <th className="table-head">Date</th>
                    <th className="table-head text-right">Amount</th>
                    <th className="table-head text-right">Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {result.rows.map((row) => (
                    <tr key={row.matchId} className="transition-colors hover:bg-[color-mix(in_srgb,var(--text-subtle)_6%,transparent)]">
                      <td className="table-cell">
                        <Link href={`/app/receipts/${row.receiptId}`} className="font-medium hover:underline">
                          {row.merchantRaw ?? row.receiptName}
                        </Link>
                        {row.categoryName && (
                          <span className="ml-2 text-xs" style={{ color: row.categoryColor ?? 'var(--text-subtle)' }}>
                            {row.categoryName}
                          </span>
                        )}
                      </td>
                      <td className="table-cell max-w-[240px] truncate" style={{ color: 'var(--text-muted)' }} title={row.descriptionRaw}>
                        {row.descriptionRaw}
                      </td>
                      <td className="table-cell whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                        {formatDate(row.transactionDate)}
                      </td>
                      <td className="table-cell num whitespace-nowrap text-right font-medium">
                        {formatMoney(row.amount, row.transactionCurrency)}
                      </td>
                      <td className="table-cell text-right">
                        <ConfidenceBadge value={row.score} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ServerPagination page={result.page} pageSize={result.pageSize} total={result.total} />
          </>
        )}
      </Card>
    </div>
  );
}
