import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { withAuth, ApiError } from '@/lib/api';
import { getMatchingConfig, saveMatchingConfig } from '@/lib/services/org';
import { availableProviders } from '@/lib/ai/registry';

const weight = z.number().min(0).max(1);
const schema = z.object({
  weights: z
    .object({ amount: weight, date: weight, merchant: weight, currency: weight, paymentMethod: weight })
    .partial()
    .optional(),
  thresholds: z
    .object({ auto: z.number().min(1).max(100), review: z.number().min(1).max(100), possible: z.number().min(0).max(100) })
    .partial()
    .optional(),
  date: z.object({ maxDaysAfter: z.number().min(0).max(60), maxDaysBefore: z.number().min(0).max(60) }).partial().optional(),
  amount: z.object({ maxRelativeDelta: z.number().min(0).max(0.5) }).partial().optional(),
  persona: z.enum(['freelancer', 'small_business', 'accountant', 'other']).optional(),
});

export const GET = withAuth(async (auth) =>
  NextResponse.json({
    matching: await getMatchingConfig(auth.organizationId),
    providers: { extraction: availableProviders.extraction(), semantic: availableProviders.semantic() },
    configured: {
      extraction: process.env.EXTRACTION_PROVIDER ?? 'local',
      semantic: process.env.SEMANTIC_PROVIDER ?? 'local',
    },
  }),
);

export const PUT = withAuth(async (auth, req) => {
  const body = schema.parse(await req.json());

  if (body.persona) {
    await db.update(users).set({ persona: body.persona, onboardedAt: new Date() }).where(eq(users.id, auth.userId));
  }

  const { persona, ...matching } = body;
  if (Object.keys(matching).length) {
    const current = await getMatchingConfig(auth.organizationId);
    const next = {
      ...current,
      weights: { ...current.weights, ...matching.weights },
      thresholds: { ...current.thresholds, ...matching.thresholds },
      date: { ...current.date, ...matching.date },
      amount: { ...current.amount, ...matching.amount },
    };

    // Checked on the merged result: each field is valid alone, but a combination can still
    // make matching meaningless (nothing can ever score, or "auto" sits below "review").
    const { auto, review, possible } = next.thresholds;
    if (!(auto >= review && review >= possible)) {
      throw new ApiError(400, 'Thresholds must satisfy: automatic >= review >= possible', 'validation');
    }
    if (Object.values(next.weights).reduce((sum, w) => sum + w, 0) <= 0) {
      throw new ApiError(400, 'At least one matching weight must be above zero', 'validation');
    }

    await saveMatchingConfig(auth.organizationId, next);
  }

  return NextResponse.json({ ok: true, matching: await getMatchingConfig(auth.organizationId) });
});
