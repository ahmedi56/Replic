import 'server-only';
import { registerAllJobs, BACKUP_JOB } from './jobs';
import { startWorker, pruneJobs, enqueue } from './queue';
import { backupsEnabled } from './backup';

/**
 * Start background processing in this server process. Every instance runs a worker, and the
 * database arbitrates, so scaling out means starting more instances. RUN_WORKER=false turns it
 * off on an instance (at least one instance must keep it on, or uploads will never finish).
 */
export function bootWorker(): void {
  if (process.env.RUN_WORKER === 'false') return;

  registerAllJobs();
  const worker = startWorker();

  // Finished jobs are kept for a week for debugging, then removed.
  const prune = setInterval(() => {
    pruneJobs().catch((error) => console.error('[queue] prune failed:', error instanceof Error ? error.message.slice(0, 200) : 'unknown'));
  }, 60 * 60_000);
  prune.unref();

  // One backup per UTC day: every instance tries, but the job id is the date, so the database
  // lets exactly one through. Runs after BACKUP_HOUR_UTC (default 02:00), when it is quiet.
  const scheduleBackup = () => {
    if (!backupsEnabled()) return;
    const now = new Date();
    if (now.getUTCHours() < Number(process.env.BACKUP_HOUR_UTC ?? 2)) return;
    enqueue(BACKUP_JOB, {}, { id: `backup_${now.toISOString().slice(0, 10)}` }).catch((error) =>
      console.error('[backup] could not schedule:', error instanceof Error ? error.message.slice(0, 200) : 'unknown'),
    );
  };
  scheduleBackup();
  const backupTimer = setInterval(scheduleBackup, 30 * 60_000);
  backupTimer.unref();

  // Let a job in flight finish when the platform stops the process.
  const shutdown = () => {
    clearInterval(prune);
    clearInterval(backupTimer);
    void worker.stop();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
