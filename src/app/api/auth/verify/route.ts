import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withoutAuth, rateLimit, clientKey, ApiError } from '@/lib/api';
import { verifyEmailToken } from '@/lib/services/verification';

const schema = z.object({ token: z.string().min(10).max(200) });

/** Confirm an email address from the link in the verification email. */
export const POST = withoutAuth(async (req) => {
  await rateLimit(clientKey(req, 'verify'), 20, 60_000);
  const { token } = schema.parse(await req.json());
  if (!(await verifyEmailToken(token, req))) throw new ApiError(400, 'This link is invalid or has expired');
  return NextResponse.json({ ok: true });
});
