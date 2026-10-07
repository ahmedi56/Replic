import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { verifyPassword, createSession, setSessionCookie, purgeExpiredSessions } from '@/lib/auth/session';
import { withoutAuth, rateLimit, clientKey, ApiError } from '@/lib/api';

const schema = z.object({ email: z.string().email().max(200), password: z.string().max(200) });

export const POST = withoutAuth(async (req) => {
  const body = schema.parse(await req.json());
  const email = body.email.toLowerCase().trim();

  // Limited per-IP and per-account, so one account can't be brute-forced from many IPs.
  rateLimit(clientKey(req, 'login'), 10, 60_000);
  rateLimit(`login-account:${email}`, 10, 60_000);

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];

  // Hash even when the account is missing, so response time doesn't reveal which emails exist.
  const valid = user
    ? await verifyPassword(body.password, user.passwordHash)
    : await verifyPassword(body.password, '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');

  if (!user || !valid) throw new ApiError(401, 'Email or password is incorrect');

  await purgeExpiredSessions();
  const token = await createSession(user.id);
  await setSessionCookie(token);
  return NextResponse.json({ ok: true, onboarded: Boolean(user.onboardedAt) });
});
