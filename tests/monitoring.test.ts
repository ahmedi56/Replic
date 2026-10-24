import os from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';
import { sanitizeError, scrubEvent, initMonitoring, captureError, monitoringEnabled } from '@/lib/monitoring';

// Built at runtime, so these values exist only in the error's data. Sentry attaches the source
// lines around a stack frame, and a literal here would end up in the event through the code.
const EMAIL = ['jane', 'example.com'].join('@');
const HASH = ['HASH', 'VALUE', '123456'].join('');

/** What Drizzle throws for a failed insert: the message embeds the parameter values. */
function drizzleError() {
  const cause = new Error('duplicate key value violates unique constraint "users_email_unique"');
  return new Error(`Failed query: insert into "users" ("id","email","password_hash") values ($1,$2,$3)\nparams: usr_1,${EMAIL},${HASH}`, { cause });
}

describe('sanitizeError', () => {
  it('replaces a database error with the Postgres message, dropping every parameter value', () => {
    const safe = sanitizeError(drizzleError());
    expect(safe.message).toBe('Database query failed: duplicate key value violates unique constraint "users_email_unique"');
    expect(safe.message).not.toContain(EMAIL);
    expect(safe.stack ?? '').not.toContain(EMAIL);
    expect(safe.stack ?? '').not.toContain(HASH);
  });

  it('leaves ordinary errors alone', () => {
    const error = new Error('Receipt not found');
    expect(sanitizeError(error)).toBe(error);
  });

  it('survives things that are not errors', () => {
    expect(sanitizeError('boom').message).toBe('Unknown error');
    expect(sanitizeError(undefined).message).toBe('Unknown error');
  });
});

describe('scrubEvent', () => {
  it('removes user, host name, cookies, headers, bodies, query strings and breadcrumbs', () => {
    const scrubbed = scrubEvent({
      message: 'x',
      user: { email: EMAIL, ip_address: '1.2.3.4' },
      server_name: 'my-secret-hostname',
      request: {
        method: 'POST',
        url: 'https://app.example.com/api/auth/reset?token=SECRET',
        cookies: { reclip_session: 'SECRET' },
        headers: { authorization: 'Bearer SECRET' },
        data: { password: 'SECRET' },
      },
      breadcrumbs: [{ message: 'visited /reset?token=SECRET' }],
    });
    const text = JSON.stringify(scrubbed);
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('my-secret-hostname');
    expect(text).not.toContain(EMAIL);
    expect(scrubbed.request).toEqual({ method: 'POST', url: 'https://app.example.com/api/auth/reset' });
  });

  it('rewrites a database error that reaches the event as an exception value', () => {
    const scrubbed = scrubEvent({ exception: { values: [{ type: 'Error', value: drizzleError().message }] } });
    expect(JSON.stringify(scrubbed)).not.toContain(EMAIL);
  });
});

describe('with no SENTRY_DSN', () => {
  it('does nothing and never throws', async () => {
    delete process.env.SENTRY_DSN;
    expect(await initMonitoring()).toBe(false);
    expect(monitoringEnabled()).toBe(false);
    expect(() => captureError(new Error('ignored'))).not.toThrow();
  });
});

describe('with Sentry switched on (events captured locally, nothing sent)', () => {
  afterEach(() => {
    delete process.env.SENTRY_DSN;
  });

  it('reports an error, and what is sent contains no personal data', async () => {
    const sent: string[] = [];
    process.env.SENTRY_DSN = 'https://publickey@o0.ingest.sentry.io/0';
    const on = await initMonitoring({
      transport: () => ({
        send: async (envelope: unknown) => {
          sent.push(JSON.stringify(envelope));
          return {};
        },
        flush: async () => true,
      }),
    });
    expect(on).toBe(true);

    captureError(drizzleError(), { job: 'process_receipt', attempts: 3 });
    const Sentry = await import('@sentry/node');
    await Sentry.flush(2000);

    const payload = sent.join('\n');
    expect(payload).toContain('Database query failed');
    expect(payload).toContain('users_email_unique');
    expect(payload).not.toContain(EMAIL);
    expect(payload).not.toContain(HASH);
    expect(payload).not.toContain(os.hostname()); // the server's machine name is dropped too
  });
});
