import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { getMatchingConfig } from '@/lib/services/org';
import { availableProviders } from '@/lib/ai/registry';
import { getDashboardStats } from '@/lib/services/stats';
import { listSecurityEvents } from '@/lib/services/security';
import { getEffectiveSubscription, getSubscription } from '@/lib/services/plans';
import { Card } from '@/components/ui';
import { SettingsForm } from './settings-form';
import { AccountSection } from './account-section';

export const metadata = { title: 'Settings' };

/** Plan dates are calendar days in UTC (the day on the invoice), so show them the same way for everyone. */
const planDate = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d) : '';
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const auth = await getAuth();
  if (!auth) redirect('/login');

  const [subscription, effective] = await Promise.all([getSubscription(auth.organizationId), getEffectiveSubscription(auth.organizationId)]);
  const supportEmail = process.env.SUPPORT_EMAIL;
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
        {subscription && effective && (
          <Card className="p-5">
            <h2 className="text-sm font-semibold">Plan</h2>
            <p className="mt-2 text-sm">
              <span className="font-medium">{effective.plan.name}</span>
              {' · '}
              {effective.receiptQuota.toLocaleString('en-GB')} receipts a month
            </p>
            {effective.plan.id !== 'free' && subscription.currentPeriodEnd && (
              <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                Active until {planDate(subscription.currentPeriodEnd)}
                {effective.daysLeft !== null && effective.daysLeft <= 30 ? ` (${effective.daysLeft} day${effective.daysLeft === 1 ? '' : 's'} left)` : ''}
              </p>
            )}
            {effective.expired && (
              <p className="mt-1 text-sm" style={{ color: 'var(--warn)' }}>
                Your {subscription.plan} plan ended on {planDate(subscription.currentPeriodEnd)}. You keep all your data and the Free limit applies until you renew.
              </p>
            )}
            {supportEmail && (
              <p className="mt-3 text-xs" style={{ color: 'var(--text-subtle)' }}>
                To upgrade or renew, email <a className="link" href={`mailto:${supportEmail}`}>{supportEmail}</a>. Payment is by bank transfer against an invoice.
              </p>
            )}
          </Card>
        )}
        <AccountSection events={events.map((e) => ({ id: e.id, type: e.type, ip: e.ip, createdAt: e.createdAt.toISOString() }))} />
      </div>
    </div>
  );
}
