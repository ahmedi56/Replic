import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAuth } from '@/lib/auth/session';
import { listMatches } from '@/lib/services/matching';
import { Card, EmptyState } from '@/components/ui';
import { ReviewQueue } from './review-queue';

export const metadata = { title: 'Needs review' };
export const dynamic = 'force-dynamic';

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const auth = await getAuth();
  if (!auth) redirect('/login');

  const { page } = await searchParams;
  const result = await listMatches(auth.organizationId, { status: 'review', page: Number(page ?? 1), pageSize: 20 });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Needs review</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Sorted by confidence, highest first, so the quickest decisions come first. Confirm or reject; Reclip handles
          the rest.
        </p>
      </div>

      {result.total === 0 ? (
        <Card>
          <EmptyState
            title="Nothing to review"
            description="Every match Reclip found was confident enough to settle on its own. Anything it couldn't pair at all is in Unmatched."
            action={
              <div className="flex gap-2">
                <Link href="/app/matches" className="btn btn-ghost">
                  See matched
                </Link>
                <Link href="/app/unmatched" className="btn btn-ghost">
                  See unmatched
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
