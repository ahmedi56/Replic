'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Spinner } from '@/components/ui';
import { useApiError, useT } from '@/lib/i18n/client';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const t = useT();
  const apiError = useApiError();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(event.currentTarget);
    if (mode === 'signup' && form.get('acceptTerms') !== 'on') {
      setError(t('auth.acceptTermsError'));
      setBusy(false);
      return;
    }
    const payload = {
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      ...(mode === 'signup'
        ? {
            name: String(form.get('name') ?? ''),
            organizationName: String(form.get('organizationName') ?? ''),
            acceptTerms: form.get('acceptTerms') === 'on',
          }
        : {}),
    };

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(apiError(data.error) ?? t('common.tryAgain'));
        setBusy(false);
        return;
      }

      // A new account goes to onboarding; a returning one straight to the dashboard.
      router.push(mode === 'signup' || data.onboarded === false ? '/app/welcome' : '/app');
      router.refresh();
    } catch {
      setError(t('common.offline'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}

      {mode === 'signup' && (
        <>
          <div>
            <label className="label" htmlFor="name">
              {t('auth.yourName')}
            </label>
            <input id="name" name="name" className="input" autoComplete="name" placeholder="Ahmed" />
          </div>
          <div>
            <label className="label" htmlFor="organizationName">
              {t('auth.workspaceName')} <span style={{ color: 'var(--text-subtle)' }}>{t('common.optional')}</span>
            </label>
            <input id="organizationName" name="organizationName" className="input" placeholder="Ahmed Consulting" />
          </div>
        </>
      )}

      <div>
        <label className="label" htmlFor="email">
          {t('common.email')}
        </label>
        <input id="email" name="email" type="email" required className="input" autoComplete="email" placeholder="you@company.com" />
      </div>

      <div>
        <label className="label" htmlFor="password">
          {t('common.password')}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={mode === 'signup' ? 10 : undefined}
          className="input"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          placeholder={mode === 'signup' ? t('auth.passwordPlaceholderNew') : '••••••••'}
          aria-describedby={mode === 'signup' ? 'password-hint' : undefined}
        />
        {mode === 'signup' && (
          <p id="password-hint" className="mt-1.5 text-xs" style={{ color: 'var(--text-subtle)' }}>
            {t('auth.passwordHint')}
          </p>
        )}
      </div>

      {mode === 'signup' && (
        <label className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--text-muted)' }}>
          <input type="checkbox" name="acceptTerms" required className="mt-1" />
          <span>
            {t('auth.agreePrefix')}{' '}
            <Link href="/terms" target="_blank" className="link">
              {t('auth.terms')}
            </Link>{' '}
            {t('auth.and')}{' '}
            <Link href="/privacy" target="_blank" className="link">
              {t('auth.privacy')}
            </Link>
            .
          </span>
        </label>
      )}

      <button type="submit" className="btn btn-primary mt-1 w-full py-2.5" disabled={busy}>
        {busy && <Spinner />}
        {mode === 'signup' ? t('auth.createAccount') : t('auth.signIn')}
      </button>

      {mode === 'login' && (
        <Link href="/reset" className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('auth.forgot')}
        </Link>
      )}
    </form>
  );
}
