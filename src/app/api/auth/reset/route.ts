import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { users, passwordResetTokens, sessions } from '@/db/schema';
import { hashPassword } from '@/lib/auth/session';
import { newId, randomToken, sha256 } from '@/lib/ids';
import { isMailConfigured, sendPasswordResetEmail } from '@/lib/mail';
import { withoutAuth, rateLimit, clientKey, ApiError } from '@/lib/api';

const requestSchema = z.object({ email: z.string().email().max(200) });
const confirmSchema = z.object({ token: z.string().min(10).max(200), password: z.string().min(10).max(200) });

const TTL_MS = 1000 * 60 * 30;

/**
 * Request a reset link.
 *
 * Always answers the same way, whether or not the address exists — the response must not
 * be usable to enumerate accounts. The email is sent in the background so response time
 * doesn't reveal it either. With no SMTP configured, the link is returned in the payload in
 * development only, so the flow is still demonstrable.
 */
export const POST = withoutAuth(async (req) => {
  rateLimit(clientKey(req, 'reset'), 5, 60_000);
  const { email } = requestSchema.parse(await req.json());

  const rows = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);
  let devLink: string | undefined;

  if (rows[0]) {
    const token = randomToken();
    await db.insert(passwordResetTokens).values({
      id: newId('prt'),
      tokenHash: sha256(token),
      userId: rows[0].id,
      expiresAt: new Date(Date.now() + TTL_MS),
    });
    const path = `/reset?token=${token}`;

    if (isMailConfigured()) {
      sendPasswordResetEmail(rows[0].email, path, TTL_MS / 60_000).catch((error) => {
        // Log the reason, never the address or the link.
        console.error('[mail] password reset email failed:', error instanceof Error ? error.message : 'unknown');
      });
    } else if (process.env.NODE_ENV !== 'production') {
      devLink = path;
    } else {
      console.error('[mail] SMTP_HOST and MAIL_FROM are not set; password reset emails cannot be sent');
    }
  }

  return NextResponse.json({
    ok: true,
    message: 'If an account exists for that address, a reset link is on its way.',
    devLink,
  });
});

export const PUT = withoutAuth(async (req) => {
  rateLimit(clientKey(req, 'reset-confirm'), 10, 60_000);
  const { token, password } = confirmSchema.parse(await req.json());

  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tokenHash, sha256(token)), isNull(passwordResetTokens.usedAt)))
    .limit(1);

  const record = rows[0];
  if (!record || record.expiresAt.getTime() < Date.now()) {
    throw new ApiError(400, 'This reset link is invalid or has expired');
  }

  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, record.userId));
  await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, record.id));
  // A password change invalidates every existing session for that user.
  await db.delete(sessions).where(eq(sessions.userId, record.userId));

  return NextResponse.json({ ok: true });
});
