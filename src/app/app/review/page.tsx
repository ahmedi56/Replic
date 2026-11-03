import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAuth } from '@/lib/auth/session';
import { listMatches } from '@/lib/services/matching';
import { Card, EmptyState } from '@/components/ui';
import { ReviewQueue } from './review-queue';
import { getLocale, makeT } from '@/lib/i18n/server';

export async function generateMetadata() {
  return { title: makeT(await getLocale())('nav.review') };
}
export const dynamic = 'force-dynamic';

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const auth = await getAuth();
  if (!auth) redirect('/login');
  const t = makeT(await getLocale());

  const { page } = await searchParams;
  const result = await listMatches(auth.organizationId, { status: 'review', page: Number(page ?? 1), pageSize: 20 });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{t('nav.review')}</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('rev.sub')}
        </p>
      </div>

      {result.total === 0 ? (
        <Card>
          <EmptyState
            title={t('rev.emptyTitle')}
            description={t('rev.emptyBody')}
            action={
              <div className="flex gap-2">
                <Link href="/app/matches" className="btn btn-ghost">
                  {t('rev.seeMatched')}
                </Link>
                <Link href="/app/unmatched" className="btn btn-ghost">
                  {t('rev.seeUnmatched')}
                </Link>
              </div>
            }
          />
        </Card>
      ) : (
        <ReviewQueue initial={result.rows} total={result.total} />
      )}
    </div>
  );
}
