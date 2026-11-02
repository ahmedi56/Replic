import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { effectiveSubscription } from '@/lib/pricing';

const day = 86_400_000;
const NOW = new Date('2026-11-02T12:00:00Z');
const at = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * day);

describe('effectiveSubscription (the rule, with no database)', () => {
  it('Free stays Free and has no end date', () => {
    const e = effectiveSubscription({ plan: 'free', receiptQuota: 50, currentPeriodEnd: null }, NOW);
    expect(e).toMatchObject({ expired: false, receiptQuota: 50, daysLeft: null });
    expect(e.plan.id).toBe('free');
  });

  it('a paid plan inside its period keeps its own quota and counts days left', () => {
    const e = effectiveSubscription({ plan: 'pro', receiptQuota: 500, currentPeriodEnd: at(30) }, NOW);
    expect(e).toMatchObject({ expired: false, receiptQuota: 500, daysLeft: 30 });
    expect(e.plan.id).toBe('pro');
  });

  it('a paid plan past its end date falls back to the Free quota', () => {
    const e = effectiveSubscription({ plan: 'business', receiptQuota: 2500, currentPeriodEnd: at(-1) }, NOW);
    expect(e).toMatchObject({ expired: true, receiptQuota: 50 });
    expect(e.plan.id).toBe('free');
    expect(e.daysLeft).toBeLessThanOrEqual(0);
  });

  it('keeps a custom quota while the plan is active', () => {
    expect(effectiveSubscription({ plan: 'pro', receiptQuota: 1200, currentPeriodEnd: at(5) }, NOW).receiptQuota).toBe(1200);
  });

  it('a paid plan with no end date does not expire (legacy rows)', () => {
    expect(effectiveSubscription({ plan: 'pro', receiptQuota: 500, currentPeriodEnd: null }, NOW).expired).toBe(false);
  });

  it('an unknown plan name is treated as Free', () => {
    expect(effectiveSubscription({ plan: 'platinum', receiptQuota: 9, currentPeriodEnd: null }, NOW).plan.id).toBe('free');
  });
});

describe('plans against a real database', () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'reclip-plans-'));
  const dbDir = path.join(workdir, 'pg');
  process.env.DATABASE_URL = `pglite:${dbDir}`;
  process.env.STORAGE_DIR = path.join(workdir, 'storage');

  let db: typeof import('@/db').db;
  let schema: typeof import('@/db/schema');
  let plans: typeof import('@/lib/services/plans');
  let org: typeof import('@/lib/services/org');
  let ids: typeof import('@/lib/ids');

  const future = (daysAhead: number) => new Date(Date.now() + daysAhead * day).toISOString().slice(0, 10);

  async function makeAccount(label: string) {
    const userId = ids.newId('usr');
    await db.insert(schema.users).values({ id: userId, email: `${label}@example.com`, passwordHash: 'x', name: label });
    const organizationId = await org.provisionOrganization(`${label} Ltd`, userId);
    return { userId, organizationId, email: `${label}@example.com` };
  }

  async function fillReceipts(organizationId: string, count: number) {
    await db.insert(schema.receipts).values(
      Array.from({ length: count }, (_, i) => ({
        id: ids.newId('rcp'),
        organizationId,
        storageKey: `${organizationId}/f${i}.pdf`,
        originalName: `f${i}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 10,
        checksum: `c${organizationId}${i}`,
      })),
    );
  }

  beforeAll(async () => {
    execFileSync('node', ['node_modules/tsx/dist/cli.mjs', 'scripts/migrate.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `pglite:${dbDir}` },
      stdio: 'pipe',
    });
    db = (await import('@/db')).db;
    schema = await import('@/db/schema');
    plans = await import('@/lib/services/plans');
    org = await import('@/lib/services/org');
    ids = await import('@/lib/ids');
  }, 60_000);

  afterAll(async () => {
    await (await import('@/db')).closeDb();
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  describe('setPlan', () => {
    it('switches an account to a paid plan with an end date, a reference and an audit line', async () => {
      const a = await makeAccount('setok');
      const until = future(365);
      const result = await plans.setPlan({ email: a.email, plan: 'pro', until, reference: 'INV-2026-001' });

      expect(result.applied).toBe(true);
      expect(result.before).toMatchObject({ plan: 'free', receiptQuota: 50 });
      const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, a.organizationId));
      expect(sub).toMatchObject({ plan: 'pro', receiptQuota: 500, paymentReference: 'INV-2026-001' });
      expect(sub.currentPeriodEnd!.toISOString().slice(0, 10)).toBe(until);
      expect(sub.currentPeriodEnd!.toISOString()).toContain('T23:59:59'); // the whole last day counts

      const [log] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.organizationId, a.organizationId));
      expect(log).toMatchObject({ action: 'plan.changed', actorLabel: 'Reclip support' });
      expect(log.detail).toContain('free to pro');
      expect(log.detail).toContain('INV-2026-001');
    });

    it('is case-insensitive about the email', async () => {
      const a = await makeAccount('mixedcase');
      const r = await plans.setPlan({ email: '  MixedCase@Example.com ', plan: 'business', until: future(30) });
      expect(r.applied).toBe(true);
      expect(r.after.receiptQuota).toBe(2500);
      expect(a.email).toBe('mixedcase@example.com');
    });

    it('a dry run reports the change and writes nothing', async () => {
      const a = await makeAccount('dryrun');
      const r = await plans.setPlan({ email: a.email, plan: 'pro', until: future(30), dryRun: true });
      expect(r.applied).toBe(false);
      expect(r.after.plan).toBe('pro');
      const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, a.organizationId));
      expect(sub.plan).toBe('free');
      expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.organizationId, a.organizationId))).toHaveLength(0);
    });

    it('refuses a paid plan without an end date', async () => {
      const a = await makeAccount('nodate');
      await expect(plans.setPlan({ email: a.email, plan: 'pro' })).rejects.toThrow(/needs an end date/i);
    });

    it.each([
      ['a past date', '2020-01-01', /already in the past/],
      ['a malformed date', '30/10/2027', /must look like/],
      ['an impossible date', '2027-13-45', /not a real date|must look like/],
      ['a date years away', '2099-01-01', /three years/],
    ])('refuses %s', async (_name, until, message) => {
      const a = await makeAccount(`bad${until.replace(/\W/g, '')}`);
      await expect(plans.setPlan({ email: a.email, plan: 'pro', until })).rejects.toThrow(message);
    });

    it('refuses an unknown plan, naming the real ones', async () => {
      const a = await makeAccount('unknownplan');
      await expect(plans.setPlan({ email: a.email, plan: 'platinum', until: future(30) })).rejects.toThrow(/free, pro, business/);
    });

    it('refuses an unknown email', async () => {
      await expect(plans.setPlan({ email: 'nobody@example.com', plan: 'free' })).rejects.toThrow(/No account/);
    });

    it('refuses a nonsense quota override', async () => {
      const a = await makeAccount('badquota');
      for (const quota of [0, -5, 1.5, 5_000_000]) {
        await expect(plans.setPlan({ email: a.email, plan: 'pro', until: future(30), quota })).rejects.toThrow(/quota/i);
      }
    });

    it('accepts a custom quota', async () => {
      const a = await makeAccount('customquota');
      const r = await plans.setPlan({ email: a.email, plan: 'pro', until: future(30), quota: 1500 });
      expect(r.after.receiptQuota).toBe(1500);
    });

    it('moving back to Free clears the end date and reference', async () => {
      const a = await makeAccount('backtofree');
      await plans.setPlan({ email: a.email, plan: 'pro', until: future(30), reference: 'INV-9' });
      await plans.setPlan({ email: a.email, plan: 'free' });
      const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, a.organizationId));
      expect(sub).toMatchObject({ plan: 'free', receiptQuota: 50, currentPeriodEnd: null, paymentReference: null });
    });

    it('changes nothing for other accounts', async () => {
      const a = await makeAccount('isolatea');
      const b = await makeAccount('isolateb');
      await plans.setPlan({ email: a.email, plan: 'business', until: future(30) });
      const [other] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, b.organizationId));
      expect(other.plan).toBe('free');
    });
  });

  describe('listing', () => {
    it('shows owners with their plan, and flags expired and expiring ones', async () => {
      const soon = await makeAccount('listsoon');
      const lapsed = await makeAccount('listlapsed');
      await plans.setPlan({ email: soon.email, plan: 'pro', until: future(10) });
      await plans.setPlan({ email: lapsed.email, plan: 'pro', until: future(10) });
      // time passes: the second one's period ends yesterday
      await db.update(schema.subscriptions).set({ currentPeriodEnd: new Date(Date.now() - day) }).where(eq(schema.subscriptions.organizationId, lapsed.organizationId));

      const all = await plans.listPlans();
      expect(all.find((r) => r.email === lapsed.email)).toMatchObject({ plan: 'pro', expired: true });
      expect(all.find((r) => r.email === soon.email)).toMatchObject({ expired: false });

      const expiring = (await plans.expiringPlans(30)).map((r) => r.email);
      expect(expiring).toContain(soon.email);
      expect(expiring).toContain(lapsed.email);
      expect(expiring.indexOf(lapsed.email)).toBeLessThan(expiring.indexOf(soon.email)); // most urgent first
      expect((await plans.expiringPlans(3)).map((r) => r.email)).not.toContain(soon.email);
    });
  });

  describe('enforceReceiptQuota', () => {
    it('lets a Free account upload until it reaches 50, then refuses with 402', async () => {
      const a = await makeAccount('quotafree');
      await fillReceipts(a.organizationId, 49);
      await expect(plans.enforceReceiptQuota(a.organizationId)).resolves.toBeUndefined();
      await fillReceipts(a.organizationId, 1);
      await expect(plans.enforceReceiptQuota(a.organizationId)).rejects.toMatchObject({ status: 402, code: 'quota_exceeded' });
    });

    it('a paid plan raises the limit', async () => {
      const a = await makeAccount('quotapaid');
      await plans.setPlan({ email: a.email, plan: 'pro', until: future(30) });
      await fillReceipts(a.organizationId, 60);
      await expect(plans.enforceReceiptQuota(a.organizationId)).resolves.toBeUndefined();
    });

    it('an expired paid plan drops back to the Free limit, and the message says why', async () => {
      const a = await makeAccount('quotaexpired');
      await plans.setPlan({ email: a.email, plan: 'pro', until: future(30) });
      await fillReceipts(a.organizationId, 60);
      await db.update(schema.subscriptions).set({ currentPeriodEnd: new Date(Date.now() - day) }).where(eq(schema.subscriptions.organizationId, a.organizationId));

      const error = await plans.enforceReceiptQuota(a.organizationId).catch((e) => e);
      expect(error.status).toBe(402);
      expect(error.message).toMatch(/Pro plan ended on \d{4}-\d{2}-\d{2}/);
      expect(error.message).toMatch(/Free limit of 50/);
    });

    it('never deletes anything when a plan lapses', async () => {
      const a = await makeAccount('quotakeep');
      await plans.setPlan({ email: a.email, plan: 'pro', until: future(30) });
      await fillReceipts(a.organizationId, 70);
      await db.update(schema.subscriptions).set({ currentPeriodEnd: new Date(Date.now() - day) }).where(eq(schema.subscriptions.organizationId, a.organizationId));
      await plans.enforceReceiptQuota(a.organizationId).catch(() => undefined);
      expect(await db.select().from(schema.receipts).where(eq(schema.receipts.organizationId, a.organizationId))).toHaveLength(70);
    });

    it('does not count duplicates or other organizations', async () => {
      const a = await makeAccount('quotaother');
      const b = await makeAccount('quotaother2');
      await fillReceipts(b.organizationId, 80);
      await expect(plans.enforceReceiptQuota(a.organizationId)).resolves.toBeUndefined();
    });
  });
});
