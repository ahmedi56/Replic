import 'server-only';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { users, memberships, organizations, subscriptions, receipts } from '@/db/schema';
import { ApiError } from '../api';
import { PRICING_PLANS, effectiveSubscription, planFor, type EffectiveSubscription } from '../pricing';
import { recordAudit } from '../audit';

/**
 * Plans and quotas. Billing is by invoice and bank transfer, so a plan is switched on by hand
 * (see `npm run plan`) once the money has arrived, and it carries an end date.
 */

export async function getSubscription(organizationId: string) {
  return (await db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1))[0] ?? null;
}

export async function getEffectiveSubscription(organizationId: string): Promise<EffectiveSubscription | null> {
  const sub = await getSubscription(organizationId);
  return sub ? effectiveSubscription(sub) : null;
}

/** Throws 402 when this month's receipt count has reached the organization's current limit. */
export async function enforceReceiptQuota(organizationId: string): Promise<void> {
  const sub = await getSubscription(organizationId);
  if (!sub) return;
  const current = effectiveSubscription(sub);

  const periodStart = new Date();
  periodStart.setUTCDate(1);
  periodStart.setUTCHours(0, 0, 0, 0);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(receipts)
    .where(and(eq(receipts.organizationId, organizationId), eq(receipts.isDuplicate, false), gte(receipts.createdAt, periodStart)));

  if ((row?.count ?? 0) >= current.receiptQuota) {
    const reason = current.expired
      ? `Your ${planFor(sub.plan).name} plan ended on ${sub.currentPeriodEnd!.toISOString().slice(0, 10)}, so the Free limit of ${current.receiptQuota} receipts a month applies. Renew to add more.`
      : `You have used all ${current.receiptQuota} receipts on the ${current.plan.name} plan this month. Upgrade to add more.`;
    throw new ApiError(402, reason, 'quota_exceeded');
  }
}

// --- Administration (used by the command line) -------------------------------------

export interface PlanRow {
  email: string;
  organizationId: string;
  organizationName: string;
  plan: string;
  receiptQuota: number;
  currentPeriodEnd: Date | null;
  paymentReference: string | null;
  expired: boolean;
  daysLeft: number | null;
}

async function rows(filter?: ReturnType<typeof eq>): Promise<PlanRow[]> {
  const found = await db
    .select({
      email: users.email,
      organizationId: organizations.id,
      organizationName: organizations.name,
      plan: subscriptions.plan,
      receiptQuota: subscriptions.receiptQuota,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      paymentReference: subscriptions.paymentReference,
    })
    .from(subscriptions)
    .innerJoin(organizations, eq(organizations.id, subscriptions.organizationId))
    .innerJoin(memberships, and(eq(memberships.organizationId, organizations.id), eq(memberships.role, 'owner')))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(filter);
  return found.map((r) => {
    const e = effectiveSubscription(r);
    return { ...r, expired: e.expired, daysLeft: e.daysLeft };
  });
}

export const listPlans = () => rows();

export async function findPlanByEmail(email: string): Promise<PlanRow[]> {
  return rows(eq(users.email, email.toLowerCase().trim()));
}

/** Paid plans whose period ends within `days` days (or already has), soonest first. */
export async function expiringPlans(days: number): Promise<PlanRow[]> {
  return (await rows())
    .filter((r) => r.plan !== 'free' && r.daysLeft !== null && r.daysLeft <= days)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
}

export interface SetPlanInput {
  email: string;
  plan: string;
  /** End of the paid period, as YYYY-MM-DD. Required for paid plans. */
  until?: string;
  /** Override the plan's standard monthly receipt quota. */
  quota?: number;
  /** Invoice number or bank reference of the payment this activates. */
  reference?: string;
  dryRun?: boolean;
}

export interface SetPlanResult {
  email: string;
  organizationName: string;
  before: { plan: string; receiptQuota: number; currentPeriodEnd: Date | null };
  after: { plan: string; receiptQuota: number; currentPeriodEnd: Date | null; paymentReference: string | null };
  applied: boolean;
}

/** Switch an account to a plan. Validates everything before writing anything. */
export async function setPlan(input: SetPlanInput): Promise<SetPlanResult> {
  const plan = PRICING_PLANS.find((p) => p.id === input.plan);
  if (!plan) throw new ApiError(400, `Unknown plan "${input.plan}". Choose one of: ${PRICING_PLANS.map((p) => p.id).join(', ')}.`);

  let end: Date | null = null;
  if (plan.id !== 'free') {
    if (!input.until) throw new ApiError(400, `A paid plan needs an end date: add --until YYYY-MM-DD, so access cannot run on forever by accident.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.until)) throw new ApiError(400, 'The end date must look like 2027-10-30.');
    // The whole of the last day counts: the plan runs until the end of that day, UTC.
    end = new Date(`${input.until}T23:59:59.999Z`);
    if (Number.isNaN(end.getTime())) throw new ApiError(400, `"${input.until}" is not a real date.`);
    if (end.getTime() < Date.now()) throw new ApiError(400, `The end date ${input.until} is already in the past.`);
    if (end.getTime() > Date.now() + 3 * 366 * 86_400_000) throw new ApiError(400, 'That end date is more than three years away. Check for a typo.');
  }
  if (input.quota !== undefined && (!Number.isInteger(input.quota) || input.quota < 1 || input.quota > 1_000_000)) {
    throw new ApiError(400, 'The quota must be a whole number between 1 and 1,000,000.');
  }

  const matches = await findPlanByEmail(input.email);
  if (matches.length === 0) throw new ApiError(404, `No account with the email ${input.email}.`);
  if (matches.length > 1) throw new ApiError(409, `${input.email} owns more than one workspace; this command cannot tell which you mean.`);
  const current = matches[0];

  const after = {
    plan: plan.id,
    receiptQuota: input.quota ?? plan.receiptQuota,
    currentPeriodEnd: end,
    paymentReference: input.reference ?? null,
  };
  const result: SetPlanResult = {
    email: current.email,
    organizationName: current.organizationName,
    before: { plan: current.plan, receiptQuota: current.receiptQuota, currentPeriodEnd: current.currentPeriodEnd },
    after,
    applied: false,
  };
  if (input.dryRun) return result;

  await db
    .update(subscriptions)
    .set({ plan: after.plan, receiptQuota: after.receiptQuota, currentPeriodEnd: after.currentPeriodEnd, paymentReference: after.paymentReference, periodStart: new Date() })
    .where(eq(subscriptions.organizationId, current.organizationId));

  await recordAudit({
    organizationId: current.organizationId,
    actorLabel: 'Reclip support',
    action: 'plan.changed',
    entityType: 'organization',
    entityId: current.organizationId,
    detail: `${current.plan} to ${after.plan}${end ? ` until ${input.until}` : ''}${input.reference ? `, ref ${input.reference}` : ''}`,
  });

  result.applied = true;
  return result;
}
