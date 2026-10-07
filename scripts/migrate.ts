/**
 * Apply the generated SQL migrations with the same SQLite driver the app uses.
 *
 * Drizzle Kit generates the SQL (`drizzle-kit generate`); this applies it, so the setup step
 * needs no database CLI and no server.
 *
 * Applied migrations are recorded in `__migrations`, so running this repeatedly is safe.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'drizzle');

function main(): void {
  const file = (process.env.DATABASE_URL ?? 'file:./dev.db').replace(/^file:/, '');
  const dir = path.dirname(path.resolve(file));
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(path.resolve(file));
  db.pragma('foreign_keys = OFF'); // relaxed while tables are being created
  db.exec('CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`No migrations found in ${MIGRATIONS_DIR}. Run: npx drizzle-kit generate`);
    process.exit(1);
  }

  const applied = new Set(
    (db.prepare('SELECT name FROM __migrations').all() as Array<{ name: string }>).map((r) => r.name),
  );

  const pending = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('Database is up to date.');
    return;
  }

  for (const name of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
    // Drizzle separates independent statements with this marker.
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);

    db.exec('BEGIN');
    try {
      for (const statement of statements) db.exec(statement);
      db.prepare('INSERT INTO __migrations (name, applied_at) VALUES (?, ?)').run(name, Date.now());
      db.exec('COMMIT');
      console.log(`Applied ${name}`);
    } catch (error) {
      db.exec('ROLLBACK');
      console.error(`Failed to apply ${name}:`, error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }

  console.log(`Done — ${pending.length} migration${pending.length === 1 ? '' : 's'} applied.`);
}

main();
