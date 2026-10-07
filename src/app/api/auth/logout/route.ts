import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, destroySession, clearSessionCookie } from '@/lib/auth/session';
import { withoutAuth } from '@/lib/api';

export const POST = withoutAuth(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
});
