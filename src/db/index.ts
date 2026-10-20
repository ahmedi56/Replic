import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import * as schema from './schema';

/**
 * Database client: PostgreSQL.
 *
 *  - `DATABASE_URL=postgres://user:pass@host:5432/db` connects to any PostgreSQL server
 *    (Railway, Neon, Supabase, RDS, a local install). This is what production uses, and what
 *    lets more than one app instance share the same data.
 *  - `DATABASE_URL=pglite:./.data/dev` (the development default) runs PostgreSQL embedded in
 *    the Node process, stored in that folder. It needs no install and speaks the same SQL, so
 *    code written against it behaves the same on a real server. One process only, so it is
 *    refused in production.
 */

const DEFAULT_URL = 'pglite:./.data/dev';

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL || DEFAULT_URL;
  if (/^file:/i.test(url)) {
    throw new Error(
      'DATABASE_URL still points at a SQLite file. Reclip now uses PostgreSQL: set it to a postgres:// URL, or to pglite:./.data/dev for local development.',
    );
  }
  return url;
}

export function isPostgresUrl(url: string): boolean {
  return /^postgres(ql)?:\/\//i.test(url);
}

/** Typed as the node-postgres flavour; the PGlite flavour exposes the identical query API. */
export type Database = NodePgDatabase<typeof schema>;

interface Connection {
  db: Database;
  close: () => Promise<void>;
}

const globalForDb = globalThis as unknown as { __reclipDb?: Connection };

function connect(): Connection {
  const url = databaseUrl();

  if (isPostgresUrl(url)) {
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
    });
    // An idle client dropping must not crash the process; the pool replaces it.
    pool.on('error', (error) => console.error('[db] idle client error:', error.message));
    return { db: drizzlePg(pool, { schema }), close: () => pool.end() };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL must be a postgres:// URL in production (the embedded PGlite database is for development only).');
  }
  const dir = url.replace(/^pglite:/, '');
  // PGlite creates its own folder but not the folders above it (a fresh clone has no ./.data).
  if (dir !== 'memory://') fs.mkdirSync(path.dirname(path.resolve(dir)), { recursive: true });
  const client = new PGlite(dir === 'memory://' ? undefined : dir);
  return { db: drizzlePglite(client, { schema }) as unknown as Database, close: () => client.close() };
}

function connection(): Connection {
  // Reused across hot reloads in development, so each edit does not open another pool.
  globalForDb.__reclipDb ??= connect();
  return globalForDb.__reclipDb;
}

export const db: Database = new Proxy({} as Database, {
  get(_target, property) {
    const target = connection().db as unknown as Record<string | symbol, unknown>;
    const value = target[property];
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

/** Close the connection (tests, shutdown). */
export async function closeDb(): Promise<void> {
  const current = globalForDb.__reclipDb;
  globalForDb.__reclipDb = undefined;
  await current?.close();
}

export { schema };
