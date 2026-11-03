import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAuth } from '@/lib/auth/session';
import { listTransactions, listImports } from '@/lib/services/imports';
import { Card, EmptyState } from '@/components/ui';
import { formatDate, formatMoney, formatNumber, formatRelative } from '@/lib/format';
import { getLocale, makeT } from '@/lib/i18n/server';
import { SearchBar, FilterSelect } from '../_components/search-bar';
import { ServerPagination } from '../_components/server-pagination';

export async function generateMetadata() {
  return { title: makeT(await getLocale())('nav.transactions') };
}
export const dynamic = 'force-dynamic';

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; sort?: string }>;
}) {
  const auth = await getAuth();
  if (!auth) redirect('/login');
  const locale = await getLocale();
  const t = makeT(locale);

  const sp = await searchParams;
  const [result, importHistory] = await Promise.all([
    listTransactions(auth.organizationId, { page: Number(sp.page ?? 1), search: sp.q, sort: sp.sort }),
    listImports(auth.organizationId),
  ]);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('nav.transactions')}</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            {result.total === 1 ? t('tx.countOne') : t('tx.countMany', { n: formatNumber(result.total, locale) })}
          </p>
        </div>
        <Link href="/app/import" className="btn btn-accent">
          {t('tx.import')}
        </Link>
      </div>

      <SearchBar placeholder={t('tx.search')}>
        <FilterSelect
          name="sort"
          label={t('flt.sort')}
          options={[
            { value: 'newest', label: t('sort.newest') },
            { value: 'oldest', label: t('sort.oldest') },
            { value: 'amount_desc', label: t('sort.spend') },
            { value: 'amount_asc', label: t('sort.income') },
          ]}
        />
      </SearchBar>

      <Card className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState
            title={sp.q ? t('tx.emptyFiltered') : t('tx.empty')}
            description={sp.q ? t('tx.tryOther') : t('tx.emptyBody')}
            action={
              !sp.q ? (
                <Link href="/app/import" className="btn btn-accent">
                  {t('nav.import')}
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
                    <th className="table-head">{t('col.description')}</th>
                    <th className="table-head">{t('col.normalized')}</th>
                    <th className="table-head">{t('col.date')}</th>
                    <th className="table-head text-right">{t('col.amount')}</th>
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
                        {formatDate(row.date, locale)}
                      </td>
                      <td
                        className="table-cell num whitespace-nowrap text-right font-medium"
                        style={{ color: row.amount > 0 ? 'var(--accent-ink)' : undefined }}
                      >
                        {row.amount < 0 ? '−' : '+'}
                        {formatMoney(row.amount, row.currency, { locale })}
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
            <h2 className="text-sm font-semibold">{t('tx.history')}</h2>
          </div>
          <ul className="divide-y">
            {importHistory.map((imp) => (
              <li key={imp.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{imp.filename}</p>
                  <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                    {imp.accountName ?? t('tx.unassigned')} · {formatRelative(imp.createdAt, locale)}
                  </p>
                </div>
                <p className="num text-xs" style={{ color: 'var(--text-muted)' }}>
                  {t('tx.imported', { n: imp.importedCount })}
                  {imp.skippedCount > 0 && ` · ${t('tx.already', { n: imp.skippedCount })}`}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
