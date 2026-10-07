import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { Onboarding } from './onboarding';

export const metadata = { title: 'Welcome' };
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
