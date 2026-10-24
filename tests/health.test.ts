import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'reclip-health-'));
const dbDir = path.join(workdir, 'pg');
process.env.DATABASE_URL = `pglite:${dbDir}`;
process.env.STORAGE_DIR = path.join(workdir, 'storage');

let db: typeof import('@/db').db;
let schema: typeof import('@/db/schema');
let GET: typeof import('@/app/api/health/route').GET;

const call = (token?: string) => GET(new Request('http://localhost/api/health', { headers: token ? { authorization: `Bearer ${token}` } : {} }));

beforeAll(async () => {
  execFileSync('node', ['node_modules/tsx/dist/cli.mjs', 'scripts/migrate.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `pglite:${dbDir}` },
    stdio: 'pipe',
  });
  db = (await import('@/db')).db;
  schema = await import('@/db/schema');
  GET = (await import('@/app/api/health/route')).GET;
});

afterAll(async () => {
  await (await import('@/db')).closeDb();
  fs.rmSync(workdir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.delete(schema.jobs);
  delete process.env.HEALTH_TOKEN;
});

describe('GET /api/health', () => {
  it('reports ok, with pass/fail only for the public', async () => {
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ status: 'ok', checks: { database: true, queue: true } });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('adds queue numbers only for a caller with the right token', async () => {
    process.env.HEALTH_TOKEN = 'monitor-secret-token';
    expect((await (await call()).json()).queue).toBeUndefined();
    expect((await (await call('wrong-token')).json()).queue).toBeUndefined();
    const detailed = await (await call('monitor-secret-token')).json();
    expect(detailed.queue).toMatchObject({ queued: 0, running: 0, failed: 0 });
  });

  it('reports degraded (503) when jobs are waiting and nothing is working on them', async () => {
    await db.insert(schema.jobs).values({ id: 'job_stuck', type: 'noop', payload: '{}', runAt: new Date(Date.now() - 10 * 60_000) });
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).checks.queue).toBe(false);
  });

  it('stays healthy while a worker is busy, even with a backlog', async () => {
    await db.insert(schema.jobs).values([
      { id: 'job_old', type: 'noop', payload: '{}', runAt: new Date(Date.now() - 10 * 60_000) },
      { id: 'job_busy', type: 'noop', payload: '{}', status: 'running', lockedUntil: new Date(Date.now() + 60_000) },
    ]);
    expect((await call()).status).toBe(200);
  });
});
