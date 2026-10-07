import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { listBankAccounts } from '@/lib/services/imports';
import { ImportWizard } from './wizard';

export const metadata = { title: 'Import bank CSV' };
export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const auth = await getAuth();
  if (!auth) redirect('/login');

  const accounts = await listBankAccounts(auth.organizationId);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">Import bank transactions</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        Export a CSV from your bank and drop it here. Every bank names its columns differently, so Reclip guesses the
        mapping and lets you correct it before anything is saved.
      </p>
      <div className="mt-6">
        <ImportWizard accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))} />
      </div>
    </div>
  );
}
