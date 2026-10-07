import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAuth } from '@/lib/auth/session';
import { listTransactions, listImports } from '@/lib/services/imports';
import { Card, EmptyState } from '@/components/ui';
import { formatDate, formatMoney, formatRelative } from '@/lib/format';
import { SearchBar, FilterSelect } from '../_components/search-bar';
import { ServerPagination } from '../_components/server-pagination';

export const metadata = { title: 'Transactions' };
export const dynamic = 'force-dynamic';

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; sort?: string }>;
}) {
  const auth = await getAuth();
  if (!auth) redirect('/login');

  const sp = await searchParams;
  const [result, importHistory] = await Promise.all([
    listTransactions(auth.organizationId, { page: Number(sp.page ?? 1), search: sp.q, sort: sp.sort }),
    listImports(auth.organizationId),
  ]);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Transactions</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            <span className="num">{result.total.toLocaleString('en-GB')}</span> imported transaction
            {result.total === 1 ? '' : 's'}
          </p>
        </div>
        <Link href="/app/import" className="btn btn-accent">
          Import CSV
        </Link>
      </div>

      <SearchBar placeholder="Search description or amount…">
        <FilterSelect
          name="sort"
          label="Sort"
          options={[
            { value: 'newest', label: 'Newest' },
            { value: 'oldest', label: 'Oldest' },
            { value: 'amount_desc', label: 'Largest spend' },
            { value: 'amount_asc', label: 'Largest income' },
          ]}
        />
      </SearchBar>

      <Card className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState
            title={sp.q ? 'No transactions match' : 'No transactions yet'}
            description={sp.q ? 'Try a different search.' : 'Import a bank CSV and Reclip will normalize the descriptions and match them to your receipts.'}
            action={
              !sp.q ? (
                <Link href="/app/import" className="btn btn-accent">
                  Import bank CSV
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
                    <th className="table-head">Description</th>
                    <th className="table-head">Normalized merchant</th>
                    <th className="table-head">Date</th>
                    <th className="table-head text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {result.rows.map((row) => (
                    <tr key={row.id}>
                      {/* The original description is always shown — it's the auditable value. */}
                      <td className="table-cell max-w-[280px] truncate font-medium" title={row.descriptionRaw}>
                        {row.descriptionRaw}
                      </td>
                      <td className="table-cell" style={{ color: 'var(--text-muted)' }}>
                        {row.merchantNorm || '-'}
                      </td>
                      <td className="table-cell whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                        {formatDate(row.date)}
                      </td>
                      <td
                        className="table-cell num whitespace-nowrap text-right font-medium"
                        style={{ color: row.amount > 0 ? 'var(--accent-ink)' : undefined }}
                      >
                        {row.amount < 0 ? '−' : '+'}
                        {formatMoney(row.amount, row.currency)}
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

      {importHistory.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b px-5 py-3.5">
            <h2 className="text-sm font-semibold">Import history</h2>
          </div>
          <ul className="divide-y">
            {importHistory.map((imp) => (
              <li key={imp.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{imp.filename}</p>
                  <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                    {imp.accountName ?? 'Unassigned account'} · {formatRelative(imp.createdAt)}
                  </p>
                </div>
                <p className="num text-xs" style={{ color: 'var(--text-muted)' }}>
                  {imp.importedCount} imported
                  {imp.skippedCount > 0 && ` · ${imp.skippedCount} already present`}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
