import 'server-only';
import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { newId } from './ids';

/**
 * Financial data is never modified silently. Every mutation that a user could later
 * question — a match confirmed, a field edited, an import committed, a receipt deleted —
 * writes a line here, attributed to a person or to "System".
 */
export type AuditAction =
  | 'receipt.uploaded'
  | 'receipt.extracted'
  | 'receipt.edited'
  | 'receipt.deleted'
  | 'receipt.duplicate_flagged'
  | 'receipt.duplicate_cleared'
  | 'receipt.document_replaced'
  | 'match.auto'
  | 'match.suggested'
  | 'match.confirmed'
  | 'match.rejected'
  | 'match.manual'
  | 'match.unlinked'
  | 'import.created'
  | 'import.blocked_duplicate'
  | 'transaction.edited'
  | 'export.generated'
  | 'demo.loaded'
  | 'demo.cleared';

export async function recordAudit(entry: {
  organizationId: string;
  userId?: string | null;
  actorLabel?: string;
  action: AuditAction;
  entityType: 'receipt' | 'transaction' | 'match' | 'import' | 'organization';
  entityId: string;
  detail?: string;
}): Promise<void> {
  await db.insert(auditLogs).values({
    id: newId('log'),
    organizationId: entry.organizationId,
    userId: entry.userId ?? null,
    actorLabel: entry.actorLabel ?? 'System',
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    detail: entry.detail ?? null,
  });
}

/** Bulk variant for import/matching runs, so one action isn't one write per row. */
export async function recordAuditBatch(
  entries: Array<Parameters<typeof recordAudit>[0]>,
): Promise<void> {
  if (!entries.length) return;
  await db.insert(auditLogs).values(
    entries.map((entry) => ({
      id: newId('log'),
      organizationId: entry.organizationId,
      userId: entry.userId ?? null,
      actorLabel: entry.actorLabel ?? 'System',
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      detail: entry.detail ?? null,
    })),
  );
}
