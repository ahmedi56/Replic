import { NextResponse } from 'next/server';
import { withAuth, rateLimit } from '@/lib/api';
import { sendVerification } from '@/lib/services/verification';
import { getLocale } from '@/lib/i18n/server';

/** Send a fresh verification email. Open to unverified users, who are the ones who need it. */
export const POST = withAuth(
  async (auth) => {
    await rateLimit(`verify-resend:${auth.userId}`, 3, 10 * 60_000);
    await sendVerification(auth.userId, auth.email, await getLocale());
    return NextResponse.json({ ok: true });
  },
  { allowUnverified: true },
);
