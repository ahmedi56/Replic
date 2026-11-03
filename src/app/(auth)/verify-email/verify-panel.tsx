'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Spinner } from '@/components/ui';
import { useT } from '@/lib/i18n/client';

export function VerifyPanel({ token, email }: { token: string | null; email: string | null }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? t('common.somethingWrong'));
        return;
      }
      setDone(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/auth/verify/resend', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? t('common.somethingWrong'));
      else setNotice(t('auth.resent'));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  if (token) {
    return (
      <div className="card p-7 shadow-card">
        <h1 className="text-xl font-semibold tracking-tight">{done ? t('auth.verifyDoneTitle') : t('auth.verifyTitle')}</h1>
        <div className="mt-6 grid gap-4">
          {error && <Alert tone="danger">{error}</Alert>}
          {done ? (
            <Link href="/app" className="btn btn-primary w-full py-2.5">
              {t('auth.continue')}
            </Link>
          ) : (
            <button onClick={confirm} className="btn btn-primary w-full py-2.5" disabled={busy}>
              {busy && <Spinner />}
              {t('auth.confirmEmail')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card p-7 shadow-card">
      <h1 className="text-xl font-semibold tracking-tight">{t('auth.checkEmailTitle')}</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        {t('auth.checkEmailBody', { to: email ? t('auth.checkEmailTo', { email }) : '' })}
      </p>
      <div className="mt-6 grid gap-3">
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        <button onClick={resend} className="btn btn-primary w-full py-2.5" disabled={busy}>
          {busy && <Spinner />}
          {t('auth.resend')}
        </button>
        <button onClick={signOut} className="btn btn-ghost w-full py-2.5">
          {t('common.signOut')}
        </button>
      </div>
    </div>
  );
}
