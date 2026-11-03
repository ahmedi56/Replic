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
import { getLocale, makeT } from '@/lib/i18n/server';
import { FORMAT_LOCALE } from '@/lib/i18n/config';
import { formatNumber } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/config';

export async function generateMetadata() {
  return { title: makeT(await getLocale())('st.title') };
}

/** Plan dates are calendar days in UTC (the day on the invoice), so everyone sees the same day. Only the wording follows the language. */
const planDate = (d: Date | null, locale: Locale) =>
  d ? new Intl.DateTimeFormat(FORMAT_LOCALE[locale], { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d) : '';
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const auth = await getAuth();
  if (!auth) redirect('/login');
  const locale = await getLocale();
  const t = makeT(locale);

  const [subscription, effective] = await Promise.all([getSubscription(auth.organizationId), getEffectiveSubscription(auth.organizationId)]);
  const supportEmail = process.env.SUPPORT_EMAIL;
  const [config, stats, events] = await Promise.all([
    getMatchingConfig(auth.organizationId),
    getDashboardStats(auth.organizationId),
    listSecurityEvents(auth.userId),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">{t('st.title')}</h1>
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
            <h2 className="text-sm font-semibold">{t('st.plan')}</h2>
            <p className="mt-2 text-sm">
              <span className="font-medium">{t(`land.plan.${effective.plan.id}.name` as MessageKey)}</span>
              {' · '}
              {t('st.quota', { n: formatNumber(effective.receiptQuota, locale) })}
            </p>
            {effective.plan.id !== 'free' && subscription.currentPeriodEnd && (
              <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                {t('st.activeUntil', { date: planDate(subscription.currentPeriodEnd, locale) })}
                {effective.daysLeft !== null && effective.daysLeft <= 30
                  ? effective.daysLeft === 1
                    ? t('st.daysLeftOne')
                    : t('st.daysLeftMany', { n: effective.daysLeft })
                  : ''}
              </p>
            )}
            {effective.expired && (
              <p className="mt-1 text-sm" style={{ color: 'var(--warn)' }}>
                {t('st.expired', { plan: t(`land.plan.${subscription.plan}.name` as MessageKey), date: planDate(subscription.currentPeriodEnd, locale) })}
              </p>
            )}
            {supportEmail && (
              <p className="mt-3 text-xs" style={{ color: 'var(--text-subtle)' }}>
                {t('st.upgradePre')}
                <a className="link" href={`mailto:${supportEmail}`}>{supportEmail}</a>
                {t('st.upgradePost')}
              </p>
            )}
          </Card>
        )}
        <AccountSection events={events.map((e) => ({ id: e.id, type: e.type, ip: e.ip, createdAt: e.createdAt.toISOString() }))} />
      </div>
    </div>
  );
}
