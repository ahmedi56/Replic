import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { AppShell } from '@/components/app-shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  if (!auth) redirect('/login');
  if (!auth.emailVerified) redirect('/verify-email');

  return (
    <AppShell userName={auth.name ?? auth.email} organizationName={auth.organizationName}>
      {children}
    </AppShell>
  );
}
