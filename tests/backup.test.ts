import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { eq, sql } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/session';

/** Backups against a real (embedded) Postgres: encryption, completeness, restore, retention. */

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'reclip-backup-'));
const dbDir = path.join(workdir, 'pg');
const storageDir = path.join(workdir, 'storage');
const KEY = 'a'.repeat(64);

process.env.DATABASE_URL = `pglite:${dbDir}`;
process.env.STORAGE_DIR = storageDir;
process.env.EXTRACTION_PROVIDER = 'local';
process.env.SEMANTIC_PROVIDER = 'local';
process.env.BACKUP_ENCRYPTION_KEY = KEY;
delete process.env.SMTP_HOST;

let db: typeof import('@/db').db;
let schema: typeof import('@/db/schema');
let backup: typeof import('@/lib/backup');
let queue: typeof import('@/lib/queue');
let jobs: typeof import('@/lib/jobs');
let receipts: typeof import('@/lib/services/receipts');
let imports: typeof import('@/lib/services/imports');
let matching: typeof import('@/lib/services/matching');
let org: typeof import('@/lib/services/org');
let session: typeof import('@/lib/auth/session');
let storage: typeof import('@/lib/storage');
let pdf: typeof import('@/lib/demo/pdf');
let ids: typeof import('@/lib/ids');

const EMAIL = ['backup', 'owner@example.com'].join('');
let ctx: AuthContext;

beforeAll(async () => {
  fs.mkdirSync(storageDir, { recursive: true });
  execFileSync('node', ['node_modules/tsx/dist/cli.mjs', 'scripts/migrate.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `pglite:${dbDir}` },
    stdio: 'pipe',
  });
  db = (await import('@/db')).db;
  schema = await import('@/db/schema');
  backup = await import('@/lib/backup');
  queue = await import('@/lib/queue');
  jobs = await import('@/lib/jobs');
  receipts = await import('@/lib/services/receipts');
  imports = await import('@/lib/services/imports');
  matching = await import('@/lib/services/matching');
  org = await import('@/lib/services/org');
  session = await import('@/lib/auth/session');
  storage = await import('@/lib/storage');
  pdf = await import('@/lib/demo/pdf');
  ids = await import('@/lib/ids');

  // A realistic workspace: an account, receipts, a bank import, matches, audit trail.
  const userId = ids.newId('usr');
  await db.insert(schema.users).values({
    id: userId,
    email: EMAIL,
    passwordHash: await session.hashPassword('passphrase-1234'),
    name: 'Backup Owner',
    emailVerifiedAt: new Date('2026-09-01T10:00:00Z'),
  });
  const organizationId = await org.provisionOrganization('Backup Ltd', userId);
  ctx = { userId, email: EMAIL, name: 'Backup Owner', persona: null, onboardedAt: null, emailVerified: true, organizationId, organizationName: 'Backup Ltd', role: 'owner' };

  await imports.commitImport(ctx, {
    filename: 'bank.csv',
    content: 'date,description,amount,currency\n2026-09-28,POS CARREFOUR MARKET,-47.85,EUR\n2026-09-27,AMAZON EU,-39.99,EUR',
    mapping: { date: 'date', description: 'description', amount: 'amount', currency: 'currency' },
    bankAccountName: 'Main',
    force: true,
  });
  for (const [name, total] of [['Carrefour', '47.85'], ['Amazon', '39.99']] as const) {
    await receipts.ingestReceiptNow(
      ctx,
      storage.validateUpload(pdf.makeReceiptPdf([name, 'Date: 2026-09-28', `Invoice No: INV-${name.length}`, `Total: EUR ${total}`]), `${name}.pdf`, 'application/pdf'),
    );
  }
  await matching.matchReceipts(ctx);
}, 60_000);

afterAll(async () => {
  await (await import('@/db')).closeDb();
  fs.rmSync(workdir, { recursive: true, force: true });
});

const TABLES = () => [...backup.backedUpTableNames()];

async function rowCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of TABLES()) {
    const result = await db.execute(sql.raw(`select count(*)::int as n from "${table}"`));
    counts[table] = (result.rows as unknown as Array<{ n: number }>)[0].n;
  }
  return counts;
}

describe('what is backed up', () => {
  it('covers every table in the schema: each is either backed up or deliberately excluded', () => {
    const all = backup.schemaTableNames().sort();
    const accounted = [...backup.backedUpTableNames(), ...backup.excludedTableNames()].sort();
    // A failure here means someone added a table without deciding whether it needs a backup.
    expect(accounted).toEqual(all);
  });

  it('never backs up sessions or one-time tokens', () => {
    for (const secret of ['sessions', 'password_reset_tokens', 'email_verification_tokens']) {
      expect(backup.backedUpTableNames()).not.toContain(secret);
    }
  });
});

describe('encryption', () => {
  const key = Buffer.alloc(32, 7);

  it('round-trips', () => {
    const plain = Buffer.from('some financial data');
    expect(backup.decrypt(backup.encrypt(plain, key), key).toString()).toBe('some financial data');
  });

  it('refuses the wrong key', () => {
    expect(() => backup.decrypt(backup.encrypt(Buffer.from('x'), key), Buffer.alloc(32, 8))).toThrow(/could not decrypt/i);
  });

  it('detects tampering', () => {
    const file = backup.encrypt(Buffer.from('important'), key);
    file[file.length - 1] ^= 0xff;
    expect(() => backup.decrypt(file, key)).toThrow(/could not decrypt/i);
  });

  it('rejects a file that is not a backup', () => {
    expect(() => backup.decrypt(Buffer.from('definitely not a backup file at all, just text'), key)).toThrow(/not a Reclip backup/i);
  });

  it('uses a fresh nonce each time', () => {
    const a = backup.encrypt(Buffer.from('same'), key);
    const b = backup.encrypt(Buffer.from('same'), key);
    expect(a.equals(b)).toBe(false);
  });

  it('refuses to make a backup without a valid key', async () => {
    const saved = process.env.BACKUP_ENCRYPTION_KEY;
    try {
      delete process.env.BACKUP_ENCRYPTION_KEY;
      await expect(backup.createBackup()).rejects.toThrow(/BACKUP_ENCRYPTION_KEY is not set/);
      process.env.BACKUP_ENCRYPTION_KEY = 'too-short';
      await expect(backup.createBackup()).rejects.toThrow(/32 bytes/);
    } finally {
      process.env.BACKUP_ENCRYPTION_KEY = saved;
    }
    expect(await backup.listBackups()).toHaveLength(0); // nothing was written
  });
});

describe('create, wipe, restore', () => {
  it('restores the data exactly, from an encrypted file that reveals nothing', async () => {
    const before = await rowCounts();
    expect(before.users).toBe(1);
    expect(before.receipts).toBe(2);
    expect(before.transactions).toBe(2);
    expect(before.matches).toBeGreaterThan(0);
    const sampleReceipt = (await db.select().from(schema.receipts).where(eq(schema.receipts.organizationId, ctx.organizationId)).orderBy(schema.receipts.id))[0];
    const sampleExtraction = (await db.select().from(schema.receiptExtractions).orderBy(schema.receiptExtractions.id))[0];
    const sampleTxn = (await db.select().from(schema.transactions).orderBy(schema.transactions.id))[0];
    const sampleUser = (await db.select().from(schema.users))[0];

    const made = await backup.createBackup();
    expect(made.rows.receipts).toBe(2);

    // The file on disk is ciphertext: none of the personal data is readable in it.
    const onDisk = fs.readFileSync(path.join(storageDir, made.key));
    expect(onDisk.subarray(0, 5).toString()).toBe('RCBK1');
    for (const secret of [EMAIL, 'Carrefour', 'Backup Owner', sampleUser.passwordHash]) {
      expect(onDisk.includes(Buffer.from(secret))).toBe(false);
    }

    // Disaster: everything is gone.
    await db.delete(schema.organizations);
    await db.delete(schema.users);
    expect((await rowCounts()).users).toBe(0);

    const restored = await backup.restoreBackupByName(made.key);
    expect(restored.rows.receipts).toBe(2);

    expect(await rowCounts()).toEqual(before);
    const after = {
      receipt: (await db.select().from(schema.receipts).where(eq(schema.receipts.id, sampleReceipt.id)))[0],
      extraction: (await db.select().from(schema.receiptExtractions).where(eq(schema.receiptExtractions.id, sampleExtraction.id)))[0],
      txn: (await db.select().from(schema.transactions).where(eq(schema.transactions.id, sampleTxn.id)))[0],
      user: (await db.select().from(schema.users).where(eq(schema.users.id, sampleUser.id)))[0],
    };
    // Dates come back as Dates, booleans as booleans, numbers as numbers: whole rows are identical.
    expect(after.receipt).toEqual(sampleReceipt);
    expect(after.extraction).toEqual(sampleExtraction);
    expect(after.txn).toEqual(sampleTxn);
    expect(after.user).toEqual(sampleUser);
    expect(after.user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(typeof after.receipt.isDuplicate).toBe('boolean');
  }, 60_000);

  it('can log in after a restore: the password hash survived', async () => {
    const user = (await db.select().from(schema.users).where(eq(schema.users.email, EMAIL)))[0];
    expect(await session.verifyPassword('passphrase-1234', user.passwordHash)).toBe(true);
  });

  it('refuses to restore over a database that already has data', async () => {
    const [name] = await backup.listBackups();
    await expect(backup.restoreBackupByName(name)).rejects.toThrow(/already has data/i);
    expect((await rowCounts()).users).toBe(1); // untouched
  });

  it('is atomic: a corrupt backup leaves an empty database empty', async () => {
    const key = backup.backupKey();
    const zlib = await import('node:zlib');
    const broken = backup.encrypt(zlib.gzipSync(Buffer.from(JSON.stringify({ format: 1, createdAt: 'x', tables: { organizations: [{ id: 'org_x', name: 'X', createdAt: 'not-a-date' }], users: [{ nope: 1 }] } }))), key);

    await db.delete(schema.organizations);
    await db.delete(schema.users);
    await expect(backup.restoreBackup(broken)).rejects.toThrow();
    expect((await rowCounts()).organizations).toBe(0); // the first table's rows were rolled back

    // put the data back for any later test
    const [name] = await backup.listBackups();
    await backup.restoreBackupByName(name);
  });

  it('refuses a backup from a different format version', async () => {
    const zlib = await import('node:zlib');
    const future = backup.encrypt(zlib.gzipSync(Buffer.from(JSON.stringify({ format: 99, createdAt: 'x', tables: {} }))), backup.backupKey());
    await db.delete(schema.organizations);
    await db.delete(schema.users);
    await expect(backup.restoreBackup(future)).rejects.toThrow(/format 99/);
    const [name] = await backup.listBackups();
    await backup.restoreBackupByName(name);
  });
});

describe('retention', () => {
  it('keeps the newest N and deletes the rest', async () => {
    for (const day of ['01', '02', '03', '04', '05']) {
      await storage.putBackupObject(`backups/backup-202601${day}T020000Z.rcbk`, Buffer.from('x'));
    }
    const removed = await backup.pruneBackups(3);
    const left = await backup.listBackups();
    expect(left).toHaveLength(3);
    expect(left[0] > removed[removed.length - 1]).toBe(true); // what is kept is newer than what went
    expect(left.at(-1)).toMatch(/^backups\/backup-2026\d{4}T\d{6}Z\.rcbk$/);
  });

  it('never deletes the last backup, whatever the setting', async () => {
    await backup.pruneBackups(0);
    expect((await backup.listBackups()).length).toBe(1);
  });

  it('cannot touch documents: backup keys must live under backups/', async () => {
    await expect(storage.deleteBackupObject(`${ctx.organizationId}/some-receipt.pdf`)).rejects.toThrow(/backup/i);
    await expect(storage.getBackupObject('../outside')).rejects.toThrow();
  });
});

describe('the daily job', () => {
  it('is scheduled once per day however many instances ask', async () => {
    jobs.registerAllJobs();
    await db.delete(schema.jobs);
    const id = 'backup_2026-10-20';
    await Promise.all([1, 2, 3].map(() => queue.enqueue(jobs.BACKUP_JOB, {}, { id })));
    expect(await db.select().from(schema.jobs)).toHaveLength(1);
  });

  it('runs through the queue and writes a backup', async () => {
    jobs.registerAllJobs();
    await db.delete(schema.jobs);
    const before = (await backup.listBackups()).length;
    await queue.enqueue(jobs.BACKUP_JOB, {}, { id: 'backup_2026-10-21' });
    await queue.runNextJob();

    const [job] = await db.select().from(schema.jobs);
    expect(job.status).toBe('done');
    expect((await backup.listBackups()).length).toBeGreaterThanOrEqual(before); // written (and pruned to the retention limit)
    expect(await backup.latestBackupAgeHours()).toBeLessThan(1);
  });
});
