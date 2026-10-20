import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { getMatchingConfig } from '@/lib/services/org';
import { availableProviders } from '@/lib/ai/registry';
import { getDashboardStats } from '@/lib/services/stats';
import { listSecurityEvents } from '@/lib/services/security';
import { SettingsForm } from './settings-form';
import { AccountSection } from './account-section';

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const auth = await getAuth();
  if (!auth) redirect('/login');

  const [config, stats, events] = await Promise.all([
    getMatchingConfig(auth.organizationId),
    getDashboardStats(auth.organizationId),
    listSecurityEvents(auth.userId),
  ]);

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
      <div className="mt-5 grid gap-5">
        <AccountSection events={events.map((e) => ({ id: e.id, type: e.type, ip: e.ip, createdAt: e.createdAt.toISOString() }))} />
      </div>
    </div>
  );
}
