import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { listBankAccounts } from '@/lib/services/imports';
import { ImportWizard } from './wizard';
import { getLocale, makeT } from '@/lib/i18n/server';

export async function generateMetadata() {
  return { title: makeT(await getLocale())('imp.title') };
}
export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const auth = await getAuth();
  if (!auth) redirect('/login');
  const t = makeT(await getLocale());

  const accounts = await listBankAccounts(auth.organizationId);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">{t('imp.heading')}</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        {t('imp.sub')}
      </p>
      <div className="mt-6">
        <ImportWizard accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))} />
      </div>
    </div>
  );
}
