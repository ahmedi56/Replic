import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { db, type Database } from '@/db';
import { jobs } from '@/db/schema';
import { newId } from './ids';
import { captureError, sanitizeError } from './monitoring';

/**
 * A small job queue on top of PostgreSQL: no Redis, nothing else to run, and it works with
 * several app instances because the database is the single source of truth.
 *
 *  - `enqueue` inserts a row.
 *  - A worker claims one row at a time with `FOR UPDATE SKIP LOCKED`, so two workers never
 *    take the same job, and a claim carries a lease.
 *  - If a worker dies mid-job the lease runs out and another worker picks the job up.
 *  - A failing job is retried with exponential backoff; after `maxAttempts` it is marked
 *    failed and its handler's `onFailed` runs, so the user is told rather than left waiting.
 *
 * Payloads hold ids only. A job that has to read a document fetches it from storage.
 */

export interface JobHandler<P> {
  run(payload: P): Promise<void>;
  /** Called once when a job has used all its attempts. */
  onFailed?(payload: P, error: Error): Promise<void>;
}

const handlers = new Map<string, JobHandler<any>>();

export function registerJob<P>(type: string, handler: JobHandler<P>): void {
  handlers.set(type, handler);
}

/** A database handle, or a transaction on one, so a job can be queued atomically with its row. */
type Executor = Pick<Database, 'insert'>;

/**
 * Queue a job. Passing `id` makes it idempotent: a second call with the same id does nothing,
 * which is how "one backup per day, across every instance" is enforced by the database.
 * Returns true when a job was actually queued.
 */
export async function enqueue(
  type: string,
  payload: unknown,
  options: { maxAttempts?: number; executor?: Executor; id?: string } = {},
): Promise<string> {
  const id = options.id ?? newId('job');
  const insert = (options.executor ?? db).insert(jobs).values({
    id,
    type,
    payload: JSON.stringify(payload),
    maxAttempts: options.maxAttempts ?? 3,
  });
  if (options.id) await insert.onConflictDoNothing();
  else await insert;
  return id;
}

interface ClaimedJob {
  id: string;
  type: string;
  payload: string;
  attempts: number;
  maxAttempts: number;
}

const LEASE_MS = 5 * 60_000;

/** Take the next due job, or null. Safe to call from many workers at once. */
export async function claimJob(leaseMs = LEASE_MS): Promise<ClaimedJob | null> {
  const result = await db.execute(sql`
    update jobs
       set status = 'running',
           attempts = attempts + 1,
           locked_until = now() + (${leaseMs} * interval '1 millisecond')
     where id = (
       select id from jobs
        where (status = 'queued' and run_at <= now())
           or (status = 'running' and locked_until < now())
        order by run_at asc
        limit 1
        for update skip locked
     )
     returning id, type, payload, attempts, max_attempts as "maxAttempts"
  `);
  return ((result.rows as unknown as ClaimedJob[])[0]) ?? null;
}

/** Seconds to wait before attempt number `attempt + 1`: 10s, 20s, 40s, ... capped at 10 minutes. */
export function backoffSeconds(attempt: number): number {
  return Math.min(10 * 2 ** (attempt - 1), 600);
}

async function finish(job: ClaimedJob, error: Error | null): Promise<void> {
  if (!error) {
    await db.update(jobs).set({ status: 'done', finishedAt: new Date(), lockedUntil: null, lastError: null }).where(eq(jobs.id, job.id));
    return;
  }

  const message = error.message.slice(0, 500);
  if (job.attempts < job.maxAttempts) {
    await db
      .update(jobs)
      .set({ status: 'queued', lockedUntil: null, lastError: message, runAt: new Date(Date.now() + backoffSeconds(job.attempts) * 1000) })
      .where(eq(jobs.id, job.id));
    return;
  }

  await db.update(jobs).set({ status: 'failed', finishedAt: new Date(), lockedUntil: null, lastError: message }).where(eq(jobs.id, job.id));
  const handler = handlers.get(job.type);
  if (handler?.onFailed) {
    try {
      await handler.onFailed(JSON.parse(job.payload), error);
    } catch (onFailedError) {
      console.error(`[queue] onFailed for ${job.type} threw:`, onFailedError instanceof Error ? onFailedError.message : 'unknown');
    }
  }
}

/** Claim and run one job. Returns false when nothing was due. */
export async function runNextJob(): Promise<boolean> {
  const job = await claimJob();
  if (!job) return false;

  const handler = handlers.get(job.type);
  if (!handler) {
    await finish({ ...job, attempts: job.maxAttempts }, new Error(`No handler registered for job type "${job.type}"`));
    return true;
  }

  // A lease that expired more than `maxAttempts` times means the job keeps killing its worker.
  if (job.attempts > job.maxAttempts) {
    await finish({ ...job, attempts: job.maxAttempts }, new Error('Gave up: the worker stopped before finishing this job'));
    return true;
  }

  try {
    await handler.run(JSON.parse(job.payload));
    await finish(job, null);
  } catch (error) {
    const err = error instanceof Error ? error : new Error('unknown error');
    console.error(`[queue] ${job.type} attempt ${job.attempts}/${job.maxAttempts} failed: ${sanitizeError(err).message.slice(0, 200)}`);
    // Only the last attempt is worth an alert; earlier ones are expected to be retried.
    if (job.attempts >= job.maxAttempts) captureError(err, { job: job.type, attempts: job.attempts });
    await finish(job, err);
  }
  return true;
}

export interface Worker {
  stop(): Promise<void>;
}

const globalForWorker = globalThis as unknown as { __reclipWorker?: Worker };

/** Start `concurrency` polling loops in this process. One worker per process, even across hot reloads. */
export function startWorker(options: { concurrency?: number; pollMs?: number } = {}): Worker {
  if (globalForWorker.__reclipWorker) return globalForWorker.__reclipWorker;

  const concurrency = Math.max(1, options.concurrency ?? Number(process.env.JOB_CONCURRENCY ?? 2));
  const pollMs = options.pollMs ?? 1000;
  let stopped = false;

  const loops = Array.from({ length: concurrency }, async () => {
    while (!stopped) {
      let didWork = false;
      try {
        didWork = await runNextJob();
      } catch (error) {
        // The database being briefly unreachable must not kill the worker.
        console.error('[queue] worker error:', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
      }
      if (!didWork && !stopped) await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  });

  const worker: Worker = {
    async stop() {
      stopped = true;
      globalForWorker.__reclipWorker = undefined;
      await Promise.all(loops);
    },
  };
  globalForWorker.__reclipWorker = worker;
  return worker;
}

/** Counts for health checks and monitoring. */
export async function queueStats(): Promise<{ queued: number; running: number; failed: number; oldestQueuedSeconds: number | null }> {
  const result = await db.execute(sql`
    select
      count(*) filter (where status = 'queued')::int as queued,
      count(*) filter (where status = 'running')::int as running,
      count(*) filter (where status = 'failed' and finished_at > now() - interval '24 hours')::int as failed,
      extract(epoch from (now() - min(run_at) filter (where status = 'queued' and run_at <= now())))::int as "oldestQueuedSeconds"
    from jobs
  `);
  const row = (result.rows as unknown as Array<{ queued: number; running: number; failed: number; oldestQueuedSeconds: number | null }>)[0];
  return { queued: row.queued, running: row.running, failed: row.failed, oldestQueuedSeconds: row.oldestQueuedSeconds ?? null };
}

/** Delete finished jobs after a week, so the table stays small. */
export async function pruneJobs(): Promise<void> {
  await db.delete(jobs).where(sql`${jobs.status} in ('done', 'failed') and ${jobs.finishedAt} < now() - interval '7 days'`);
}
