import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { emailVerificationTokens, users } from '@/db/schema';
import { newId, randomToken, sha256 } from '../ids';
import { isMailConfigured, sendVerificationEmail } from '../mail';
import { recordSecurityEvent } from './security';

const TTL_MS = 1000 * 60 * 60 * 24;

/**
 * Create a verification link and email it. Does nothing without a mail provider, because a
 * link no one receives would lock people out. Never throws: signup must not fail on mail.
 */
export async function sendVerification(userId: string, email: string): Promise<void> {
  if (!isMailConfigured()) return;
  try {
    const token = randomToken();
    await db.insert(emailVerificationTokens).values({
      id: newId('evt'),
      tokenHash: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + TTL_MS),
    });
    await sendVerificationEmail(email, `/verify-email?token=${token}`, TTL_MS / 3_600_000);
  } catch (error) {
    // The reason only: never the address or the link.
    console.error('[mail] verification email failed:', error instanceof Error ? error.message : 'unknown');
  }
}

/** Consume a token and mark the address verified. False for unknown, used or expired tokens. */
export async function verifyEmailToken(token: string, req?: Request): Promise<boolean> {
  const rows = await db
    .select()
    .from(emailVerificationTokens)
    .where(and(eq(emailVerificationTokens.tokenHash, sha256(token)), isNull(emailVerificationTokens.usedAt)))
    .limit(1);
  const record = rows[0];
  if (!record || record.expiresAt.getTime() < Date.now()) return false;

  const now = new Date();
  await db.update(emailVerificationTokens).set({ usedAt: now }).where(eq(emailVerificationTokens.id, record.id));
  await db.update(users).set({ emailVerifiedAt: now }).where(and(eq(users.id, record.userId), isNull(users.emailVerifiedAt)));
  await recordSecurityEvent(record.userId, 'email_verified', req);
  return true;
}
