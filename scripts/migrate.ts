/**
 * Apply the SQL migrations in ./drizzle to the database named by DATABASE_URL.
 *
 * Drizzle Kit generates the SQL (`npm run db:generate`); this applies it with Drizzle's own
 * migrator, which records what has run, so running it repeatedly is safe. It works against a
 * PostgreSQL server (`postgres://...`) and the embedded development database (`pglite:...`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';

const MIGRATIONS = path.resolve(process.cwd(), 'drizzle');
const url = process.env.DATABASE_URL || 'pglite:./.data/dev';
if (/^file:/i.test(url)) {
  console.error('DATABASE_URL still points at a SQLite file. Use a postgres:// URL, or pglite:./.data/dev for local development.');
  process.exit(1);
}

async function main(): Promise<void> {
  if (/^postgres(ql)?:\/\//i.test(url)) {
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      await migratePg(drizzlePg(pool), { migrationsFolder: MIGRATIONS });
    } finally {
      await pool.end();
    }
  } else {
    const dir = url.replace(/^pglite:/, '');
    if (dir !== 'memory://') fs.mkdirSync(path.dirname(path.resolve(dir)), { recursive: true });
    const client = new PGlite(dir === 'memory://' ? undefined : dir);
    try {
      await migratePglite(drizzlePglite(client), { migrationsFolder: MIGRATIONS });
    } finally {
      await client.close();
    }
  }
  console.log('Database is up to date.');
}

main().catch((error) => {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
