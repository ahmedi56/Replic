import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { eq, sql } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/session';

/** The job queue and the upload pipeline that runs on it, against a real (embedded) Postgres. */

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'reclip-queue-'));
const dbDir = path.join(workdir, 'pg');
const storageDir = path.join(workdir, 'storage');

process.env.DATABASE_URL = `pglite:${dbDir}`;
process.env.STORAGE_DIR = storageDir;
process.env.EXTRACTION_PROVIDER = 'local';
process.env.SEMANTIC_PROVIDER = 'local';
delete process.env.SMTP_HOST;

let db: typeof import('@/db').db;
let schema: typeof import('@/db/schema');
let queue: typeof import('@/lib/queue');
let receipts: typeof import('@/lib/services/receipts');
let storage: typeof import('@/lib/storage');
let pdf: typeof import('@/lib/demo/pdf');
let org: typeof import('@/lib/services/org');
let session: typeof import('@/lib/auth/session');
let ids: typeof import('@/lib/ids');
let imports: typeof import('@/lib/services/imports');

async function makeUser(label: string): Promise<AuthContext> {
  const userId = ids.newId('usr');
  const email = `${label}@example.com`;
  await db.insert(schema.users).values({ id: userId, email, passwordHash: await session.hashPassword('passphrase-1234'), name: label });
  const organizationId = await org.provisionOrganization(`${label} Ltd`, userId);
  return { userId, email, name: label, persona: null, onboardedAt: null, emailVerified: true, organizationId, organizationName: `${label} Ltd`, role: 'owner' };
}

const jobRow = async (id: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0];

beforeAll(async () => {
  fs.mkdirSync(storageDir, { recursive: true });
  execFileSync('node', ['node_modules/tsx/dist/cli.mjs', 'scripts/migrate.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `pglite:${dbDir}` },
    stdio: 'pipe',
  });
  db = (await import('@/db')).db;
  schema = await import('@/db/schema');
  queue = await import('@/lib/queue');
  receipts = await import('@/lib/services/receipts');
  storage = await import('@/lib/storage');
  pdf = await import('@/lib/demo/pdf');
  org = await import('@/lib/services/org');
  session = await import('@/lib/auth/session');
  ids = await import('@/lib/ids');
  imports = await import('@/lib/services/imports');
  (await import('@/lib/jobs')).registerAllJobs();
});

afterAll(async () => {
  await (await import('@/db')).closeDb();
  fs.rmSync(workdir, { recursive: true, force: true });
});

// Each test starts with an empty queue so counts are exact.
beforeEach(async () => {
  await db.delete(schema.jobs);
});

describe('claiming', () => {
  it('hands each job to exactly one of many simultaneous workers', async () => {
    for (let i = 0; i < 5; i++) await queue.enqueue('noop', { i });
    const claims = await Promise.all(Array.from({ length: 9 }, () => queue.claimJob()));
    const got = claims.filter((c) => c !== null).map((c) => c!.id);
    expect(got).toHaveLength(5);
    expect(new Set(got).size).toBe(5);
  });

  it('does not hand out a job that is not due yet', async () => {
    const id = await queue.enqueue('noop', {});
    await db.update(schema.jobs).set({ runAt: new Date(Date.now() + 60_000) }).where(eq(schema.jobs.id, id));
    expect(await queue.claimJob()).toBeNull();
  });

  it('takes the oldest due job first', async () => {
    const later = await queue.enqueue('noop', {});
    const earlier = await queue.enqueue('noop', {});
    await db.update(schema.jobs).set({ runAt: new Date(Date.now() - 10_000) }).where(eq(schema.jobs.id, earlier));
    await db.update(schema.jobs).set({ runAt: new Date(Date.now() - 1_000) }).where(eq(schema.jobs.id, later));
    expect((await queue.claimJob())?.id).toBe(earlier);
  });
});

describe('running jobs', () => {
  it('runs the handler with the payload and marks the job done', async () => {
    const seen: unknown[] = [];
    queue.registerJob('record', { run: async (p) => void seen.push(p) });
    const id = await queue.enqueue('record', { hello: 'world' });

    expect(await queue.runNextJob()).toBe(true);
    expect(seen).toEqual([{ hello: 'world' }]);
    const row = await jobRow(id);
    expect(row.status).toBe('done');
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(await queue.runNextJob()).toBe(false); // nothing left
  });

  it('retries a failing job later instead of failing it at once', async () => {
    queue.registerJob('flaky', { run: async () => { throw new Error('temporary outage'); } });
    const id = await queue.enqueue('flaky', {});

    await queue.runNextJob();
    const row = await jobRow(id);
    expect(row.status).toBe('queued');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('temporary outage');
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now() + 5_000); // backed off
    expect(await queue.runNextJob()).toBe(false); // not due, so not picked up
  });

  it('gives up after the last attempt, records the error and calls onFailed once', async () => {
    const failures: unknown[] = [];
    queue.registerJob('doomed', {
      run: async () => { throw new Error('always broken'); },
      onFailed: async (payload, error) => void failures.push({ payload, message: error.message }),
    });
    const id = await queue.enqueue('doomed', { n: 1 }, { maxAttempts: 1 });

    await queue.runNextJob();
    const row = await jobRow(id);
    expect(row.status).toBe('failed');
    expect(row.lastError).toBe('always broken');
    expect(failures).toEqual([{ payload: { n: 1 }, message: 'always broken' }]);
  });

  it('fails a job whose type nobody handles', async () => {
    const id = await queue.enqueue('nobody-handles-this', {});
    await queue.runNextJob();
    const row = await jobRow(id);
    expect(row.status).toBe('failed');
    expect(row.lastError).toMatch(/no handler/i);
  });

  it('recovers a job whose worker died: the expired lease makes it claimable again', async () => {
    const seen: unknown[] = [];
    queue.registerJob('survivor', { run: async (p) => void seen.push(p) });
    const id = await queue.enqueue('survivor', { ok: true });
    // A worker claimed it and then crashed: running, with a lease in the past.
    await db.update(schema.jobs).set({ status: 'running', attempts: 1, lockedUntil: new Date(Date.now() - 1000) }).where(eq(schema.jobs.id, id));

    await queue.runNextJob();
    expect(seen).toEqual([{ ok: true }]);
    expect((await jobRow(id)).status).toBe('done');
  });

  it('does not steal a job whose lease is still valid', async () => {
    const id = await queue.enqueue('survivor', {});
    await db.update(schema.jobs).set({ status: 'running', attempts: 1, lockedUntil: new Date(Date.now() + 60_000) }).where(eq(schema.jobs.id, id));
    expect(await queue.claimJob()).toBeNull();
  });

  it('stops retrying a job that keeps killing its worker', async () => {
    const id = await queue.enqueue('survivor', {}, { maxAttempts: 2 });
    await db.update(schema.jobs).set({ status: 'running', attempts: 2, lockedUntil: new Date(Date.now() - 1000) }).where(eq(schema.jobs.id, id));
    await queue.runNextJob();
    const row = await jobRow(id);
    expect(row.status).toBe('failed');
    expect(row.lastError).toMatch(/worker stopped/i);
  });
});

describe('worker loop', () => {
  it('picks up jobs that arrive while it is running, and stops cleanly', async () => {
    const seen: number[] = [];
    queue.registerJob('looped', { run: async (p: { n: number }) => void seen.push(p.n) });
    const worker = queue.startWorker({ concurrency: 2, pollMs: 20 });
    for (let n = 1; n <= 6; n++) await queue.enqueue('looped', { n });

    const deadline = Date.now() + 8_000;
    while (seen.length < 6 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    await worker.stop();

    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6]);
    const stats = await queue.queueStats();
    expect(stats.queued).toBe(0);
  });
});

describe('queueStats', () => {
  it('counts queued, running and recently failed jobs', async () => {
    await queue.enqueue('noop', {});
    await queue.enqueue('noop', {});
    const running = await queue.enqueue('noop', {});
    await db.update(schema.jobs).set({ status: 'running', lockedUntil: new Date(Date.now() + 60_000) }).where(eq(schema.jobs.id, running));
    const failed = await queue.enqueue('noop', {});
    await db.update(schema.jobs).set({ status: 'failed', finishedAt: new Date() }).where(eq(schema.jobs.id, failed));

    const stats = await queue.queueStats();
    expect(stats).toMatchObject({ queued: 2, running: 1, failed: 1 });
    expect(stats.oldestQueuedSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('uploading a receipt through the queue', () => {
  const makeFile = (merchant: string, total: string, date = '2026-09-28') =>
    storage.validateUpload(pdf.makeReceiptPdf([merchant, `Date: ${date}`, `Invoice No: INV-${merchant.length}`, `Total: EUR ${total}`, 'Paid by VISA']), `${merchant}.pdf`, 'application/pdf');

  it('returns at once with the receipt "processing", and a worker finishes it', async () => {
    const ctx = await makeUser('queued1');
    const result = await receipts.ingestReceipt(ctx, makeFile('Carrefour', '47.85'));

    expect(result.status).toBe('processing');
    let row = (await db.select().from(schema.receipts).where(eq(schema.receipts.id, result.receiptId)))[0];
    expect(row.status).toBe('processing');
    expect(await db.select().from(schema.receiptExtractions).where(eq(schema.receiptExtractions.receiptId, result.receiptId))).toHaveLength(0);
    const queued = await db.select().from(schema.jobs);
    expect(queued).toHaveLength(1);
    expect(JSON.parse(queued[0].payload)).toEqual({ receiptId: result.receiptId, organizationId: ctx.organizationId, userId: ctx.userId });

    await queue.runNextJob();

    row = (await db.select().from(schema.receipts).where(eq(schema.receipts.id, result.receiptId)))[0];
    expect(row.status).toBe('unmatched'); // finished; there is just no bank line to pair it with
    const extraction = (await db.select().from(schema.receiptExtractions).where(eq(schema.receiptExtractions.receiptId, result.receiptId)))[0];
    expect(extraction.merchantRaw).toBe('Carrefour');
    expect(extraction.total).toBe(47.85);
  });

  it('matches against transactions that were imported earlier', async () => {
    const ctx = await makeUser('queued2');
    await imports.commitImport(ctx, {
      filename: 'bank.csv',
      content: 'date,description,amount,currency\n2026-09-28,POS CARREFOUR MARKET,-47.85,EUR',
      mapping: { date: 'date', description: 'description', amount: 'amount', currency: 'currency' },
      bankAccountName: 'Main',
      force: true,
    });
    const { receiptId } = await receipts.ingestReceipt(ctx, makeFile('Carrefour', '47.85'));
    await queue.runNextJob();

    const found = await db.select().from(schema.matches).where(eq(schema.matches.receiptId, receiptId));
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].organizationId).toBe(ctx.organizationId);
  });

  it('is safe to run twice: a retry does not duplicate the extraction', async () => {
    const ctx = await makeUser('queued3');
    const { receiptId } = await receipts.ingestReceipt(ctx, makeFile('Tesco', '12.00'));
    await receipts.processReceipt(receiptId, ctx.organizationId, ctx.userId);
    await receipts.processReceipt(receiptId, ctx.organizationId, ctx.userId); // as after a crash and retry
    expect(await db.select().from(schema.receiptExtractions).where(eq(schema.receiptExtractions.receiptId, receiptId))).toHaveLength(1);
  });

  it('quietly skips a receipt that was deleted while it waited', async () => {
    const ctx = await makeUser('queued4');
    const { receiptId } = await receipts.ingestReceipt(ctx, makeFile('Aldi', '8.00'));
    await receipts.deleteReceipts(ctx, [receiptId]);

    await queue.runNextJob();
    const [job] = await db.select().from(schema.jobs);
    expect(job.status).toBe('done');
    expect(await db.select().from(schema.receiptExtractions).where(eq(schema.receiptExtractions.receiptId, receiptId))).toHaveLength(0);
  });

  it('marks the receipt failed when processing runs out of attempts', async () => {
    const ctx = await makeUser('queued5');
    const { receiptId } = await receipts.ingestReceipt(ctx, makeFile('Lidl', '9.00'));
    const [row] = await db.select().from(schema.receipts).where(eq(schema.receipts.id, receiptId));
    await storage.deleteDocument(ctx.organizationId, row.storageKey); // the worker will not be able to read it
    await db.update(schema.jobs).set({ maxAttempts: 1 });

    await queue.runNextJob();

    const after = (await db.select().from(schema.receipts).where(eq(schema.receipts.id, receiptId)))[0];
    expect(after.status).toBe('failed');
    expect(after.failureCode).toBe('processing_failed');
  });

  it('keeps one organization out of another: the job reads only its own receipt', async () => {
    const a = await makeUser('queued6a');
    const b = await makeUser('queued6b');
    const { receiptId } = await receipts.ingestReceipt(a, makeFile('Spar', '5.00'));
    // A forged job that names A's receipt but B's organization must find nothing.
    expect(await receipts.processReceipt(receiptId, b.organizationId, b.userId)).toBeNull();
    const [row] = await db.select().from(schema.receipts).where(eq(schema.receipts.id, receiptId));
    expect(row.status).toBe('processing'); // untouched
  });

  it('removes the stored file again if the receipt cannot be saved', async () => {
    const ctx = await makeUser('queued7');
    const before = fs.existsSync(path.join(storageDir, ctx.organizationId)) ? fs.readdirSync(path.join(storageDir, ctx.organizationId)).length : 0;
    // A receipt row for a nonexistent organization violates a foreign key, so the insert fails.
    const stranger = { ...ctx, organizationId: 'org_does_not_exist' };
    await expect(receipts.ingestReceipt(stranger, makeFile('Ghost', '1.00'))).rejects.toThrow();
    expect(fs.existsSync(path.join(storageDir, 'org_does_not_exist')) ? fs.readdirSync(path.join(storageDir, 'org_does_not_exist')).length : 0).toBe(0);
    expect((fs.existsSync(path.join(storageDir, ctx.organizationId)) ? fs.readdirSync(path.join(storageDir, ctx.organizationId)).length : 0)).toBe(before);
    expect(await db.select({ n: sql<number>`count(*)::int` }).from(schema.jobs)).toEqual([{ n: 0 }]);
  });
});
