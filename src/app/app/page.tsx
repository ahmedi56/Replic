import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { getDashboardStats, getRecentActivity, getCategoryBreakdown } from '@/lib/services/stats';
import { Card, EmptyState } from '@/components/ui';
import { formatMoney, formatNumber, formatRelative } from '@/lib/format';
import { getLocale, makeT } from '@/lib/i18n/server';
import type { MessageKey } from '@/lib/i18n/messages';
import { RematchButton } from './_components/rematch-button';

export async function generateMetadata() {
  return { title: makeT(await getLocale())('nav.dashboard') };
}
export const dynamic = 'force-dynamic';

const ACTIVITY_COPY: Record<string, { icon: string; tone: string }> = {
  'match.auto': { icon: '✓', tone: 'var(--accent)' },
  'match.confirmed': { icon: '✓', tone: 'var(--accent)' },
  'match.manual': { icon: '✓', tone: 'var(--accent)' },
  'match.suggested': { icon: '⚠', tone: 'var(--warn)' },
  'match.rejected': { icon: '×', tone: 'var(--text-subtle)' },
  'match.unlinked': { icon: '×', tone: 'var(--text-subtle)' },
  'receipt.uploaded': { icon: '↑', tone: 'var(--text-muted)' },
  'receipt.extracted': { icon: '✓', tone: 'var(--text-muted)' },
  'receipt.edited': { icon: '✎', tone: 'var(--text-muted)' },
  'receipt.deleted': { icon: '×', tone: 'var(--danger)' },
  'receipt.duplicate_flagged': { icon: '⚠', tone: 'var(--warn)' },
  'import.created': { icon: '↓', tone: 'var(--text-muted)' },
  'export.generated': { icon: '↓', tone: 'var(--text-muted)' },
  'demo.loaded': { icon: '★', tone: 'var(--accent)' },
};

const ACTIVITY_ACTIONS = new Set([
  'match.auto', 'match.confirmed', 'match.manual', 'match.suggested', 'match.rejected', 'match.unlinked',
  'receipt.uploaded', 'receipt.extracted', 'receipt.edited', 'receipt.deleted', 'receipt.duplicate_flagged',
  'receipt.duplicate_cleared', 'import.created', 'import.blocked_duplicate', 'export.generated',
  'demo.loaded', 'demo.cleared', 'plan.changed',
]);

export default async function DashboardPage() {
  const auth = await getAuth();
  if (!auth) redirect('/login');
  const locale = await getLocale();
  const t = makeT(locale);
  const num = (n: number) => formatNumber(n, locale);

  const [stats, activity, breakdown] = await Promise.all([
    getDashboardStats(auth.organizationId),
    getRecentActivity(auth.organizationId, 10),
    getCategoryBreakdown(auth.organizationId),
  ]);

  const isEmpty = stats.receipts === 0 && stats.transactions === 0;

  if (isEmpty) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <EmptyState
            title={t('dash.emptyTitle')}
            description={t('dash.emptyBody')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/app/upload" className="btn btn-accent">
                  {t('nav.upload')}
                </Link>
                <Link href="/app/import" className="btn btn-ghost">
                  {t('nav.import')}
                </Link>
                <Link href="/app/welcome" className="btn btn-ghost">
                  {t('dash.tryDemo')}
                </Link>
              </div>
            }
          />
        </Card>
      </div>
    );
  }

  const tiles = [
    { label: t('nav.receipts'), value: stats.receipts, href: '/app/receipts' },
    { label: t('nav.transactions'), value: stats.transactions, href: '/app/transactions' },
    { label: t('nav.matched'), value: stats.matched, href: '/app/matches', tone: 'var(--accent)' },
    { label: t('nav.review'), value: stats.needsReview, href: '/app/review', tone: stats.needsReview > 0 ? 'var(--warn)' : undefined },
    { label: t('nav.unmatched'), value: stats.unmatchedReceipts + stats.unmatchedTransactions, href: '/app/unmatched' },
  ];

  const maxCategory = Math.max(...breakdown.map((b) => Number(b.total) || 0), 1);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('dash.title')}</h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--text-muted)' }}>
            {auth.organizationName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RematchButton />
          <Link href="/app/upload" className="btn btn-accent">
            {t('nav.upload')}
          </Link>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className="card p-4 transition-shadow hover:shadow-pop">
            <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              {tile.label}
            </p>
            <p className="num mt-2 text-2xl font-semibold tracking-tight" style={{ color: tile.tone }}>
              {num(tile.value)}
            </p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Reconciliation rate */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                {t('dash.rate')}
              </h2>
              <p className="num mt-2 text-4xl font-semibold tracking-tight">{stats.reconciliationRate}%</p>
              <p className="mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
                {t('dash.settled', { matched: num(stats.matched), receipts: num(stats.receipts) })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('dash.matchedValue')}
              </p>
              <p className="num mt-1 text-lg font-semibold">{formatMoney(stats.totalMatchedValue, stats.currency, { locale })}</p>
            </div>
          </div>

          <div className="mt-5 h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--text-subtle) 18%, transparent)' }}>
            <div className="h-full rounded-full" style={{ width: `${stats.reconciliationRate}%`, background: 'var(--accent)' }} />
          </div>

          {(stats.needsReview > 0 || stats.duplicates > 0) && (
            <div className="mt-5 flex flex-wrap gap-2">
              {stats.needsReview > 0 && (
                <Link href="/app/review" className="btn btn-ghost text-xs">
                  {stats.needsReview === 1 ? t('dash.reviewOne') : t('dash.reviewMany', { n: stats.needsReview })}
                </Link>
              )}
              {stats.duplicates > 0 && (
                <Link href="/app/receipts?status=duplicates" className="btn btn-ghost text-xs">
                  {stats.duplicates === 1 ? t('dash.dupOne') : t('dash.dupMany', { n: stats.duplicates })}
                </Link>
              )}
            </div>
          )}
        </Card>

        {/* Unmatched split — the distinction that matters */}
        <Card className="p-5">
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
            {t('dash.stillOpen')}
          </h2>
          <dl className="mt-4 grid gap-4">
            <div>
              <dt className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                {t('dash.receiptsNoTx')}
              </dt>
              <dd className="num mt-1 text-2xl font-semibold tracking-tight">{stats.unmatchedReceipts}</dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                {t('dash.txNoReceipt')}
              </dt>
              <dd className="num mt-1 text-2xl font-semibold tracking-tight">{stats.unmatchedTransactions}</dd>
            </div>
          </dl>
          <Link href="/app/unmatched" className="btn btn-ghost mt-5 w-full text-xs">
            {t('dash.openUnmatched')}
          </Link>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent activity */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b px-5 py-3.5">
            <h2 className="text-sm font-semibold">{t('dash.recent')}</h2>
          </div>
          {activity.length === 0 ? (
            <EmptyState title={t('dash.noActivity')} description={t('dash.noActivityBody')} />
          ) : (
            <ul className="divide-y">
              {activity.map((item) => {
                const style = ACTIVITY_COPY[item.action] ?? { icon: '·', tone: 'var(--text-muted)' };
                return (
                  <li key={item.id} className="flex items-start gap-3 px-5 py-3">
                    <span className="mt-0.5 text-sm font-semibold" style={{ color: style.tone }} aria-hidden="true">
                      {style.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{ACTIVITY_ACTIONS.has(item.action) ? t(`act.${item.action}` as MessageKey) : item.action}</p>
                      {item.detail && (
                        <p className="truncate text-xs" style={{ color: 'var(--text-subtle)' }}>
                          {item.detail}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs" style={{ color: 'var(--text-subtle)' }}>
                      {formatRelative(item.createdAt, locale)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Category breakdown */}
        <Card className="overflow-hidden">
          <div className="border-b px-5 py-3.5">
            <h2 className="text-sm font-semibold">{t('dash.spend')}</h2>
          </div>
          {breakdown.length === 0 ? (
            <EmptyState title={t('dash.noCategories')} description={t('dash.noCategoriesBody')} />
          ) : (
            <ul className="grid gap-3 px-5 py-4">
              {breakdown.map((row) => (
                <li key={row.name}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{row.name}</span>
                    <span className="num shrink-0 font-medium">{formatMoney(Number(row.total), stats.currency, { locale })}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--text-subtle) 14%, transparent)' }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, (Number(row.total) / maxCategory) * 100)}%`, background: row.color }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
