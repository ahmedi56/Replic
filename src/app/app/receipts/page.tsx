import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAuth } from '@/lib/auth/session';
import { listReceipts } from '@/lib/services/receipts';
import { listCategories } from '@/lib/services/org';
import { Card, ConfidenceBadge, EmptyState, StatusBadge } from '@/components/ui';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { getLocale, makeT } from '@/lib/i18n/server';
import { SearchBar, FilterSelect } from '../_components/search-bar';
import { ServerPagination } from '../_components/server-pagination';
import { ExportMenu } from '../_components/export-menu';

export async function generateMetadata() {
  return { title: makeT(await getLocale())('nav.receipts') };
}
export const dynamic = 'force-dynamic';

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string; sort?: string; category?: string }>;
}) {
  const auth = await getAuth();
  if (!auth) redirect('/login');
  const locale = await getLocale();
  const t = makeT(locale);

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
          <h1 className="text-xl font-semibold tracking-tight">{t('nav.receipts')}</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            {result.total === 1 ? t('rc.countOne') : t('rc.countMany', { n: formatNumber(result.total, locale) })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportMenu />
          <Link href="/app/upload" className="btn btn-accent">
            {t('rc.upload')}
          </Link>
        </div>
      </div>

      <SearchBar placeholder={t('rc.search')}>
        <FilterSelect
          name="status"
          label={t('flt.status')}
          options={[
            { value: '', label: t('flt.allStatuses') },
            { value: 'completed', label: t('nav.matched') },
            { value: 'needs_review', label: t('nav.review') },
            { value: 'failed', label: t('status.failed') },
            { value: 'duplicates', label: t('flt.duplicates') },
          ]}
        />
        <FilterSelect
          name="category"
          label={t('flt.category')}
          options={[{ value: '', label: t('flt.allCategories') }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
        />
        <FilterSelect
          name="sort"
          label={t('flt.sort')}
          options={[
            { value: 'newest', label: t('sort.newest') },
            { value: 'oldest', label: t('sort.oldest') },
            { value: 'amount_desc', label: t('sort.amountDesc') },
            { value: 'amount_asc', label: t('sort.amountAsc') },
            { value: 'confidence_asc', label: t('sort.confAsc') },
          ]}
        />
      </SearchBar>

      <Card className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState
            title={filtered ? t('rc.emptyFiltered') : t('rc.empty')}
            description={
              filtered
                ? t('rc.emptyFilteredBody')
                : t('rc.emptyBody')
            }
            action={
              filtered ? (
                <Link href="/app/receipts" className="btn btn-ghost">
                  {t('rc.clearFilters')}
                </Link>
              ) : (
                <Link href="/app/upload" className="btn btn-accent">
                  {t('nav.upload')}
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
                    <th className="table-head">{t('col.merchant')}</th>
                    <th className="table-head">{t('col.date')}</th>
                    <th className="table-head text-right">{t('col.amount')}</th>
                    <th className="table-head">{t('col.category')}</th>
                    <th className="table-head">{t('col.status')}</th>
                    <th className="table-head text-right">{t('col.extraction')}</th>
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
                        {formatDate(row.date, locale)}
                      </td>
                      <td className="table-cell num whitespace-nowrap text-right font-medium">
                        {formatMoney(row.total, row.currency ?? 'EUR', { locale })}
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
