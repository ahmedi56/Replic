import 'server-only';
import { and, eq, inArray, desc, sql } from 'drizzle-orm';
import { db } from '@/db';
import { transactions, imports, bankAccounts, categories } from '@/db/schema';
import { newId } from '../ids';
import { checksum, parseRows, type ColumnMapping, type DateOrder } from '../import/csv';
import { suggestCategory } from './categorize';
import { recordAudit } from '../audit';
import { ApiError } from '../api';
import type { AuthContext } from '../auth/session';

export interface CommitImportOptions {
  filename: string;
  content: string;
  mapping: ColumnMapping;
  bankAccountId?: string | null;
  bankAccountName?: string;
  defaultCurrency?: string;
  dateOrder?: DateOrder;
  invertAmounts?: boolean;
  /** Set when the user has seen the "already imported" warning and wants to proceed. */
  force?: boolean;
}

export interface CommitImportResult {
  importId: string;
  imported: number;
  skippedDuplicates: number;
  issues: Array<{ rowNumber: number; reason: string }>;
}

/**
 * Commit a parsed CSV.
 *
 * Two layers of duplicate protection: the file checksum blocks re-importing the same
 * statement outright, and per-row fingerprints mean that even a *different* export
 * covering an overlapping period only adds the rows that are genuinely new.
 */
export async function commitImport(auth: AuthContext, options: CommitImportOptions): Promise<CommitImportResult> {
  const fileChecksum = checksum(options.content);

  if (!options.force) {
    const previous = await db
      .select({ id: imports.id, createdAt: imports.createdAt, filename: imports.filename })
      .from(imports)
      .where(and(eq(imports.organizationId, auth.organizationId), eq(imports.checksum, fileChecksum)))
      .limit(1);

    if (previous[0]) {
      await recordAudit({
        organizationId: auth.organizationId,
        userId: auth.userId,
        actorLabel: auth.name ?? auth.email,
        action: 'import.blocked_duplicate',
        entityType: 'import',
        entityId: previous[0].id,
        detail: options.filename,
      });
      throw new ApiError(
        409,
        `This exact file was already imported on ${previous[0].createdAt.toLocaleDateString('en-GB')}. Import it again anyway?`,
        'duplicate_import',
      );
    }
  }

  let bankAccountId = options.bankAccountId ?? null;
  if (!bankAccountId) {
    const name = options.bankAccountName?.trim() || 'Main account';
    const existing = await db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.organizationId, auth.organizationId), eq(bankAccounts.name, name)))
      .limit(1);
    if (existing[0]) bankAccountId = existing[0].id;
    else {
      bankAccountId = newId('bnk');
      await db.insert(bankAccounts).values({
        id: bankAccountId,
        organizationId: auth.organizationId,
        name,
        currency: (options.defaultCurrency ?? 'EUR').toUpperCase(),
      });
    }
  } else {
    // A supplied id must belong to the caller's organization.
    const owned = await db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.organizationId, auth.organizationId)))
      .limit(1);
    if (!owned[0]) throw new ApiError(403, 'Unknown bank account');
  }

  const { rows, issues } = parseRows(options.content, {
    mapping: options.mapping,
    defaultCurrency: options.defaultCurrency,
    dateOrder: options.dateOrder,
    bankAccountId,
    invertAmounts: options.invertAmounts,
  });

  if (!rows.length) {
    throw new ApiError(400, issues[0]?.reason ?? 'No transactions could be read from this file', 'no_rows');
  }

  // Rows already present from an earlier, overlapping export.
  const existingFingerprints = new Set(
    (
      await db
        .select({ fingerprint: transactions.fingerprint })
        .from(transactions)
        .where(
          and(
            eq(transactions.organizationId, auth.organizationId),
            inArray(
              transactions.fingerprint,
              rows.map((r) => r.fingerprint),
            ),
          ),
        )
    ).map((r) => r.fingerprint),
  );

  const fresh = rows.filter((r) => !existingFingerprints.has(r.fingerprint));

  const importId = newId('imp');
  await db.insert(imports).values({
    id: importId,
    organizationId: auth.organizationId,
    bankAccountId,
    filename: options.filename,
    checksum: fileChecksum,
    rowCount: rows.length,
    importedCount: fresh.length,
    skippedCount: rows.length - fresh.length,
    columnMapping: JSON.stringify(options.mapping),
  });

  if (fresh.length) {
    const orgCategories = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.organizationId, auth.organizationId));
    const byName = new Map(orgCategories.map((c) => [c.name, c.id]));

    // Chunked so a large statement doesn't exceed SQLite's variable limit.
    const values = fresh.map((r) => {
      const suggestion = suggestCategory(r.merchantNorm, r.descriptionRaw);
      return {
        id: newId('txn'),
        organizationId: auth.organizationId,
        bankAccountId,
        importId,
        descriptionRaw: r.descriptionRaw,
        descriptionNorm: r.descriptionNorm,
        merchantNorm: r.merchantNorm,
        reference: r.reference,
        date: r.date,
        amount: r.amount,
        currency: r.currency,
        paymentMethod: r.paymentMethod,
        fingerprint: r.fingerprint,
        categoryId: suggestion ? (byName.get(suggestion) ?? null) : null,
      };
    });

    for (let i = 0; i < values.length; i += 200) {
      await db.insert(transactions).values(values.slice(i, i + 200)).onConflictDoNothing();
    }
  }

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    actorLabel: auth.name ?? auth.email,
    action: 'import.created',
    entityType: 'import',
    entityId: importId,
    detail: `${options.filename}: ${fresh.length} imported, ${rows.length - fresh.length} already present`,
  });

  return {
    importId,
    imported: fresh.length,
    skippedDuplicates: rows.length - fresh.length,
    issues,
  };
}

export async function listTransactions(
  organizationId: string,
  opts: { search?: string; page?: number; pageSize?: number; sort?: string } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));

  const conditions = [eq(transactions.organizationId, organizationId)];
  if (opts.search) {
    const term = `%${opts.search.toLowerCase()}%`;
    conditions.push(sql`(lower(${transactions.descriptionRaw}) like ${term} or cast(${transactions.amount} as text) like ${term})`);
  }

  const order = {
    newest: desc(transactions.date),
    oldest: transactions.date,
    amount_desc: transactions.amount, // most negative first = largest spend
    amount_asc: desc(transactions.amount),
  }[opts.sort ?? 'newest'] ?? desc(transactions.date);

  const rows = await db
    .select({
      id: transactions.id,
      descriptionRaw: transactions.descriptionRaw,
      merchantNorm: transactions.merchantNorm,
      date: transactions.date,
      amount: transactions.amount,
      currency: transactions.currency,
      categoryName: categories.name,
      categoryColor: categories.color,
      accountName: bankAccounts.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(bankAccounts, eq(bankAccounts.id, transactions.bankAccountId))
    .where(and(...conditions))
    .orderBy(order)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const countRows = await db.select({ count: sql<number>`count(*)` }).from(transactions).where(and(...conditions));
  return { rows, total: Number(countRows[0]?.count ?? 0), page, pageSize };
}

export async function listImports(organizationId: string) {
  return db
    .select({
      id: imports.id,
      filename: imports.filename,
      rowCount: imports.rowCount,
      importedCount: imports.importedCount,
      skippedCount: imports.skippedCount,
      createdAt: imports.createdAt,
      accountName: bankAccounts.name,
    })
    .from(imports)
    .leftJoin(bankAccounts, eq(bankAccounts.id, imports.bankAccountId))
    .where(eq(imports.organizationId, organizationId))
    .orderBy(desc(imports.createdAt))
    .limit(25);
}

export async function listBankAccounts(organizationId: string) {
  return db.select().from(bankAccounts).where(eq(bankAccounts.organizationId, organizationId));
}
