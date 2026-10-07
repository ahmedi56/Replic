import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/api';
import { confirmMatch, rejectMatch, unlinkMatch } from '@/lib/services/matching';

const schema = z.object({ action: z.enum(['confirm', 'reject', 'unlink']) });

export const PATCH = withAuth<{ id: string }>(async (auth, req, { id }) => {
  const { action } = schema.parse(await req.json());

  if (action === 'confirm') await confirmMatch(auth, id);
  else if (action === 'reject') await rejectMatch(auth, id);
  else await unlinkMatch(auth, id);

  return NextResponse.json({ ok: true });
});
