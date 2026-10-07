import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { getMatchingConfig } from '@/lib/services/org';
import { availableProviders } from '@/lib/ai/registry';
import { getDashboardStats } from '@/lib/services/stats';
import { SettingsForm } from './settings-form';

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const auth = await getAuth();
  if (!auth) redirect('/login');

  const [config, stats] = await Promise.all([getMatchingConfig(auth.organizationId), getDashboardStats(auth.organizationId)]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        {auth.organizationName} · {auth.email}
      </p>
      <div className="mt-6">
        <SettingsForm
          config={config}
          providers={{
            extraction: process.env.EXTRACTION_PROVIDER ?? 'local',
            semantic: process.env.SEMANTIC_PROVIDER ?? 'local',
            availableExtraction: availableProviders.extraction(),
            availableSemantic: availableProviders.semantic(),
          }}
          hasData={stats.receipts > 0 || stats.transactions > 0}
        />
      </div>
    </div>
  );
}
