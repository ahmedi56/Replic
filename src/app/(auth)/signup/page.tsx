import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { AuthForm } from '../auth-form';

export const metadata = { title: 'Create your account' };

export default async function SignupPage() {
  if (await getAuth()) redirect('/app');

  return (
    <div className="card p-7 shadow-card">
      <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        50 receipts a month, free. No card required.
      </p>
      <AuthForm mode="signup" />
      <p className="mt-6 text-sm" style={{ color: 'var(--text-muted)' }}>
        Already have an account?{' '}
        <Link href="/login" className="link">
          Sign in
        </Link>
      </p>
    </div>
  );
}
