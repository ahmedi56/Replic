import { NextResponse } from 'next/server';
import { withAuth, rateLimit } from '@/lib/api';
import { loadDemoData, clearDemoData } from '@/lib/demo/seed';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** Replace the caller's workspace with the demo dataset. Destructive, and says so in the UI. */
export const POST = withAuth(async (auth) => {
  rateLimit(`demo:${auth.organizationId}`, 3, 60_000);
  const result = await loadDemoData(auth);
  return NextResponse.json(result, { status: 201 });
});

export const DELETE = withAuth(async (auth) => {
  rateLimit(`demo-clear:${auth.organizationId}`, 5, 60_000);
  await clearDemoData(auth);
  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    actorLabel: auth.name ?? auth.email,
    action: 'demo.cleared',
    entityType: 'organization',
    entityId: auth.organizationId,
  });
  return NextResponse.json({ ok: true });
});
