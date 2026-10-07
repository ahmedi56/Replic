'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { Alert, Spinner } from '@/components/ui';

function ResetInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const email = String(new FormData(event.currentTarget).get('email') ?? '');

    const res = await fetch('/api/auth/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(data.error ?? 'Something went wrong.');
      return;
    }
    setNotice(data.message);
    // Without a mail provider configured, the link is surfaced here in development
    // so the flow can be completed end to end.
    if (data.devLink) setDevLink(data.devLink);
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const password = String(new FormData(event.currentTarget).get('password') ?? '');

    const res = await fetch('/api/auth/reset', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(data.error ?? 'Something went wrong.');
      return;
    }
    router.push('/login');
  }

  if (token) {
    return (
      <div className="card p-7 shadow-card">
        <h1 className="text-xl font-semibold tracking-tight">Choose a new password</h1>
        <form onSubmit={confirm} className="mt-6 grid gap-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <div>
            <label className="label" htmlFor="password">
              New password
            </label>
            <input id="password" name="password" type="password" required minLength={10} className="input" autoComplete="new-password" />
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-subtle)' }}>
              At least 10 characters. This signs you out everywhere else.
            </p>
          </div>
          <button className="btn btn-primary w-full py-2.5" disabled={busy}>
            {busy && <Spinner />}
            Set new password
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="card p-7 shadow-card">
      <h1 className="text-xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        We&apos;ll send a link to your email address.
      </p>
      <form onSubmit={request} className="mt-6 grid gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && (
          <Alert tone="success">
            {notice}
            {devLink && (
              <>
                {' '}
                <Link href={devLink} className="link">
                  Open the reset link
                </Link>{' '}
                <span className="text-xs">(shown in development only)</span>
              </>
            )}
          </Alert>
        )}
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" required className="input" autoComplete="email" />
        </div>
        <button className="btn btn-primary w-full py-2.5" disabled={busy}>
          {busy && <Spinner />}
          Send reset link
        </button>
        <Link href="/login" className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Back to sign in
        </Link>
      </form>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<div className="card p-7"><Spinner /></div>}>
      <ResetInner />
    </Suspense>
  );
}
