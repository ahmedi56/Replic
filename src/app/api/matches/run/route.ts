import { NextResponse } from 'next/server';
import { withAuth, rateLimit } from '@/lib/api';
import { matchReceipts } from '@/lib/services/matching';

export const maxDuration = 60;

/** Re-run matching across the whole organization. */
export const POST = withAuth(async (auth) => {
  rateLimit(`rematch:${auth.organizationId}`, 6, 60_000);
  const result = await matchReceipts(auth);
  return NextResponse.json(result.stats);
});
