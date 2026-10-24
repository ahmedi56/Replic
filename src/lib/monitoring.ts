import 'server-only';

/**
 * Error tracking, optional and privacy-first.
 *
 * Set SENTRY_DSN to turn it on; without it every function here does nothing. Reclip handles
 * financial documents, so what leaves the server is deliberately thin: no cookies, no request
 * headers or bodies, no user identity, and database errors are reduced to the Postgres message,
 * because Drizzle's own error text includes the query's parameter values (emails, hashes).
 */

type SentryModule = typeof import('@sentry/node');
let sentry: SentryModule | null = null;

/** Drizzle prefixes failed statements with this; its text carries the parameter values. */
const QUERY_ERROR = /^Failed query:/;

/** The safe part of an error: never a query's parameters. Keeps the stack for debugging. */
export function sanitizeError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error('Unknown error');
  if (!QUERY_ERROR.test(error.message)) return error;

  const cause = error.cause instanceof Error ? error.cause.message : 'database error';
  const safe = new Error(`Database query failed: ${cause}`);
  safe.name = error.name;
  safe.stack = error.stack?.replace(error.message, safe.message);
  return safe;
}

/** Strip everything personal from an event before it is sent. Exported for testing. */
export function scrubEvent<T extends Record<string, any>>(event: T): T {
  const scrubbed: Record<string, any> = { ...event };
  delete scrubbed.user;
  // The machine's name says something about the infrastructure and nothing useful about the bug.
  delete scrubbed.server_name;
  if (scrubbed.request) {
    // Keep what is needed to find the route: method and path, without the query string.
    const { method, url } = scrubbed.request as { method?: string; url?: string };
    scrubbed.request = { method, url: url?.split('?')[0] };
  }
  if (scrubbed.exception?.values) {
    scrubbed.exception = {
      ...scrubbed.exception,
      values: scrubbed.exception.values.map((v: { value?: string }) =>
        v.value && QUERY_ERROR.test(v.value) ? { ...v, value: 'Database query failed' } : v,
      ),
    };
  }
  if (typeof scrubbed.message === 'string' && QUERY_ERROR.test(scrubbed.message)) scrubbed.message = 'Database query failed';
  // Breadcrumbs can include logged text and URLs with tokens.
  delete scrubbed.breadcrumbs;
  return scrubbed as T;
}

/** Turn error tracking on when SENTRY_DSN is set. Safe to call more than once. */
export async function initMonitoring(overrides: Partial<import('@sentry/node').NodeOptions> = {}): Promise<boolean> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  if (sentry) return true;

  const module = await import('@sentry/node');
  module.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    // This SDK version sends no personal data by default; beforeSend makes it explicit and
    // also strips anything the framework adds (URLs with queries, breadcrumbs, user).
    beforeSend: (event) => scrubEvent(event),
    ...overrides, // tests supply a transport so nothing leaves the machine
  });
  sentry = module;
  return true;
}

/** Report a problem. Never throws, and never reports anything personal. */
export function captureError(error: unknown, context?: Record<string, string | number>): void {
  if (!sentry) return;
  try {
    sentry.withScope((scope) => {
      if (context) scope.setContext('reclip', context);
      sentry!.captureException(sanitizeError(error));
    });
  } catch {
    // Monitoring must never be the thing that breaks a request.
  }
}

export function monitoringEnabled(): boolean {
  return sentry !== null;
}
