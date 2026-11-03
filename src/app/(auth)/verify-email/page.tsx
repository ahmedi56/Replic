import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { VerifyPanel } from './verify-panel';
import { getLocale, makeT } from '@/lib/i18n/server';

export async function generateMetadata() {
  return { title: makeT(await getLocale())('meta.confirmEmail') };
}
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
