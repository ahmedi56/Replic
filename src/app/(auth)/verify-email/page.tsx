import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { VerifyPanel } from './verify-panel';

export const metadata = { title: 'Confirm your email' };
export const dynamic = 'force-dynamic';

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const auth = await getAuth();

  // Opening the link is not enough (mail scanners open links); the person presses the button.
  if (!token) {
    if (!auth) redirect('/login');
    if (auth.emailVerified) redirect('/app');
  }

  return <VerifyPanel token={token ?? null} email={auth?.email ?? null} />;
}
