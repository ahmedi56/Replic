'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Spinner } from '@/components/ui';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(event.currentTarget);
    const payload = {
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      ...(mode === 'signup'
        ? { name: String(form.get('name') ?? ''), organizationName: String(form.get('organizationName') ?? '') }
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
        setError(data.error ?? 'Something went wrong. Please try again.');
        setBusy(false);
        return;
      }

      // A new account goes to onboarding; a returning one straight to the dashboard.
      router.push(mode === 'signup' || data.onboarded === false ? '/app/welcome' : '/app');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
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
              Your name
            </label>
            <input id="name" name="name" className="input" autoComplete="name" placeholder="Ahmed" />
          </div>
          <div>
            <label className="label" htmlFor="organizationName">
              Workspace name <span style={{ color: 'var(--text-subtle)' }}>(optional)</span>
            </label>
            <input id="organizationName" name="organizationName" className="input" placeholder="Ahmed Consulting" />
          </div>
        </>
      )}

      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" required className="input" autoComplete="email" placeholder="you@company.com" />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={mode === 'signup' ? 10 : undefined}
          className="input"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          placeholder={mode === 'signup' ? 'At least 10 characters' : '••••••••'}
          aria-describedby={mode === 'signup' ? 'password-hint' : undefined}
        />
        {mode === 'signup' && (
          <p id="password-hint" className="mt-1.5 text-xs" style={{ color: 'var(--text-subtle)' }}>
            At least 10 characters. A passphrase works well.
          </p>
        )}
      </div>

      <button type="submit" className="btn btn-primary mt-1 w-full py-2.5" disabled={busy}>
        {busy && <Spinner />}
        {mode === 'signup' ? 'Create account' : 'Sign in'}
      </button>

      {mode === 'login' && (
        <Link href="/reset" className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Forgot your password?
        </Link>
      )}
    </form>
  );
}
