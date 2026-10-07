import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api';
import { suggestTransactionsForReceipt, createManualMatch } from '@/lib/services/matching';
import { z } from 'zod';

export const GET = withAuth<{ id: string }>(async (auth, req, { id }) => {
  const search = new URL(req.url).searchParams.get('q') ?? undefined;
  const candidates = await suggestTransactionsForReceipt(auth.organizationId, id, search);
  return NextResponse.json({ candidates });
});

const schema = z.object({ transactionId: z.string().min(1).max(60) });

/** Link a receipt to a transaction chosen by hand. */
export const POST = withAuth<{ id: string }>(async (auth, req, { id }) => {
  const { transactionId } = schema.parse(await req.json());
  const matchId = await createManualMatch(auth, id, transactionId);
  return NextResponse.json({ ok: true, matchId }, { status: 201 });
});
