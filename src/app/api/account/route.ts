import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, rateLimit } from '@/lib/api';
import { clearSessionCookie } from '@/lib/auth/session';
import { deleteAccount } from '@/lib/services/account';

const schema = z.object({ password: z.string().max(200) });

/** Permanently delete the account and its data. Needs the password, even when signed in. */
export const DELETE = withAuth(async (auth, req) => {
  await rateLimit(`account-delete:${auth.userId}`, 5, 15 * 60_000);
  const { password } = schema.parse(await req.json());
  await deleteAccount(auth, password);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
});
