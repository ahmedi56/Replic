/**
 * Reclip data model (Drizzle / PostgreSQL).
 *
 * Two rules shape this schema:
 *  1. The original uploaded document is never mutated. `receipts` holds the file;
 *     `receiptExtractions` holds everything we derived from it.
 *  2. Every tenant-owned row carries `organizationId`. All queries scope by it.
 */
import { pgTable, text, integer, boolean, doublePrecision, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

const id = () => text('id').primaryKey();
/** A point in time. Stored as timestamptz, handled as a JS Date everywhere in the app. */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const now = () => ts('created_at').notNull().defaultNow();

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  createdAt: now(),
});

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  persona: text('persona'), // freelancer | small_business | accountant | other
  onboardedAt: ts('onboarded_at'),
  /** Null until the address is proven (email link or password reset). */
  emailVerifiedAt: ts('email_verified_at'),
  /** Consecutive wrong passwords; reset on success or when the lock starts. */
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: ts('locked_until'),
  createdAt: now(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('owner'),
  },
  (t) => [uniqueIndex('memberships_user_org').on(t.userId, t.organizationId), index('memberships_org').on(t.organizationId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    createdAt: now(),
  },
  (t) => [index('sessions_user').on(t.userId)],
);

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: id(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
});

export const emailVerificationTokens = pgTable('email_verification_tokens', {
  id: id(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
});

/** Account-level security history (sign-ins, password changes), shown to the user in Settings. */
export const securityEvents = pgTable(
  'security_events',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // login | login_failed | locked | password_changed | password_reset | email_verified
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: now(),
  },
  (t) => [index('security_events_user').on(t.userId, t.createdAt)],
);

/**
 * Fixed-window rate-limit counters, shared by every app instance (an in-memory map would give
 * each instance its own allowance). One row per key; see `rateLimit` in lib/api.ts.
 */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: ts('reset_at').notNull(),
});

/** Per-org overrides for matching weights/thresholds (JSON). Defaults in lib/matching/config.ts. */
export const orgSettings = pgTable('org_settings', {
  id: id(),
  organizationId: text('organization_id').notNull().unique().references(() => organizations.id, { onDelete: 'cascade' }),
  matchingConfig: text('matching_config'),
});

export const subscriptions = pgTable('subscriptions', {
  id: id(),
  organizationId: text('organization_id').notNull().unique().references(() => organizations.id, { onDelete: 'cascade' }),
  plan: text('plan').notNull().default('free'),
  receiptQuota: integer('receipt_quota').notNull().default(50),
  periodStart: now(),
});

export const categories = pgTable(
  'categories',
  {
    id: id(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#10B981'),
    isSystem: boolean('is_system').notNull().default(false),
  },
  (t) => [uniqueIndex('categories_org_name').on(t.organizationId, t.name)],
);

export const merchants = pgTable(
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
export const receipts = pgTable(
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
    isDuplicate: boolean('is_duplicate').notNull().default(false),
    duplicateOfId: text('duplicate_of_id'),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    createdAt: now(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('receipts_org_status').on(t.organizationId, t.status),
    index('receipts_org_checksum').on(t.organizationId, t.checksum),
    index('receipts_org_created').on(t.organizationId, t.createdAt),
  ],
);

/** Structured data derived from a receipt — separate row, so the original stays intact. */
export const receiptExtractions = pgTable(
  'receipt_extractions',
  {
    id: id(),
    receiptId: text('receipt_id').notNull().unique().references(() => receipts.id, { onDelete: 'cascade' }),
    merchantRaw: text('merchant_raw'),
    merchantNorm: text('merchant_norm'),
    merchantId: text('merchant_id').references(() => merchants.id, { onDelete: 'set null' }),
    date: ts('date'),
    total: doublePrecision('total'),
    subtotal: doublePrecision('subtotal'),
    tax: doublePrecision('tax'),
    currency: text('currency'),
    invoiceNumber: text('invoice_number'),
    paymentMethod: text('payment_method'),
    items: text('items'), // JSON array
    /** Per-field confidence 0-1, JSON: { merchant: 0.99, date: 0.97, ... } */
    fieldConfidence: text('field_confidence'),
    overallConfidence: doublePrecision('overall_confidence').notNull().default(0),
    provider: text('provider').notNull().default('mock'),
    rawResponse: text('raw_response'),
    editedByUser: boolean('edited_by_user').notNull().default(false),
    createdAt: now(),
  },
  (t) => [index('extractions_merchant_norm').on(t.merchantNorm)],
);

export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: id(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    currency: text('currency').notNull().default('EUR'),
  },
  (t) => [index('bank_accounts_org').on(t.organizationId)],
);

export const imports = pgTable(
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

export const transactions = pgTable(
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
    date: ts('date').notNull(),
    amount: doublePrecision('amount').notNull(), // signed; negative = money out
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

export const matches = pgTable(
  'matches',
  {
    id: id(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    receiptId: text('receipt_id').notNull().references(() => receipts.id, { onDelete: 'cascade' }),
    transactionId: text('transaction_id').notNull().references(() => transactions.id, { onDelete: 'cascade' }),
    score: doublePrecision('score').notNull(),
    status: text('status').notNull().default('suggested'), // suggested|confirmed|rejected|auto
    /** JSON signal breakdown — this is what the "Why matched?" panel renders. */
    breakdown: text('breakdown').notNull(),
    method: text('method').notNull().default('deterministic'),
    confirmedBy: text('confirmed_by'),
    createdAt: now(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('matches_receipt_txn').on(t.receiptId, t.transactionId),
    index('matches_org_status').on(t.organizationId, t.status),
    index('matches_org_score').on(t.organizationId, t.score),
  ],
);

export const auditLogs = pgTable(
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
