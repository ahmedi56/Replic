/**
 * Reclip data model (Drizzle / SQLite).
 *
 * Two rules shape this schema:
 *  1. The original uploaded document is never mutated. `receipts` holds the file;
 *     `receiptExtractions` holds everything we derived from it.
 *  2. Every tenant-owned row carries `organizationId`. All queries scope by it.
 */
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

const id = () => text('id').primaryKey();
const now = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`);

export const organizations = sqliteTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  createdAt: now(),
});

export const users = sqliteTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  persona: text('persona'), // freelancer | small_business | accountant | other
  onboardedAt: integer('onboarded_at', { mode: 'timestamp_ms' }),
  createdAt: now(),
});

export const memberships = sqliteTable(
  'memberships',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('owner'),
  },
  (t) => [uniqueIndex('memberships_user_org').on(t.userId, t.organizationId), index('memberships_org').on(t.organizationId)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: now(),
  },
  (t) => [index('sessions_user').on(t.userId)],
);

export const passwordResetTokens = sqliteTable('password_reset_tokens', {
  id: id(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp_ms' }),
});

/** Per-org overrides for matching weights/thresholds (JSON). Defaults in lib/matching/config.ts. */
export const orgSettings = sqliteTable('org_settings', {
  id: id(),
  organizationId: text('organization_id').notNull().unique().references(() => organizations.id, { onDelete: 'cascade' }),
  matchingConfig: text('matching_config'),
});

export const subscriptions = sqliteTable('subscriptions', {
  id: id(),
  organizationId: text('organization_id').notNull().unique().references(() => organizations.id, { onDelete: 'cascade' }),
  plan: text('plan').notNull().default('free'),
  receiptQuota: integer('receipt_quota').notNull().default(50),
  periodStart: now(),
});

export const categories = sqliteTable(
  'categories',
  {
    id: id(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#10B981'),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [uniqueIndex('categories_org_name').on(t.organizationId, t.name)],
);

export const merchants = sqliteTable(
  'merchants',
  {
    id: id(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalized: text('normalized').notNull(),
    aliases: text('aliases'), // JSON array
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('merchants_org_norm').on(t.organizationId, t.normalized)],
);

/** The original uploaded document. */
export const receipts = sqliteTable(
  'receipts',
  {
    id: id(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** sha256 of the file bytes — catches byte-identical re-uploads. */
    checksum: text('checksum').notNull(),
    status: text('status').notNull().default('uploaded'),
    failureCode: text('failure_code'),
    isDuplicate: integer('is_duplicate', { mode: 'boolean' }).notNull().default(false),
    duplicateOfId: text('duplicate_of_id'),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    createdAt: now(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index('receipts_org_status').on(t.organizationId, t.status),
    index('receipts_org_checksum').on(t.organizationId, t.checksum),
    index('receipts_org_created').on(t.organizationId, t.createdAt),
  ],
);

/** Structured data derived from a receipt — separate row, so the original stays intact. */
export const receiptExtractions = sqliteTable(
  'receipt_extractions',
  {
    id: id(),
    receiptId: text('receipt_id').notNull().unique().references(() => receipts.id, { onDelete: 'cascade' }),
    merchantRaw: text('merchant_raw'),
    merchantNorm: text('merchant_norm'),
    merchantId: text('merchant_id').references(() => merchants.id, { onDelete: 'set null' }),
    date: integer('date', { mode: 'timestamp_ms' }),
    total: real('total'),
    subtotal: real('subtotal'),
    tax: real('tax'),
    currency: text('currency'),
    invoiceNumber: text('invoice_number'),
    paymentMethod: text('payment_method'),
    items: text('items'), // JSON array
    /** Per-field confidence 0-1, JSON: { merchant: 0.99, date: 0.97, ... } */
    fieldConfidence: text('field_confidence'),
    overallConfidence: real('overall_confidence').notNull().default(0),
    provider: text('provider').notNull().default('mock'),
    rawResponse: text('raw_response'),
    editedByUser: integer('edited_by_user', { mode: 'boolean' }).notNull().default(false),
    createdAt: now(),
  },
  (t) => [index('extractions_merchant_norm').on(t.merchantNorm)],
);

export const bankAccounts = sqliteTable(
  'bank_accounts',
  {
    id: id(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    currency: text('currency').notNull().default('EUR'),
  },
  (t) => [index('bank_accounts_org').on(t.organizationId)],
);

export const imports = sqliteTable(
  'imports',
  {
    id: id(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    bankAccountId: text('bank_account_id').references(() => bankAccounts.id, { onDelete: 'set null' }),
    filename: text('filename').notNull(),
    /** sha256 of the CSV body — blocks accidental re-import of the same statement. */
    checksum: text('checksum').notNull(),
    rowCount: integer('row_count').notNull().default(0),
    importedCount: integer('imported_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    columnMapping: text('column_mapping'),
    createdAt: now(),
  },
  (t) => [index('imports_org_checksum').on(t.organizationId, t.checksum)],
);

export const transactions = sqliteTable(
  'transactions',
  {
    id: id(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    bankAccountId: text('bank_account_id').references(() => bankAccounts.id, { onDelete: 'set null' }),
    importId: text('import_id').references(() => imports.id, { onDelete: 'set null' }),
    /** Exactly what the bank sent. Never normalized in place. */
    descriptionRaw: text('description_raw').notNull(),
    descriptionNorm: text('description_norm').notNull(),
    merchantNorm: text('merchant_norm'),
    merchantId: text('merchant_id').references(() => merchants.id, { onDelete: 'set null' }),
    reference: text('reference'),
    date: integer('date', { mode: 'timestamp_ms' }).notNull(),
    amount: real('amount').notNull(), // signed; negative = money out
    currency: text('currency').notNull().default('EUR'),
    paymentMethod: text('payment_method'),
    /** sha256(date|amount|description|account) — dedupes re-imported rows. */
    fingerprint: text('fingerprint').notNull(),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('transactions_org_fingerprint').on(t.organizationId, t.fingerprint),
    index('transactions_org_date').on(t.organizationId, t.date),
    index('transactions_org_amount').on(t.organizationId, t.amount),
  ],
);

export const matches = sqliteTable(
  'matches',
  {
    id: id(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    receiptId: text('receipt_id').notNull().references(() => receipts.id, { onDelete: 'cascade' }),
    transactionId: text('transaction_id').notNull().references(() => transactions.id, { onDelete: 'cascade' }),
    score: real('score').notNull(),
    status: text('status').notNull().default('suggested'), // suggested|confirmed|rejected|auto
    /** JSON signal breakdown — this is what the "Why matched?" panel renders. */
    breakdown: text('breakdown').notNull(),
    method: text('method').notNull().default('deterministic'),
    confirmedBy: text('confirmed_by'),
    createdAt: now(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex('matches_receipt_txn').on(t.receiptId, t.transactionId),
    index('matches_org_status').on(t.organizationId, t.status),
    index('matches_org_score').on(t.organizationId, t.score),
  ],
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: id(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    actorLabel: text('actor_label').notNull().default('System'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    detail: text('detail'),
    createdAt: now(),
  },
  (t) => [index('audit_org_created').on(t.organizationId, t.createdAt), index('audit_entity').on(t.entityType, t.entityId)],
);

export type Receipt = typeof receipts.$inferSelect;
export type ReceiptExtraction = typeof receiptExtractions.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Match = typeof matches.$inferSelect;
export type User = typeof users.$inferSelect;
