import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { verifyPassword, createSession, setSessionCookie, purgeExpiredSessions } from '@/lib/auth/session';
import { recordSecurityEvent } from '@/lib/services/security';
import { withoutAuth, rateLimit, clientKey, ApiError } from '@/lib/api';

const MAX_FAILED_LOGINS = 8;
const LOCK_MS = 15 * 60 * 1000;

async function registerFailedLogin(userId: string, previous: number, req: Request): Promise<void> {
  const failed = previous + 1;
  if (failed >= MAX_FAILED_LOGINS) {
    await db.update(users).set({ failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) }).where(eq(users.id, userId));
    await recordSecurityEvent(userId, 'locked', req);
  } else {
    await db.update(users).set({ failedLogins: failed }).where(eq(users.id, userId));
    await recordSecurityEvent(userId, 'login_failed', req);
  }
}

const schema = z.object({ email: z.string().email().max(200), password: z.string().max(200) });

export const POST = withoutAuth(async (req) => {
  const body = schema.parse(await req.json());
  const email = body.email.toLowerCase().trim();

  // Limited per-IP and per-account, so one account can't be brute-forced from many IPs.
  rateLimit(clientKey(req, 'login'), 10, 60_000);
  rateLimit(`login-account:${email}`, 10, 60_000);

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];

  // A locked account is answered exactly like a wrong password, so the lock can't be used to
  // discover which emails are registered. The hash still runs, to keep timing the same.
  const locked = Boolean(user?.lockedUntil && user.lockedUntil.getTime() > Date.now());
  const valid = user
    ? await verifyPassword(body.password, user.passwordHash)
    : await verifyPassword(body.password, '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');

  if (!user || !valid || locked) {
    if (user && !locked) await registerFailedLogin(user.id, user.failedLogins, req);
    throw new ApiError(401, 'Email or password is incorrect, or the account is temporarily locked');
  }

  if (user.failedLogins || user.lockedUntil) {
    await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
  }
  await recordSecurityEvent(user.id, 'login', req);
  await purgeExpiredSessions();
  const token = await createSession(user.id);
  await setSessionCookie(token);
  return NextResponse.json({ ok: true, onboarded: Boolean(user.onboardedAt) });
});
