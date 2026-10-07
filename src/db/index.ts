import 'server-only';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

/**
 * Database client.
 *
 * Built on `better-sqlite3` through Drizzle's own driver. Node's built-in `node:sqlite` was
 * used previously, but it only loads without a flag from Node 22.13 (it was added in 22.5
 * behind `--experimental-sqlite`), so it fails outright on 22.5 – 22.12 with
 * `ERR_UNKNOWN_BUILTIN_MODULE`. `better-sqlite3` supports every maintained Node release, and
 * ships as a prebuilt binary, so `npm install` does not need a compiler.
 *
 * Moving to Postgres later means swapping this file and the Drizzle dialect; the queries in
 * `lib/services/*` are ordinary Drizzle and carry over unchanged.
 */

const globalForDb = globalThis as unknown as { __reclipDb?: ReturnType<typeof create> };

function create() {
  const file = (process.env.DATABASE_URL ?? 'file:./dev.db').replace(/^file:/, '');
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}

export const db = globalForDb.__reclipDb ?? create();
if (process.env.NODE_ENV !== 'production') globalForDb.__reclipDb = db;

export { schema };
