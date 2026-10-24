import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { receipts } from '@/db/schema';
import { registerJob } from './queue';
import { createBackup } from './backup';
import { PROCESS_RECEIPT_JOB, processReceipt } from './services/receipts';

/** Everything the worker knows how to do. Import this once, wherever a worker is started. */
interface ProcessReceiptPayload {
  receiptId: string;
  organizationId: string;
  userId: string;
}

export const BACKUP_JOB = 'backup';

let registered = false;

export function registerAllJobs(): void {
  if (registered) return;
  registered = true;

  registerJob<Record<string, never>>(BACKUP_JOB, {
    async run() {
      const result = await createBackup();
      console.log(`[backup] wrote ${result.key} (${Math.round(result.bytes / 1024)} KB)`);
    },
  });

  registerJob<ProcessReceiptPayload>(PROCESS_RECEIPT_JOB, {
    async run({ receiptId, organizationId, userId }) {
      await processReceipt(receiptId, organizationId, userId);
    },
    // Out of attempts: say so on the receipt instead of leaving it "processing" forever.
    async onFailed({ receiptId, organizationId }) {
      await db
        .update(receipts)
        .set({ status: 'failed', failureCode: 'processing_failed', updatedAt: new Date() })
        .where(
          and(
            eq(receipts.id, receiptId),
            eq(receipts.organizationId, organizationId),
            inArray(receipts.status, ['processing', 'extracting', 'matching']),
          ),
        );
    },
  });
}
