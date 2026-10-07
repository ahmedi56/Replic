import 'server-only';
import { cookies } from 'next/headers';
import { eq, lt } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '@/db';
import { sessions, users, memberships, organizations } from '@/db/schema';
import { newId, randomToken, sha256 } from '../ids';

export const SESSION_COOKIE = 'reclip_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export interface AuthContext {
  userId: string;
  email: string;
  name: string | null;
  persona: string | null;
  onboardedAt: Date | null;
  organizationId: string;
  organizationName: string;
  role: string;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Only the hash of the session token is stored, so a database leak does not hand out
 * live sessions. The raw token exists in the user's cookie and nowhere else.
 */
export async function createSession(userId: string): Promise<string> {
  const token = randomToken();
  await db.insert(sessions).values({
    id: newId('ses'),
    tokenHash: sha256(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

/** Resolve the caller. Returns null when unauthenticated — never throws. */
export async function getAuth(): Promise<AuthContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      persona: users.persona,
      onboardedAt: users.onboardedAt,
      expiresAt: sessions.expiresAt,
      organizationId: memberships.organizationId,
      organizationName: organizations.name,
      role: memberships.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(sessions.tokenHash, sha256(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
    return null;
  }

  return {
    userId: row.userId,
    email: row.email,
    name: row.name,
    persona: row.persona,
    onboardedAt: row.onboardedAt,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    role: row.role,
  };
}

/** Housekeeping — cheap enough to run opportunistically on login. */
export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
