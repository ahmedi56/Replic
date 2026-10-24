import 'server-only';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { getTableColumns, getTableName, isTable, sql, type Table } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import * as schema from '@/db/schema';
import {
  BACKUP_PREFIX,
  putBackupObject,
  getBackupObject,
  listBackupObjects,
  deleteBackupObject,
} from './storage';

/**
 * Logical backups of the database.
 *
 * What a backup is: a consistent snapshot of every data table, as JSON, compressed, then
 * encrypted with AES-256-GCM. It is encrypted because it contains password hashes and financial
 * records, and it refuses to exist without a key. What it is not: a copy of the uploaded
 * documents, which live in the bucket (turn on versioning or replication there), and not a
 * replacement for your Postgres provider's own point-in-time recovery, which is the better
 * first line of defence. Think of this as the copy you control, in a place you choose.
 *
 * Held in memory while it is built, which is fine to a few hundred megabytes of rows.
 */

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const MAGIC = Buffer.from('RCBK1'); // file type + format version
const FORMAT_VERSION = 1;

/** Tables worth keeping, in the order rows can be inserted (parents before children). */
const BACKUP_TABLES: PgTable[] = [
  schema.organizations,
  schema.users,
  schema.memberships,
  schema.securityEvents,
  schema.orgSettings,
  schema.subscriptions,
  schema.categories,
  schema.merchants,
  schema.bankAccounts,
  schema.imports,
  schema.receipts,
  schema.receiptExtractions,
  schema.transactions,
  schema.matches,
  schema.auditLogs,
];

/**
 * Tables deliberately left out, because they hold nothing worth restoring and some of it would
 * be harmful to bring back: live sessions, one-time tokens, rate-limit counters, queued jobs.
 */
const EXCLUDED_TABLES = ['sessions', 'password_reset_tokens', 'email_verification_tokens', 'rate_limits', 'jobs'];

/** Every table in the schema, so a test can insist each one is either backed up or excluded. */
export function schemaTableNames(): string[] {
  return (Object.values(schema) as unknown[]).filter((v): v is Table => isTable(v)).map((t) => getTableName(t));
}
export const backedUpTableNames = (): string[] => BACKUP_TABLES.map((t) => getTableName(t));
export const excludedTableNames = (): string[] => [...EXCLUDED_TABLES];

// --- Encryption ----------------------------------------------------------------

/** The 32-byte key from BACKUP_ENCRYPTION_KEY (64 hex characters, or base64). */
export function backupKey(): Buffer {
  const raw = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error('BACKUP_ENCRYPTION_KEY is not set. Backups contain personal data and are never written unencrypted.');
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be 32 bytes: 64 hex characters, or base64 of 32 bytes. Create one with `npm run backup -- key`.');
  return key;
}

export function backupsEnabled(): boolean {
  return Boolean(process.env.BACKUP_ENCRYPTION_KEY?.trim()) && process.env.BACKUP_DAILY !== 'false';
}

export function encrypt(plain: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function decrypt(file: Buffer, key: Buffer): Buffer {
  if (file.length < MAGIC.length + 28 || !file.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('This is not a Reclip backup file (or it is from an incompatible version).');
  }
  const iv = file.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = file.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(file.subarray(MAGIC.length + 28)), decipher.final()]);
  } catch {
    // GCM authenticates: this means the wrong key, or a file that was damaged or altered.
    throw new Error('Could not decrypt this backup: wrong BACKUP_ENCRYPTION_KEY, or the file is damaged.');
  }
}

// --- Creating -------------------------------------------------------------------

export interface BackupResult {
  key: string;
  bytes: number;
  rows: Record<string, number>;
}

interface Snapshot {
  format: number;
  createdAt: string;
  tables: Record<string, unknown[]>;
}

/** Read every backed-up table inside one repeatable-read transaction, so the copy is consistent. */
async function snapshot(): Promise<Snapshot> {
  const tables: Record<string, unknown[]> = {};
  await db.transaction(
    async (tx) => {
      for (const table of BACKUP_TABLES) tables[getTableName(table)] = await tx.select().from(table);
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
  return { format: FORMAT_VERSION, createdAt: new Date().toISOString(), tables };
}

export function backupFileName(at = new Date()): string {
  return `${BACKUP_PREFIX}backup-${at.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}.rcbk`;
}

/** Make a backup, store it, and remove old ones beyond `BACKUP_KEEP` (default 14). */
export async function createBackup(): Promise<BackupResult> {
  const key = backupKey(); // fail before reading any data if encryption is not set up
  const data = await snapshot();
  const file = encrypt(await gzip(Buffer.from(JSON.stringify(data))), key);

  const name = backupFileName();
  await putBackupObject(name, file);
  await pruneBackups();
  resetBackupAgeCache();

  return { key: name, bytes: file.length, rows: Object.fromEntries(Object.entries(data.tables).map(([t, rows]) => [t, rows.length])) };
}

export async function pruneBackups(keep = Number(process.env.BACKUP_KEEP ?? 14)): Promise<string[]> {
  const all = (await listBackupObjects()).filter((k) => k.endsWith('.rcbk')); // names sort by time
  const old = all.slice(0, Math.max(0, all.length - Math.max(1, keep)));
  for (const name of old) await deleteBackupObject(name);
  return old;
}

export async function listBackups(): Promise<string[]> {
  return (await listBackupObjects()).filter((k) => k.endsWith('.rcbk'));
}

// --- Restoring ------------------------------------------------------------------

/** Rows in a table come back from JSON with dates as strings; turn those columns back into Dates. */
function reviveRow(table: PgTable, row: Record<string, unknown>): Record<string, unknown> {
  const columns = getTableColumns(table);
  const revived: Record<string, unknown> = { ...row };
  for (const [field, column] of Object.entries(columns)) {
    if (column.dataType === 'date' && typeof revived[field] === 'string') revived[field] = new Date(revived[field] as string);
  }
  return revived;
}

/** Postgres allows 65,535 parameters per statement, so wide tables are inserted in slices. */
function chunkSize(table: PgTable): number {
  return Math.max(1, Math.floor(60_000 / Object.keys(getTableColumns(table)).length));
}

export interface RestoreResult {
  createdAt: string;
  rows: Record<string, number>;
}

/**
 * Load a backup into an EMPTY database. It will not merge into, or overwrite, existing data:
 * restoring over live data is how a bad day becomes a worse one. Start from a fresh database
 * (`npm run db:push`), restore, then point the app at it.
 */
export async function restoreBackup(file: Buffer): Promise<RestoreResult> {
  const snap = JSON.parse((await gunzip(decrypt(file, backupKey()))).toString('utf8')) as Snapshot;
  if (snap.format !== FORMAT_VERSION) throw new Error(`This backup uses format ${snap.format}; this version of Reclip reads format ${FORMAT_VERSION}.`);

  const existing = await db.execute(sql`select (select count(*) from users)::int as users, (select count(*) from organizations)::int as organizations`);
  const counts = (existing.rows as unknown as Array<{ users: number; organizations: number }>)[0];
  if (counts.users > 0 || counts.organizations > 0) {
    throw new Error('Refusing to restore: this database already has data. Restore into a new, empty database.');
  }

  const rows: Record<string, number> = {};
  await db.transaction(async (tx) => {
    for (const table of BACKUP_TABLES) {
      const name = getTableName(table);
      const data = (snap.tables[name] ?? []) as Array<Record<string, unknown>>;
      const size = chunkSize(table);
      for (let i = 0; i < data.length; i += size) {
        await tx.insert(table).values(data.slice(i, i + size).map((row) => reviveRow(table, row)));
      }
      rows[name] = data.length;
    }
  });
  return { createdAt: snap.createdAt, rows };
}

export async function restoreBackupByName(name: string): Promise<RestoreResult> {
  return restoreBackup(await getBackupObject(name));
}

let ageCache: { at: number; hours: number | null } | null = null;

/** Hours since the newest backup, or null if there is none. Cached for five minutes (it lists the bucket). */
export async function latestBackupAgeHours(): Promise<number | null> {
  if (ageCache && Date.now() - ageCache.at < 5 * 60_000) return ageCache.hours;
  const newest = (await listBackups()).at(-1);
  const stamp = newest?.match(/backup-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
  const hours = stamp ? (Date.now() - Date.UTC(+stamp[1], +stamp[2] - 1, +stamp[3], +stamp[4], +stamp[5], +stamp[6])) / 3_600_000 : null;
  ageCache = { at: Date.now(), hours };
  return hours;
}

/** Forget the cached age (tests, and right after a new backup). */
export function resetBackupAgeCache(): void {
  ageCache = null;
}
