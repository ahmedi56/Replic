import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { getDashboardStats, getRecentActivity, getCategoryBreakdown } from '@/lib/services/stats';
import { Card, EmptyState } from '@/components/ui';
import { formatMoney, formatRelative } from '@/lib/format';
import { RematchButton } from './_components/rematch-button';

export const metadata = { title: 'Dashboard' };
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

function activityLabel(action: string): string {
  const base: Record<string, string> = {
    'match.auto': 'Receipt automatically matched',
    'match.confirmed': 'Match confirmed',
    'match.manual': 'Receipt manually matched',
    'match.suggested': 'Match suggested for review',
    'match.rejected': 'Match rejected',
    'match.unlinked': 'Match removed',
    'receipt.uploaded': 'Receipt uploaded',
    'receipt.extracted': 'Receipt processed',
    'receipt.edited': 'Receipt edited',
    'receipt.deleted': 'Receipt deleted',
    'receipt.duplicate_flagged': 'Possible duplicate detected',
    'receipt.duplicate_cleared': 'Duplicate flag removed',
    'import.created': 'Transactions imported',
    'import.blocked_duplicate': 'Duplicate import blocked',
    'export.generated': 'Export generated',
    'demo.loaded': 'Demo data loaded',
    'demo.cleared': 'Workspace cleared',
  };
  return base[action] ?? action;
}

export default async function DashboardPage() {
  const auth = await getAuth();
  if (!auth) redirect('/login');

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
            title="Nothing to reconcile yet"
            description="Upload some receipts and import a bank statement, and Reclip will match them for you. Or load the demo dataset to see how it works first."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/app/upload" className="btn btn-accent">
                  Upload receipts
                </Link>
                <Link href="/app/import" className="btn btn-ghost">
                  Import bank CSV
                </Link>
                <Link href="/app/welcome" className="btn btn-ghost">
                  Try the demo
                </Link>
              </div>
            }
          />
        </Card>
      </div>
    );
  }

  const tiles = [
    { label: 'Receipts', value: stats.receipts, href: '/app/receipts' },
    { label: 'Transactions', value: stats.transactions, href: '/app/transactions' },
    { label: 'Matched', value: stats.matched, href: '/app/matches', tone: 'var(--accent)' },
    { label: 'Needs review', value: stats.needsReview, href: '/app/review', tone: stats.needsReview > 0 ? 'var(--warn)' : undefined },
    { label: 'Unmatched', value: stats.unmatchedReceipts + stats.unmatchedTransactions, href: '/app/unmatched' },
  ];

  const maxCategory = Math.max(...breakdown.map((b) => Number(b.total) || 0), 1);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--text-muted)' }}>
            {auth.organizationName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RematchButton />
          <Link href="/app/upload" className="btn btn-accent">
            Upload receipts
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
              {tile.value.toLocaleString('en-GB')}
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
                Reconciliation rate
              </h2>
              <p className="num mt-2 text-4xl font-semibold tracking-tight">{stats.reconciliationRate}%</p>
              <p className="mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
                <span className="num">{stats.matched.toLocaleString('en-GB')}</span> of{' '}
                <span className="num">{stats.receipts.toLocaleString('en-GB')}</span> receipts settled
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Matched value
              </p>
              <p className="num mt-1 text-lg font-semibold">{formatMoney(stats.totalMatchedValue, stats.currency)}</p>
            </div>
          </div>

          <div className="mt-5 h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--text-subtle) 18%, transparent)' }}>
            <div className="h-full rounded-full" style={{ width: `${stats.reconciliationRate}%`, background: 'var(--accent)' }} />
          </div>

          {(stats.needsReview > 0 || stats.duplicates > 0) && (
            <div className="mt-5 flex flex-wrap gap-2">
              {stats.needsReview > 0 && (
                <Link href="/app/review" className="btn btn-ghost text-xs">
                  Review {stats.needsReview} match{stats.needsReview === 1 ? '' : 'es'}
                </Link>
              )}
              {stats.duplicates > 0 && (
                <Link href="/app/receipts?status=duplicates" className="btn btn-ghost text-xs">
                  {stats.duplicates} possible duplicate{stats.duplicates === 1 ? '' : 's'}
                </Link>
              )}
            </div>
          )}
        </Card>

        {/* Unmatched split — the distinction that matters */}
        <Card className="p-5">
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
            Still open
          </h2>
          <dl className="mt-4 grid gap-4">
            <div>
              <dt className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                Receipts with no transaction
              </dt>
              <dd className="num mt-1 text-2xl font-semibold tracking-tight">{stats.unmatchedReceipts}</dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                Transactions with no receipt
              </dt>
              <dd className="num mt-1 text-2xl font-semibold tracking-tight">{stats.unmatchedTransactions}</dd>
            </div>
          </dl>
          <Link href="/app/unmatched" className="btn btn-ghost mt-5 w-full text-xs">
            Open unmatched
          </Link>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent activity */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b px-5 py-3.5">
            <h2 className="text-sm font-semibold">Recent activity</h2>
          </div>
          {activity.length === 0 ? (
            <EmptyState title="No activity yet" description="Actions on your receipts and matches will appear here." />
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
                      <p className="truncate text-sm">{activityLabel(item.action)}</p>
                      {item.detail && (
                        <p className="truncate text-xs" style={{ color: 'var(--text-subtle)' }}>
                          {item.detail}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs" style={{ color: 'var(--text-subtle)' }}>
                      {formatRelative(item.createdAt)}
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
            <h2 className="text-sm font-semibold">Spend by category</h2>
          </div>
          {breakdown.length === 0 ? (
            <EmptyState title="Nothing categorised yet" description="Categories are suggested during extraction and you can change any of them." />
          ) : (
            <ul className="grid gap-3 px-5 py-4">
              {breakdown.map((row) => (
                <li key={row.name}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{row.name}</span>
                    <span className="num shrink-0 font-medium">{formatMoney(Number(row.total), stats.currency)}</span>
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
