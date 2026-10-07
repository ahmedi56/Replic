import { NextResponse } from 'next/server';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { receipts, subscriptions } from '@/db/schema';
import { withAuth, rateLimit, clientKey, ApiError } from '@/lib/api';
import { validateUpload } from '@/lib/storage';
import { ingestReceipt, listReceipts } from '@/lib/services/receipts';

export const runtime = 'nodejs';
// Uploads run the extraction pipeline inline; give them room.
export const maxDuration = 60;

export const GET = withAuth(async (auth, req) => {
  const url = new URL(req.url);
  const result = await listReceipts(auth.organizationId, {
    status: url.searchParams.get('status') ?? undefined,
    categoryId: url.searchParams.get('category') ?? undefined,
    search: url.searchParams.get('q') ?? undefined,
    sort: (url.searchParams.get('sort') as never) ?? undefined,
    page: Number(url.searchParams.get('page') ?? 1),
    pageSize: Number(url.searchParams.get('pageSize') ?? 25),
  });
  return NextResponse.json(result);
});

/**
 * Upload one receipt. The client posts files one at a time and drives its own progress
 * bar, which keeps a 100-file drop responsive and lets a single bad file fail alone.
 */
export const POST = withAuth(async (auth, req) => {
  rateLimit(clientKey(req, 'upload'), 300, 60_000);

  // A body that isn't multipart form data is the caller's mistake, not a server fault.
  const form = await req.formData().catch(() => {
    throw new ApiError(400, 'Upload the file as multipart form data');
  });
  const file = form.get('file');
  if (!(file instanceof File)) throw new ApiError(400, 'No file was received');

  await enforceQuota(auth.organizationId);

  const bytes = Buffer.from(await file.arrayBuffer());
  const validated = validateUpload(bytes, file.name, file.type);
  const result = await ingestReceipt(auth, validated);

  return NextResponse.json(result, { status: 201 });
});

/** Monthly plan limit. Counts real receipts only — duplicates don't consume quota. */
async function enforceQuota(organizationId: string): Promise<void> {
  const sub = (await db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1))[0];
  if (!sub) return;

  const periodStart = new Date();
  periodStart.setUTCDate(1);
  periodStart.setUTCHours(0, 0, 0, 0);

  const used = Number(
    (
      await db
        .select({ count: sql<number>`count(*)` })
        .from(receipts)
        .where(
          and(
            eq(receipts.organizationId, organizationId),
            eq(receipts.isDuplicate, false),
            gte(receipts.createdAt, periodStart),
          ),
        )
    )[0]?.count ?? 0,
  );

  if (used >= sub.receiptQuota) {
    throw new ApiError(
      402,
      `You have used all ${sub.receiptQuota} receipts on the ${sub.plan} plan this month. Upgrade to add more.`,
      'quota_exceeded',
    );
  }
}
