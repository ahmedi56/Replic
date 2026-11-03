import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { hashPassword, createSession, setSessionCookie } from '@/lib/auth/session';
import { provisionOrganization } from '@/lib/services/org';
import { newId } from '@/lib/ids';
import { TERMS_VERSION } from '@/lib/legal';
import { sendVerification } from '@/lib/services/verification';
import { getLocale } from '@/lib/i18n/server';
import { withoutAuth, rateLimit, clientKey, ApiError } from '@/lib/api';

const schema = z.object({
  email: z.string().email('Enter a valid email address').max(200),
  // Length is the requirement that actually matters; composition rules push people to "P@ssw0rd!".
  password: z.string().min(10, 'Use at least 10 characters').max(200),
  name: z.string().max(120).optional(),
  organizationName: z.string().max(120).optional(),
  // Click-wrap: the sign-up form sends this only when the box is ticked.
  acceptTerms: z.literal(true, { error: 'Please accept the Terms of Service and Privacy Policy' }),
});

export const POST = withoutAuth(async (req) => {
  await rateLimit(clientKey(req, 'signup'), 5, 60_000);
  const body = schema.parse(await req.json());
  const email = body.email.toLowerCase().trim();

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) throw new ApiError(409, 'An account with this email already exists');

  const userId = newId('usr');
  await db.insert(users).values({
    id: userId,
    email,
    passwordHash: await hashPassword(body.password),
    name: body.name?.trim() || null,
    termsAcceptedAt: new Date(),
    termsVersion: TERMS_VERSION,
  });

  await provisionOrganization(body.organizationName?.trim() || `${body.name?.trim() || 'My'} workspace`, userId);

  // Background: the response shouldn't wait on, or reveal anything about, the mail server.
  void sendVerification(userId, email, await getLocale());

  const token = await createSession(userId);
  await setSessionCookie(token);
  return NextResponse.json({ ok: true });
});
