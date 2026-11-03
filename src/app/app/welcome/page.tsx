import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { Onboarding } from './onboarding';
import { getLocale, makeT } from '@/lib/i18n/server';

export async function generateMetadata() {
  return { title: makeT(await getLocale())('ob.meta') };
}
export const dynamic = 'force-dynamic';

export default async function WelcomePage() {
  const auth = await getAuth();
  if (!auth) redirect('/login');

  return (
    <div className="mx-auto max-w-2xl">
      <Onboarding name={auth.name ?? auth.email.split('@')[0]} />
    </div>
  );
}
