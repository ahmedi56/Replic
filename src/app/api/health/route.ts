import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { queueStats } from '@/lib/queue';
import { safeEqual } from '@/lib/ids';
import { backupsEnabled, latestBackupAgeHours } from '@/lib/backup';

export const dynamic = 'force-dynamic';

/** A job waiting longer than this with nothing running means the worker is not working. */
const STUCK_AFTER_SECONDS = 300;
const MAX_BACKUP_AGE_HOURS = 36;

/**
 * Liveness and readiness for load balancers and uptime monitors. Public, so it answers with
 * pass/fail only; queue numbers are included when the caller sends `Authorization: Bearer
 * $HEALTH_TOKEN` (set HEALTH_TOKEN to enable that).
 */
export async function GET(req: Request) {
  const checks: { database: boolean; queue: boolean; backup?: boolean } = { database: false, queue: false };
  let stats: Awaited<ReturnType<typeof queueStats>> | null = null;

  try {
    await db.execute(sql`select 1`);
    checks.database = true;
    stats = await queueStats();
    checks.queue = !(stats.oldestQueuedSeconds !== null && stats.oldestQueuedSeconds > STUCK_AFTER_SECONDS && stats.running === 0);
    if (backupsEnabled()) {
      // Daily backups should never be more than ~a day and a half old. A brand-new deployment
      // that has not reached its first backup hour yet is not a problem.
      const age = await latestBackupAgeHours();
      checks.backup = age === null ? process.uptime() < MAX_BACKUP_AGE_HOURS * 3600 : age <= MAX_BACKUP_AGE_HOURS;
    }
  } catch (error) {
    console.error('[health] check failed:', error instanceof Error && error.cause instanceof Error ? error.cause.message : 'database unreachable');
  }

  const healthy = checks.database && checks.queue && checks.backup !== false;
  const token = process.env.HEALTH_TOKEN;
  const presented = req.headers.get('authorization')?.replace(/^Bearer /i, '') ?? '';
  const detailed = Boolean(token) && safeEqual(presented, token as string);

  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded', checks, ...(detailed && stats ? { queue: stats } : {}) },
    { status: healthy ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
