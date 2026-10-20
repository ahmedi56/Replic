import { NextResponse } from 'next/server';
import { withAuth, rateLimit } from '@/lib/api';
import { sendVerification } from '@/lib/services/verification';

/** Send a fresh verification email. Open to unverified users, who are the ones who need it. */
export const POST = withAuth(
  async (auth) => {
    rateLimit(`verify-resend:${auth.userId}`, 3, 10 * 60_000);
    await sendVerification(auth.userId, auth.email);
    return NextResponse.json({ ok: true });
  },
  { allowUnverified: true },
);
