import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getAuth, type AuthContext } from './auth/session';
import { clientIp } from './client-ip';
import { captureError } from './monitoring';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { rateLimits } from '@/db/schema';

/**
 * Shared API plumbing: authentication, error shaping and rate limiting.
 *
 * Two rules every route follows:
 *  - a handler receives an `AuthContext` or never runs;
 *  - errors are shaped here, so an internal message never reaches the client.
 */

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

export function badRequest(message: string, code?: string): ApiError {
  return new ApiError(400, message, code);
}
export function notFound(message = 'Not found'): ApiError {
  return new ApiError(404, message);
}
export function forbidden(message = 'Not allowed'): ApiError {
  return new ApiError(403, message);
}

type Handler<T> = (ctx: AuthContext, req: Request, params: T) => Promise<NextResponse | Response>;

export function withAuth<T = Record<string, string>>(handler: Handler<T>, options: { allowUnverified?: boolean } = {}) {
  // Next 15 types a route's second argument as a required context whose `params` is a
  // promise. Static routes still receive one, so it is accepted here and simply resolves
  // to an empty object.
  return async (req: Request, context: { params: Promise<T> }): Promise<Response> => {
    try {
      const auth = await getAuth();
      if (!auth) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
      if (!auth.emailVerified && !options.allowUnverified) {
        return NextResponse.json({ error: 'Verify your email address to continue', code: 'email_unverified' }, { status: 403 });
      }
      const params = context?.params ? await context.params : ({} as T);
      return await handler(auth, req, params);
    } catch (error) {
      return toResponse(error);
    }
  };
}

export function withoutAuth(handler: (req: Request) => Promise<NextResponse | Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (error) {
      return toResponse(error);
    }
  };
}

function toResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return NextResponse.json(
      { error: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input', code: 'validation' },
      { status: 400 },
    );
  }
  // `req.json()` throws SyntaxError on a malformed body: the caller's mistake, not ours.
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: 'Request body must be valid JSON', code: 'invalid_json' }, { status: 400 });
  }
  // Log server-side, return something generic. Never leak internals to the client.
  // Drizzle's own message embeds the query parameters (emails, hashes), so it is never logged.
  // The wrapped Postgres error in `cause` says what actually went wrong.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
  captureError(error);
  console.error('[api] unhandled error:', cause ?? (error instanceof Error && !error.message.startsWith('Failed query') ? error.message : 'database or internal error'));
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}

/**
 * Fixed-window rate limiter backed by the database, so every app instance shares one count
 * per key (an in-memory map would give each instance its own allowance, multiplying the
 * limit by the number of servers). One atomic upsert per call: it either starts a new window
 * or increments the current one, and returns the new count.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const windowEnd = new Date(Date.now() + windowMs);
  const expired = sql`${rateLimits.resetAt} < now()`;

  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt: windowEnd })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        resetAt: sql`case when ${expired} then excluded.reset_at else ${rateLimits.resetAt} end`,
      },
    })
    .returning({ count: rateLimits.count });

  if (row.count > limit) {
    throw new ApiError(429, 'Too many requests. Please wait a moment and try again.', 'rate_limited');
  }

  // Housekeeping: expired windows are dead weight, and a sweep on ~1% of calls keeps the table small.
  if (Math.random() < 0.01) await db.delete(rateLimits).where(sql`${rateLimits.resetAt} < now()`);
}

export function clientKey(req: Request, scope: string): string {
  return `${scope}:${clientIp(req.headers)}`;
}
