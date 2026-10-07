import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { AuthForm } from '../auth-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage() {
  if (await getAuth()) redirect('/app');

  return (
    <div className="card p-7 shadow-card">
      <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        Sign in to pick up your reconciliation.
      </p>
      <AuthForm mode="login" />
      <p className="mt-6 text-sm" style={{ color: 'var(--text-muted)' }}>
        New here?{' '}
        <Link href="/signup" className="link">
          Create an account
        </Link>
      </p>
    </div>
  );
}
