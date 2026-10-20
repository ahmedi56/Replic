import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, rateLimit } from '@/lib/api';
import { currentSessionHash } from '@/lib/auth/session';
import { changePassword } from '@/lib/services/account';

const schema = z.object({ current: z.string().max(200), next: z.string().min(10, 'Use at least 10 characters').max(200) });

export const PUT = withAuth(async (auth, req) => {
  await rateLimit(`password-change:${auth.userId}`, 5, 15 * 60_000);
  const body = schema.parse(await req.json());
  await changePassword(auth, body, await currentSessionHash(), req);
  return NextResponse.json({ ok: true });
});
