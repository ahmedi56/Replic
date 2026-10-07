import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/session';

/**
 * Tenant isolation, asserted against a real database.
 *
 * The claim being tested is the one that matters most in a product holding other people's
 * financial documents: there is no query path that returns one organization's data to
 * another. Rather than trusting a code review of the `where` clauses, this builds two
 * organizations with near-identical data and checks every read path from both sides.
 */

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'reclip-test-'));
const dbFile = path.join(workdir, 'test.db');
const storageDir = path.join(workdir, 'storage');

process.env.DATABASE_URL = `file:${dbFile}`;
process.env.STORAGE_DIR = storageDir;
process.env.EXTRACTION_PROVIDER = 'local';
process.env.SEMANTIC_PROVIDER = 'local';

type Ctx = AuthContext;

let orgA: Ctx;
let orgB: Ctx;
let receiptA: string;
let receiptB: string;
let storageKeyA: string;

let db: typeof import('@/db').db;
let schema: typeof import('@/db/schema');
let services: {
  ingestReceipt: typeof import('@/lib/services/receipts').ingestReceipt;
  listReceipts: typeof import('@/lib/services/receipts').listReceipts;
  getReceipt: typeof import('@/lib/services/receipts').getReceipt;
  deleteReceipts: typeof import('@/lib/services/receipts').deleteReceipts;
  commitImport: typeof import('@/lib/services/imports').commitImport;
  listTransactions: typeof import('@/lib/services/imports').listTransactions;
  matchReceipts: typeof import('@/lib/services/matching').matchReceipts;
  listMatches: typeof import('@/lib/services/matching').listMatches;
  listMatchesForReceipt: typeof import('@/lib/services/matching').listMatchesForReceipt;
  confirmMatch: typeof import('@/lib/services/matching').confirmMatch;
  createManualMatch: typeof import('@/lib/services/matching').createManualMatch;
  suggestTransactionsForReceipt: typeof import('@/lib/services/matching').suggestTransactionsForReceipt;
  getDashboardStats: typeof import('@/lib/services/stats').getDashboardStats;
  buildExportCsv: typeof import('@/lib/services/export').buildExportCsv;
  provisionOrganization: typeof import('@/lib/services/org').provisionOrganization;
  getDocument: typeof import('@/lib/storage').getDocument;
  validateUpload: typeof import('@/lib/storage').validateUpload;
  makeReceiptPdf: typeof import('@/lib/demo/pdf').makeReceiptPdf;
  newId: typeof import('@/lib/ids').newId;
};

const CSV = `date,description,amount,currency
2026-09-28,POS CARREFOUR,-47.85,EUR
2026-09-27,AMAZON EU,-39.99,EUR`;

function receiptPdf(merchant: string, total: number) {
  return services.makeReceiptPdf([
    merchant.toUpperCase(),
    'Test address',
    '',
    'Invoice No: INV-90001',
    'Date: 28 Sep 2026',
    '',
    `TOTAL                EUR ${total.toFixed(2)}`,
    '',
    'Paid by VISA',
    'Currency: EUR',
  ]);
}

beforeAll(async () => {
  fs.mkdirSync(storageDir, { recursive: true });
  // Build the schema in the temp database using the real migration path.
  execFileSync('node', ['node_modules/tsx/dist/cli.mjs', 'scripts/migrate.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
    stdio: 'pipe',
  });

  db = (await import('@/db')).db;
  schema = await import('@/db/schema');
  services = {
    ...(await import('@/lib/services/receipts')),
    ...(await import('@/lib/services/imports')),
    ...(await import('@/lib/services/matching')),
    ...(await import('@/lib/services/stats')),
    ...(await import('@/lib/services/export')),
    ...(await import('@/lib/services/org')),
    ...(await import('@/lib/storage')),
    ...(await import('@/lib/demo/pdf')),
    ...(await import('@/lib/ids')),
  } as typeof services;

  async function makeOrg(label: string): Promise<Ctx> {
    const userId = services.newId('usr');
    await db.insert(schema.users).values({ id: userId, email: `${label}@example.com`, passwordHash: 'x', name: label });
    const organizationId = await services.provisionOrganization(`${label} Ltd`, userId);
    return {
      userId,
      email: `${label}@example.com`,
      name: label,
      persona: null,
      onboardedAt: null,
      organizationId,
      organizationName: `${label} Ltd`,
      role: 'owner',
    };
  }

  orgA = await makeOrg('alpha');
  orgB = await makeOrg('beta');

  // Both organizations get deliberately similar data, so a leak would be visible.
  for (const [ctx, merchant] of [
    [orgA, 'Carrefour'],
    [orgB, 'Carrefour'],
  ] as const) {
    await services.commitImport(ctx, {
      filename: 'statement.csv',
      content: CSV,
      mapping: { date: 'date', description: 'description', amount: 'amount', currency: 'currency' },
      bankAccountName: 'Main',
      force: true,
    });
    const file = services.validateUpload(receiptPdf(merchant, 47.85), `${merchant}.pdf`, 'application/pdf');
    const result = await services.ingestReceipt(ctx, file);
    if (ctx === orgA) receiptA = result.receiptId;
    else receiptB = result.receiptId;
  }

  const rowA = await services.getReceipt(orgA.organizationId, receiptA);
  storageKeyA = rowA!.receipt.storageKey;
});

afterAll(() => {
  // Windows refuses to delete a SQLite file while a connection is still open.
  db.$client.close();
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe('the fixture itself is sound', () => {
  it('gave each organization its own data', async () => {
    const a = await services.listReceipts(orgA.organizationId);
    const b = await services.listReceipts(orgB.organizationId);
    expect(a.total).toBe(1);
    expect(b.total).toBe(1);
    expect(a.rows[0].id).not.toBe(b.rows[0].id);
  });

  it('extracted and matched within each organization', async () => {
    const stats = await services.getDashboardStats(orgA.organizationId);
    expect(stats.receipts).toBe(1);
    expect(stats.transactions).toBe(2);
    expect(stats.matched).toBe(1); // the Carrefour receipt found the Carrefour transaction
  });
});

describe('tenant isolation', () => {
  it('does not return another organization’s receipt by id', async () => {
    expect(await services.getReceipt(orgB.organizationId, receiptA)).toBeNull();
    expect(await services.getReceipt(orgA.organizationId, receiptB)).toBeNull();
  });

  it('does not list another organization’s receipts', async () => {
    const list = await services.listReceipts(orgB.organizationId, { pageSize: 100 });
    expect(list.rows.map((r) => r.id)).not.toContain(receiptA);
  });

  it('does not list another organization’s transactions', async () => {
    const a = await services.listTransactions(orgA.organizationId, { pageSize: 100 });
    const b = await services.listTransactions(orgB.organizationId, { pageSize: 100 });
    const overlap = a.rows.map((r) => r.id).filter((id) => b.rows.some((r) => r.id === id));
    expect(overlap).toHaveLength(0);
  });

  it('does not list another organization’s matches', async () => {
    const a = await services.listMatches(orgA.organizationId, { pageSize: 100 });
    const b = await services.listMatches(orgB.organizationId, { pageSize: 100 });
    expect(a.rows.length).toBeGreaterThan(0);
    const overlap = a.rows.map((r) => r.matchId).filter((id) => b.rows.some((r) => r.matchId === id));
    expect(overlap).toHaveLength(0);
  });

  it('never matches a receipt to another organization’s transaction', async () => {
    await services.matchReceipts(orgA);
    const rows = await db.select().from(schema.matches);
    for (const match of rows) {
      const receipt = await db.select().from(schema.receipts).where(eq(schema.receipts.id, match.receiptId));
      const transaction = await db.select().from(schema.transactions).where(eq(schema.transactions.id, match.transactionId));
      expect(receipt[0].organizationId).toBe(match.organizationId);
      expect(transaction[0].organizationId).toBe(match.organizationId);
    }
  });

  it('refuses to serve another organization’s stored document', async () => {
    await expect(services.getDocument(orgB.organizationId, storageKeyA)).rejects.toThrow(/not allowed/i);
    // The owner can still read it, so the check isn't simply failing for everyone.
    await expect(services.getDocument(orgA.organizationId, storageKeyA)).resolves.toBeInstanceOf(Buffer);
  });

  it('refuses to delete another organization’s receipt', async () => {
    const deleted = await services.deleteReceipts(orgB, [receiptA]);
    expect(deleted).toBe(0);
    expect(await services.getReceipt(orgA.organizationId, receiptA)).not.toBeNull();
  });

  it('refuses to manually match across organizations', async () => {
    const foreign = await services.listTransactions(orgB.organizationId, { pageSize: 1 });
    await expect(services.createManualMatch(orgA, receiptA, foreign.rows[0].id)).rejects.toThrow(/not found/i);
  });

  it('does not offer another organization’s transactions as match candidates', async () => {
    const foreign = await services.listTransactions(orgB.organizationId, { pageSize: 100 });
    const candidates = await services.suggestTransactionsForReceipt(orgA.organizationId, receiptA);
    const foreignIds = new Set(foreign.rows.map((r) => r.id));
    expect(candidates.some((c) => foreignIds.has(c.transaction.id))).toBe(false);
  });

  it('does not include another organization’s rows in an export', async () => {
    const csv = await services.buildExportCsv(orgB, 'all');
    expect(csv).not.toContain(receiptA);
    expect(csv).toContain(receiptB);
  });

  it('counts only its own organization in dashboard stats', async () => {
    const a = await services.getDashboardStats(orgA.organizationId);
    const b = await services.getDashboardStats(orgB.organizationId);
    expect(a.receipts).toBe(1);
    expect(b.receipts).toBe(1);
    expect(a.transactions).toBe(2);
    expect(b.transactions).toBe(2);
  });
});

describe('duplicate protection across the real pipeline', () => {
  it('blocks re-importing the identical statement', async () => {
    await expect(
      services.commitImport(orgA, {
        filename: 'statement.csv',
        content: CSV,
        mapping: { date: 'date', description: 'description', amount: 'amount', currency: 'currency' },
        bankAccountName: 'Main',
      }),
    ).rejects.toThrow(/already imported/i);
  });

  it('imports an overlapping statement without duplicating the shared rows', async () => {
    const overlapping = `${CSV}\n2026-09-26,UBER,-18.20,EUR`;
    const result = await services.commitImport(orgA, {
      filename: 'statement-extended.csv',
      content: overlapping,
      mapping: { date: 'date', description: 'description', amount: 'amount', currency: 'currency' },
      bankAccountName: 'Main',
    });
    expect(result.imported).toBe(1); // only the new row
    expect(result.skippedDuplicates).toBe(2);
  });

  it('flags a byte-identical receipt re-upload', async () => {
    const file = services.validateUpload(receiptPdf('Carrefour', 47.85), 'Carrefour.pdf', 'application/pdf');
    const result = await services.ingestReceipt(orgA, file);
    expect(result.duplicateOf).toBe(receiptA);
    expect(result.status).toBe('needs_review');
  });

  it('does not treat another organization’s identical receipt as a duplicate', async () => {
    const before = await services.getReceipt(orgB.organizationId, receiptB);
    expect(before!.receipt.isDuplicate).toBe(false);
  });
});



describe('review queue quality', () => {
  /**
   * Regression: a receipt that auto-matched at high confidence was also parking its
   * runner-up in the review queue, so a settled receipt still cost the user a decision.
   * Runner-ups are kept as `alternate` — offered on the detail page, never queued.
   */
  it('queues only the winning pair, keeping runner-ups as alternates', async () => {
    const userId = services.newId('usr');
    await db.insert(schema.users).values({ id: userId, email: 'queue@example.com', passwordHash: 'x', name: 'Queue' });
    const organizationId = await services.provisionOrganization('Queue Ltd', userId);
    const ctx: Ctx = {
      userId,
      email: 'queue@example.com',
      name: 'Queue',
      persona: null,
      onboardedAt: null,
      organizationId,
      organizationName: 'Queue Ltd',
      role: 'owner',
    };

    // Two transactions the same receipt could plausibly belong to.
    await services.commitImport(ctx, {
      filename: 'two-candidates.csv',
      content: `date,description,amount,currency
2026-09-28,POS CARREFOUR MARKET TUNIS,-47.85,EUR
2026-09-27,SEPA DD ASSURANCE HABITATION,-48.00,EUR`,
      mapping: { date: 'date', description: 'description', amount: 'amount', currency: 'currency' },
      bankAccountName: 'Main',
      force: true,
    });

    const file = services.validateUpload(receiptPdf('Carrefour', 47.85), 'carrefour.pdf', 'application/pdf');
    const { receiptId } = await services.ingestReceipt(ctx, file);

    const all = await services.listMatchesForReceipt(organizationId, receiptId);
    const best = all.find((m) => m.status === 'auto' || m.status === 'confirmed');
    expect(best).toBeDefined();
    expect(best!.descriptionRaw).toContain('CARREFOUR');

    // The weaker candidate exists, but not as something awaiting a decision.
    const others = all.filter((m) => m.matchId !== best!.matchId);
    expect(others.every((m) => m.status === 'alternate')).toBe(true);

    const queue = await services.listMatches(organizationId, { status: 'review', pageSize: 50 });
    expect(queue.rows.map((r) => r.receiptId)).not.toContain(receiptId);

    // And the receipt does not show up as unmatched either.
    const stats = await services.getDashboardStats(organizationId);
    expect(stats.matched).toBe(1);
    expect(stats.needsReview).toBe(0);
    expect(stats.unmatchedReceipts).toBe(0);
  });
});
