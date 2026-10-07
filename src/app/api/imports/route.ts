import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, rateLimit } from '@/lib/api';
import { commitImport, listImports } from '@/lib/services/imports';
import { matchReceipts } from '@/lib/services/matching';

export const runtime = 'nodejs';
export const maxDuration = 60;

const schema = z.object({
  filename: z.string().max(200),
  content: z.string().max(10 * 1024 * 1024),
  mapping: z.record(z.string(), z.enum(['date', 'description', 'amount', 'debit', 'credit', 'currency', 'reference', 'ignore'])),
  bankAccountId: z.string().max(60).nullable().optional(),
  bankAccountName: z.string().max(120).optional(),
  defaultCurrency: z.string().length(3).optional(),
  dateOrder: z.enum(['auto', 'dmy', 'mdy']).optional(),
  invertAmounts: z.boolean().optional(),
  force: z.boolean().optional(),
});

export const GET = withAuth(async (auth) => NextResponse.json({ imports: await listImports(auth.organizationId) }));

export const POST = withAuth(async (auth, req) => {
  rateLimit(`import:${auth.organizationId}`, 20, 60_000);
  const body = schema.parse(await req.json());

  const result = await commitImport(auth, body);
  // New transactions can complete receipts that were previously unmatched.
  const run = await matchReceipts(auth);

  return NextResponse.json({ ...result, matching: run.stats }, { status: 201 });
});
