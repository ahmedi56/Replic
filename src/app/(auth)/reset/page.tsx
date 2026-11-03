'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { Alert, Spinner } from '@/components/ui';
import { useT } from '@/lib/i18n/client';

function ResetInner() {
  const t = useT();
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
      setError(data.error ?? t('common.somethingWrong'));
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
      setError(data.error ?? t('common.somethingWrong'));
      return;
    }
    router.push('/login');
  }

  if (token) {
    return (
      <div className="card p-7 shadow-card">
        <h1 className="text-xl font-semibold tracking-tight">{t('auth.newPasswordTitle')}</h1>
        <form onSubmit={confirm} className="mt-6 grid gap-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <div>
            <label className="label" htmlFor="password">
              {t('auth.newPassword')}
            </label>
            <input id="password" name="password" type="password" required minLength={10} className="input" autoComplete="new-password" />
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-subtle)' }}>
              {t('auth.newPasswordHint')}
            </p>
          </div>
          <button className="btn btn-primary w-full py-2.5" disabled={busy}>
            {busy && <Spinner />}
            {t('auth.setNewPassword')}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="card p-7 shadow-card">
      <h1 className="text-xl font-semibold tracking-tight">{t('auth.resetTitle')}</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        {t('auth.resetSubtitle')}
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
                  {t('auth.openResetLink')}
                </Link>{' '}
                <span className="text-xs">{t('auth.devOnly')}</span>
              </>
            )}
          </Alert>
        )}
        <div>
          <label className="label" htmlFor="email">
            {t('common.email')}
          </label>
          <input id="email" name="email" type="email" required className="input" autoComplete="email" />
        </div>
        <button className="btn btn-primary w-full py-2.5" disabled={busy}>
          {busy && <Spinner />}
          {t('auth.sendReset')}
        </button>
        <Link href="/login" className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('auth.backToSignIn')}
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
