import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { securityEvents } from '@/db/schema';
import { newId } from '../ids';
import { clientIp } from '../client-ip';

export type SecurityEventType =
  | 'login'
  | 'login_failed'
  | 'locked'
  | 'password_changed'
  | 'password_reset'
  | 'email_verified';

/** Record an account-level event. `req` is optional so tests and jobs can call it too. */
export async function recordSecurityEvent(userId: string, type: SecurityEventType, req?: Request): Promise<void> {
  await db.insert(securityEvents).values({
    id: newId('sec'),
    userId,
    type,
    ip: req ? clientIp(req.headers) : null,
    userAgent: req?.headers.get('user-agent')?.slice(0, 200) ?? null,
  });
}

export async function listSecurityEvents(userId: string, limit = 15) {
  return db.select().from(securityEvents).where(eq(securityEvents.userId, userId)).orderBy(desc(securityEvents.createdAt)).limit(limit);
}
