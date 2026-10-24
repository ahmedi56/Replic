import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { receipts, matches } from '@/db/schema';
import { withAuth, ApiError } from '@/lib/api';

/** Statuses a receipt passes through while a worker is still handling it. */
const IN_PROGRESS = ['processing', 'extracting', 'matching'];

/**
 * Progress of recently uploaded receipts, for the upload page to poll.
 * Only this organization's receipts are ever returned; unknown or foreign ids are omitted.
 */
export const GET = withAuth(async (auth, req) => {
  const ids = (new URL(req.url).searchParams.get('ids') ?? '').split(',').filter(Boolean);
  if (ids.length === 0) return NextResponse.json({ receipts: [] });
  if (ids.length > 100) throw new ApiError(400, 'Ask for at most 100 receipts at a time');

  const rows = await db
    .select({ id: receipts.id, status: receipts.status, isDuplicate: receipts.isDuplicate, failureCode: receipts.failureCode })
    .from(receipts)
    .where(and(eq(receipts.organizationId, auth.organizationId), inArray(receipts.id, ids)));

  const finished = rows.filter((r) => !IN_PROGRESS.includes(r.status)).map((r) => r.id);
  const matched = finished.length
    ? await db
        .select({ receiptId: matches.receiptId })
        .from(matches)
        .where(and(eq(matches.organizationId, auth.organizationId), inArray(matches.receiptId, finished), inArray(matches.status, ['auto', 'confirmed'])))
    : [];
  const matchedIds = new Set(matched.map((m) => m.receiptId));

  return NextResponse.json({
    receipts: rows.map((r) => ({
      id: r.id,
      done: !IN_PROGRESS.includes(r.status),
      status: r.status,
      failed: r.status === 'failed',
      duplicate: r.isDuplicate,
      matched: matchedIds.has(r.id),
    })),
  });
});
