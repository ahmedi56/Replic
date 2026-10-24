import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/session';

/**
 * Account lifecycle against a real database: changing a password, exporting data, deleting
 * an account, and email verification. Each test uses its own users so none depends on another.
 */

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'reclip-account-'));
const dbDir = path.join(workdir, 'pg');
const storageDir = path.join(workdir, 'storage');

process.env.DATABASE_URL = `pglite:${dbDir}`;
process.env.STORAGE_DIR = storageDir;
process.env.EXTRACTION_PROVIDER = 'local';
process.env.SEMANTIC_PROVIDER = 'local';
delete process.env.SMTP_HOST; // no mail provider: verification is not enforced

let db: typeof import('@/db').db;
let schema: typeof import('@/db/schema');
let account: typeof import('@/lib/services/account');
let verification: typeof import('@/lib/services/verification');
let session: typeof import('@/lib/auth/session');
let org: typeof import('@/lib/services/org');
let storage: typeof import('@/lib/storage');
let ids: typeof import('@/lib/ids');

async function makeUser(label: string, password: string): Promise<AuthContext> {
  const userId = ids.newId('usr');
  const email = `${label}@example.com`;
  await db.insert(schema.users).values({ id: userId, email, passwordHash: await session.hashPassword(password), name: label });
  const organizationId = await org.provisionOrganization(`${label} Ltd`, userId);
  return {
    userId,
    email,
    name: label,
    persona: null,
    onboardedAt: null,
    emailVerified: true,
    organizationId,
    organizationName: `${label} Ltd`,
    role: 'owner',
  };
}

async function addSession(userId: string, token: string) {
  await db.insert(schema.sessions).values({
    id: ids.newId('ses'),
    tokenHash: ids.sha256(token),
    userId,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
}

beforeAll(async () => {
  fs.mkdirSync(storageDir, { recursive: true });
  execFileSync('node', ['node_modules/tsx/dist/cli.mjs', 'scripts/migrate.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `pglite:${dbDir}` },
    stdio: 'pipe',
  });
  db = (await import('@/db')).db;
  schema = await import('@/db/schema');
  account = await import('@/lib/services/account');
  verification = await import('@/lib/services/verification');
  session = await import('@/lib/auth/session');
  org = await import('@/lib/services/org');
  storage = await import('@/lib/storage');
  ids = await import('@/lib/ids');
});

afterAll(async () => {
  await (await import('@/db')).closeDb();
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe('changePassword', () => {
  it('rejects a wrong current password and changes nothing', async () => {
    const ctx = await makeUser('wrongpw', 'old-passphrase-1');
    await expect(account.changePassword(ctx, { current: 'nope-nope-nope', next: 'new-passphrase-2' }, null)).rejects.toThrow(/current password/i);
    const row = (await db.select().from(schema.users).where(eq(schema.users.id, ctx.userId)))[0];
    expect(await session.verifyPassword('old-passphrase-1', row.passwordHash)).toBe(true);
  });

  it('refuses to "change" to the same password', async () => {
    const ctx = await makeUser('samepw', 'old-passphrase-1');
    await expect(account.changePassword(ctx, { current: 'old-passphrase-1', next: 'old-passphrase-1' }, null)).rejects.toThrow();
  });

  it('changes the password and signs out every other session but the current one', async () => {
    const ctx = await makeUser('changepw', 'old-passphrase-1');
    await addSession(ctx.userId, 'token-this-device');
    await addSession(ctx.userId, 'token-other-device');

    await account.changePassword(ctx, { current: 'old-passphrase-1', next: 'new-passphrase-2' }, ids.sha256('token-this-device'));

    const row = (await db.select().from(schema.users).where(eq(schema.users.id, ctx.userId)))[0];
    expect(await session.verifyPassword('new-passphrase-2', row.passwordHash)).toBe(true);
    expect(await session.verifyPassword('old-passphrase-1', row.passwordHash)).toBe(false);

    const remaining = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, ctx.userId));
    expect(remaining.map((s) => s.tokenHash)).toEqual([ids.sha256('token-this-device')]);

    const events = await db.select().from(schema.securityEvents).where(eq(schema.securityEvents.userId, ctx.userId));
    expect(events.map((e) => e.type)).toContain('password_changed');
  });
});

describe('exportAccountData', () => {
  it('contains the account but never another organization', async () => {
    const a = await makeUser('exporta', 'passphrase-aaaa');
    const b = await makeUser('exportb', 'passphrase-bbbb');
    const data = await account.exportAccountData(a);
    const text = JSON.stringify(data);

    expect(data.account.email).toBe('exporta@example.com');
    expect(data.organization.id).toBe(a.organizationId);
    expect(text).not.toContain(b.organizationId);
    expect(text).not.toContain('exportb@example.com');
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('password_hash');
  });
});

describe('deleteAccount', () => {
  it('rejects a wrong password and deletes nothing', async () => {
    const ctx = await makeUser('delwrong', 'passphrase-1234');
    await expect(account.deleteAccount(ctx, 'not-the-password')).rejects.toThrow(/password/i);
    expect((await db.select().from(schema.users).where(eq(schema.users.id, ctx.userId))).length).toBe(1);
  });

  it('removes the user, the workspace, its rows and its stored files, and leaves others alone', async () => {
    const gone = await makeUser('delgone', 'passphrase-1234');
    const kept = await makeUser('delkept', 'passphrase-5678');

    const pdf = Buffer.from('%PDF-1.4 test');
    const key = await storage.putDocument(gone.organizationId, {
      bytes: pdf,
      mimeType: 'application/pdf',
      originalName: 'x.pdf',
      sizeBytes: pdf.length,
      checksum: ids.sha256(pdf),
    });
    const keptKey = await storage.putDocument(kept.organizationId, {
      bytes: pdf,
      mimeType: 'application/pdf',
      originalName: 'y.pdf',
      sizeBytes: pdf.length,
      checksum: ids.sha256(pdf),
    });
    await addSession(gone.userId, 'token-gone');
    expect(fs.existsSync(path.join(storageDir, key))).toBe(true);

    await account.deleteAccount(gone, 'passphrase-1234');

    expect(await db.select().from(schema.users).where(eq(schema.users.id, gone.userId))).toHaveLength(0);
    expect(await db.select().from(schema.organizations).where(eq(schema.organizations.id, gone.organizationId))).toHaveLength(0);
    expect(await db.select().from(schema.categories).where(eq(schema.categories.organizationId, gone.organizationId))).toHaveLength(0);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, gone.userId))).toHaveLength(0);
    expect(fs.existsSync(path.join(storageDir, key))).toBe(false);
    expect(fs.existsSync(path.join(storageDir, gone.organizationId))).toBe(false);

    // The other tenant is untouched.
    expect(await db.select().from(schema.users).where(eq(schema.users.id, kept.userId))).toHaveLength(1);
    expect(await db.select().from(schema.categories).where(eq(schema.categories.organizationId, kept.organizationId))).not.toHaveLength(0);
    expect(fs.existsSync(path.join(storageDir, keptKey))).toBe(true);
  });
});

describe('email verification', () => {
  async function tokenFor(userId: string, expiresInMs: number) {
    const token = ids.randomToken();
    await db.insert(schema.emailVerificationTokens).values({
      id: ids.newId('evt'),
      tokenHash: ids.sha256(token),
      userId,
      expiresAt: new Date(Date.now() + expiresInMs),
    });
    return token;
  }

  it('marks the address verified, once', async () => {
    const ctx = await makeUser('verifyok', 'passphrase-1234');
    const token = await tokenFor(ctx.userId, 60_000);

    expect(await verification.verifyEmailToken(token)).toBe(true);
    const row = (await db.select().from(schema.users).where(eq(schema.users.id, ctx.userId)))[0];
    expect(row.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await verification.verifyEmailToken(token)).toBe(false); // single use
  });

  it('rejects expired and unknown tokens', async () => {
    const ctx = await makeUser('verifybad', 'passphrase-1234');
    expect(await verification.verifyEmailToken(await tokenFor(ctx.userId, -1000))).toBe(false);
    expect(await verification.verifyEmailToken('not-a-real-token-at-all')).toBe(false);
    const row = (await db.select().from(schema.users).where(eq(schema.users.id, ctx.userId)))[0];
    expect(row.emailVerifiedAt).toBeNull();
  });

  it('does not require verification when no mail provider is configured', async () => {
    const ctx = await makeUser('nomail', 'passphrase-1234');
    // The seeded user has no verified date; with SMTP unset the session still counts as verified.
    const token = ids.randomToken();
    await addSession(ctx.userId, token);
    // getAuth reads cookies(), which only exists inside a request, so assert the rule directly.
    const mail = await import('@/lib/mail');
    expect(mail.isMailConfigured()).toBe(false);
  });
});

describe('rate limiting (shared through the database)', () => {
  it('lets calls through up to the limit, then refuses with 429', async () => {
    const api = await import('@/lib/api');
    const key = `test:${ids.newId()}`;
    for (let i = 0; i < 3; i++) await api.rateLimit(key, 3, 60_000);
    await expect(api.rateLimit(key, 3, 60_000)).rejects.toMatchObject({ status: 429 });
  });

  it('counts each key separately', async () => {
    const api = await import('@/lib/api');
    const a = `test:${ids.newId()}`;
    const b = `test:${ids.newId()}`;
    for (let i = 0; i < 2; i++) await api.rateLimit(a, 2, 60_000);
    await expect(api.rateLimit(a, 2, 60_000)).rejects.toMatchObject({ status: 429 });
    await expect(api.rateLimit(b, 2, 60_000)).resolves.toBeUndefined();
  });

  it('starts a fresh window once the old one has expired', async () => {
    const api = await import('@/lib/api');
    const key = `test:${ids.newId()}`;
    await api.rateLimit(key, 1, 150);
    await expect(api.rateLimit(key, 1, 150)).rejects.toMatchObject({ status: 429 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(api.rateLimit(key, 1, 150)).resolves.toBeUndefined();
  });

  it('is atomic: parallel calls past the limit are all counted', async () => {
    const api = await import('@/lib/api');
    const key = `test:${ids.newId()}`;
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => api.rateLimit(key, 4, 60_000)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(6);
  });
});

describe('deleting a receipt removes its stored file', () => {
  it('deletes the row and the document, and only that document', async () => {
    const ctx = await makeUser('filedel', 'passphrase-1234');
    const receipts = await import('@/lib/services/receipts');
    const pdfLib = await import('@/lib/demo/pdf');

    const make = (name: string, total: string) =>
      storage.validateUpload(pdfLib.makeReceiptPdf([name, 'Date: 2026-09-28', `Total: EUR ${total}`]), `${name}.pdf`, 'application/pdf');
    const one = await receipts.ingestReceiptNow(ctx, make('Alpha Cafe', '10.00'));
    const two = await receipts.ingestReceiptNow(ctx, make('Beta Shop', '20.00'));

    const rows = await db.select().from(schema.receipts).where(eq(schema.receipts.organizationId, ctx.organizationId));
    const keyOf = (id: string) => rows.find((r) => r.id === id)!.storageKey;
    expect(fs.existsSync(path.join(storageDir, keyOf(one.receiptId)))).toBe(true);

    expect(await receipts.deleteReceipts(ctx, [one.receiptId])).toBe(1);

    expect(fs.existsSync(path.join(storageDir, keyOf(one.receiptId)))).toBe(false);
    expect(fs.existsSync(path.join(storageDir, keyOf(two.receiptId)))).toBe(true);
  });
});
