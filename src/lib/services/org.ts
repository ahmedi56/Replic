import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orgSettings, categories, organizations, subscriptions, memberships, users } from '@/db/schema';
import { resolveConfig, type MatchingConfig } from '../matching/config';
import { newId } from '../ids';

export const SYSTEM_CATEGORIES = [
  { name: 'Food', color: '#F59E0B' },
  { name: 'Transport', color: '#3B82F6' },
  { name: 'Software', color: '#8B5CF6' },
  { name: 'Office', color: '#64748B' },
  { name: 'Travel', color: '#06B6D4' },
  { name: 'Equipment', color: '#EC4899' },
  { name: 'Marketing', color: '#F97316' },
  { name: 'Utilities', color: '#14B8A6' },
  { name: 'Other', color: '#94A3B8' },
];

export async function getMatchingConfig(organizationId: string): Promise<MatchingConfig> {
  const rows = await db.select().from(orgSettings).where(eq(orgSettings.organizationId, organizationId)).limit(1);
  return resolveConfig(rows[0]?.matchingConfig);
}

export async function saveMatchingConfig(organizationId: string, config: Partial<MatchingConfig>): Promise<void> {
  const existing = await db.select().from(orgSettings).where(eq(orgSettings.organizationId, organizationId)).limit(1);
  const payload = JSON.stringify(config);
  if (existing[0]) {
    await db.update(orgSettings).set({ matchingConfig: payload }).where(eq(orgSettings.organizationId, organizationId));
  } else {
    await db.insert(orgSettings).values({ id: newId('set'), organizationId, matchingConfig: payload });
  }
}

/** Create an organization with its default categories and free plan. */
export async function provisionOrganization(name: string, userId: string): Promise<string> {
  const organizationId = newId('org');
  await db.insert(organizations).values({ id: organizationId, name });
  await db.insert(memberships).values({ id: newId('mem'), userId, organizationId, role: 'owner' });
  await db.insert(subscriptions).values({ id: newId('sub'), organizationId, plan: 'free', receiptQuota: 50 });
  await db.insert(categories).values(
    SYSTEM_CATEGORIES.map((c) => ({
      id: newId('cat'),
      organizationId,
      name: c.name,
      color: c.color,
      isSystem: true,
    })),
  );
  return organizationId;
}

export async function listCategories(organizationId: string) {
  return db.select().from(categories).where(eq(categories.organizationId, organizationId));
}

export async function getUserById(userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}
