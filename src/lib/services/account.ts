import 'server-only';
import { and, eq, ne, inArray } from 'drizzle-orm';
import { db } from '@/db';
import {
  users,
  sessions,
  memberships,
  organizations,
  receipts,
  receiptExtractions,
  transactions,
  matches,
  imports,
  categories,
  auditLogs,
} from '@/db/schema';
import { hashPassword, verifyPassword, type AuthContext } from '../auth/session';
import { ApiError } from '../api';
import { deleteOrganizationDocuments } from '../storage';
import { recordSecurityEvent, listSecurityEvents } from './security';

async function requireUser(userId: string) {
  const row = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!row) throw new ApiError(404, 'Account not found');
  return row;
}

/**
 * Change the password. Every other session is signed out, so a stolen session does not
 * survive a password change; the one making the change stays signed in.
 */
export async function changePassword(
  auth: AuthContext,
  input: { current: string; next: string },
  keepSessionHash: string | null,
  req?: Request,
): Promise<void> {
  const user = await requireUser(auth.userId);
  if (!(await verifyPassword(input.current, user.passwordHash))) throw new ApiError(400, 'Your current password is incorrect');
  if (input.current === input.next) throw new ApiError(400, 'Choose a password you are not already using');

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(input.next), failedLogins: 0, lockedUntil: null })
    .where(eq(users.id, user.id));
  await db
    .delete(sessions)
    .where(keepSessionHash ? and(eq(sessions.userId, user.id), ne(sessions.tokenHash, keepSessionHash)) : eq(sessions.userId, user.id));
  await recordSecurityEvent(user.id, 'password_changed', req);
}

/** Everything the account owns, as plain JSON, for the "download my data" request. */
export async function exportAccountData(auth: AuthContext) {
  const org = auth.organizationId;
  const user = await requireUser(auth.userId);

  const [receiptRows, transactionRows, matchRows, importRows, categoryRows, auditRows, securityRows] = await Promise.all([
    db
      .select({ receipt: receipts, extraction: receiptExtractions })
      .from(receipts)
      .leftJoin(receiptExtractions, eq(receiptExtractions.receiptId, receipts.id))
      .where(eq(receipts.organizationId, org)),
    db.select().from(transactions).where(eq(transactions.organizationId, org)),
    db.select().from(matches).where(eq(matches.organizationId, org)),
    db.select().from(imports).where(eq(imports.organizationId, org)),
    db.select().from(categories).where(eq(categories.organizationId, org)),
    db.select().from(auditLogs).where(eq(auditLogs.organizationId, org)),
    listSecurityEvents(user.id, 200),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    note: 'Original receipt files are not included here; download them from each receipt.',
    account: {
      email: user.email,
      name: user.name,
      persona: user.persona,
      createdAt: user.createdAt,
      emailVerifiedAt: user.emailVerifiedAt,
    },
    organization: { id: org, name: auth.organizationName },
    categories: categoryRows,
    receipts: receiptRows,
    transactions: transactionRows,
    matches: matchRows,
    imports: importRows,
    auditLog: auditRows,
    securityHistory: securityRows.map(({ type, ip, userAgent, createdAt }) => ({ type, ip, userAgent, createdAt })),
  };
}

/**
 * Permanently delete the account and, for organizations where this person is the only
 * member, everything in them: rows (by cascade) and stored files. Requires the password.
 */
export async function deleteAccount(auth: AuthContext, password: string): Promise<void> {
  const user = await requireUser(auth.userId);
  if (!(await verifyPassword(password, user.passwordHash))) throw new ApiError(400, 'Password is incorrect');

  const mine = await db.select({ organizationId: memberships.organizationId }).from(memberships).where(eq(memberships.userId, user.id));
  const orgIds = mine.map((m) => m.organizationId);

  const shared = orgIds.length
    ? await db
        .select({ organizationId: memberships.organizationId })
        .from(memberships)
        .where(and(inArray(memberships.organizationId, orgIds), ne(memberships.userId, user.id)))
    : [];
  const sharedIds = new Set(shared.map((m) => m.organizationId));
  const soleOrgIds = orgIds.filter((id) => !sharedIds.has(id));

  // Rows first: if this fails nothing has been removed from disk yet.
  if (soleOrgIds.length) await db.delete(organizations).where(inArray(organizations.id, soleOrgIds));
  await db.delete(users).where(eq(users.id, user.id));

  for (const id of soleOrgIds) await deleteOrganizationDocuments(id);
}
