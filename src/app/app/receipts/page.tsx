import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAuth } from '@/lib/auth/session';
import { listReceipts } from '@/lib/services/receipts';
import { listCategories } from '@/lib/services/org';
import { Card, ConfidenceBadge, EmptyState, StatusBadge } from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/format';
import { SearchBar, FilterSelect } from '../_components/search-bar';
import { ServerPagination } from '../_components/server-pagination';
import { ExportMenu } from '../_components/export-menu';

export const metadata = { title: 'Receipts' };
export const dynamic = 'force-dynamic';

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string; sort?: string; category?: string }>;
}) {
  const auth = await getAuth();
  if (!auth) redirect('/login');

  const sp = await searchParams;
  const [result, categories] = await Promise.all([
    listReceipts(auth.organizationId, {
      page: Number(sp.page ?? 1),
      search: sp.q,
      status: sp.status,
      sort: (sp.sort as never) ?? 'newest',
      categoryId: sp.category,
      pageSize: 25,
    }),
    listCategories(auth.organizationId),
  ]);

  const filtered = Boolean(sp.q || sp.status || sp.category);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Receipts</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            <span className="num">{result.total.toLocaleString('en-GB')}</span> receipt{result.total === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportMenu />
          <Link href="/app/upload" className="btn btn-accent">
            Upload
          </Link>
        </div>
      </div>

      <SearchBar placeholder="Search merchant, invoice number or amount…">
        <FilterSelect
          name="status"
          label="Status"
          options={[
            { value: '', label: 'All statuses' },
            { value: 'completed', label: 'Matched' },
            { value: 'needs_review', label: 'Needs review' },
            { value: 'failed', label: 'Failed' },
            { value: 'duplicates', label: 'Duplicates' },
          ]}
        />
        <FilterSelect
          name="category"
          label="Category"
          options={[{ value: '', label: 'All categories' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
        />
        <FilterSelect
          name="sort"
          label="Sort"
          options={[
            { value: 'newest', label: 'Newest' },
            { value: 'oldest', label: 'Oldest' },
            { value: 'amount_desc', label: 'Highest amount' },
            { value: 'amount_asc', label: 'Lowest amount' },
            { value: 'confidence_asc', label: 'Lowest confidence' },
          ]}
        />
      </SearchBar>

      <Card className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState
            title={filtered ? 'No receipts match those filters' : 'No receipts yet'}
            description={
              filtered
                ? 'Try clearing a filter or searching for something else.'
                : 'Drop your receipts in and Reclip will read them and pair them with your bank transactions.'
            }
            action={
              filtered ? (
                <Link href="/app/receipts" className="btn btn-ghost">
                  Clear filters
                </Link>
              ) : (
                <Link href="/app/upload" className="btn btn-accent">
                  Upload receipts
                </Link>
              )
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="border-b" style={{ background: 'var(--surface-sunken)' }}>
                  <tr>
                    <th className="table-head">Merchant</th>
                    <th className="table-head">Date</th>
                    <th className="table-head text-right">Amount</th>
                    <th className="table-head">Category</th>
                    <th className="table-head">Status</th>
                    <th className="table-head text-right">Extraction</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {result.rows.map((row) => (
                    <tr key={row.id} className="transition-colors hover:bg-[color-mix(in_srgb,var(--text-subtle)_6%,transparent)]">
                      <td className="table-cell">
                        <Link href={`/app/receipts/${row.id}`} className="font-medium hover:underline">
                          {row.merchantRaw ?? row.originalName}
                        </Link>
                        {row.invoiceNumber && (
                          <span className="num ml-2 text-xs" style={{ color: 'var(--text-subtle)' }}>
                            {row.invoiceNumber}
                          </span>
                        )}
                      </td>
                      <td className="table-cell whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                        {formatDate(row.date)}
                      </td>
                      <td className="table-cell num whitespace-nowrap text-right font-medium">
                        {formatMoney(row.total, row.currency ?? 'EUR')}
                      </td>
                      <td className="table-cell">
                        {row.categoryName ? (
                          <span className="chip" style={{ background: `color-mix(in srgb, ${row.categoryColor} 15%, transparent)`, color: row.categoryColor ?? undefined }}>
                            {row.categoryName}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-subtle)' }}>-</span>
                        )}
                      </td>
                      <td className="table-cell">
                        <StatusBadge
                          status={row.status === 'failed' ? 'failed' : (row.matchStatus ?? 'unmatched')}
                          isDuplicate={row.isDuplicate}
                        />
                      </td>
                      <td className="table-cell text-right">
                        <ConfidenceBadge value={row.overallConfidence} />
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
