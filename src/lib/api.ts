import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getAuth, type AuthContext } from './auth/session';

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

export function withAuth<T = Record<string, string>>(handler: Handler<T>) {
  // Next 15 types a route's second argument as a required context whose `params` is a
  // promise. Static routes still receive one, so it is accepted here and simply resolves
  // to an empty object.
  return async (req: Request, context: { params: Promise<T> }): Promise<Response> => {
    try {
      const auth = await getAuth();
      if (!auth) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
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
  console.error('[api] unhandled error:', error instanceof Error ? error.message : 'unknown');
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}

/**
 * In-process fixed-window rate limiter.
 *
 * Adequate for a single-node MVP deployment; swap for a shared store (Redis) before
 * running more than one instance, since each process keeps its own counters.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count++;
  if (bucket.count > limit) {
    throw new ApiError(429, 'Too many requests. Please wait a moment and try again.', 'rate_limited');
  }

  // Opportunistic cleanup so the map cannot grow without bound.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }
}

export function clientKey(req: Request, scope: string): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
  return `${scope}:${ip}`;
}
