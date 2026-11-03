import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { AuthForm } from '../auth-form';
import { getLocale, makeT } from '@/lib/i18n/server';

export async function generateMetadata() {
  return { title: makeT(await getLocale())('meta.createAccount') };
}

export default async function SignupPage() {
  if (await getAuth()) redirect('/app');
  const t = makeT(await getLocale());

  return (
    <div className="card p-7 shadow-card">
      <h1 className="text-xl font-semibold tracking-tight">{t('auth.signupTitle')}</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        {t('auth.signupSubtitle')}
      </p>
      <AuthForm mode="signup" />
      <p className="mt-6 text-sm" style={{ color: 'var(--text-muted)' }}>
        {t('auth.haveAccount')}{' '}
        <Link href="/login" className="link">
          {t('auth.signIn')}
        </Link>
      </p>
    </div>
  );
}
