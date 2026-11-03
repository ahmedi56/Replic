import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { ReclipLogoFull, ReclipMark } from '@/components/brand';
import { LanguageSwitcher } from '@/components/language-switcher';
import { PRICING_PLANS } from '@/lib/pricing';
import { getLocale, makeT } from '@/lib/i18n/server';
import { formatNumber } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n/messages';
import { HeroDemo } from './_landing/hero-demo';

const PROBLEMS = [1, 2, 3] as const;
const STEPS = [1, 2, 3, 4, 5] as const;
const FEATURES = [1, 2, 3, 4, 5, 6] as const;
const SECURITY = [1, 2, 3, 4, 5] as const;
const PLAN_FEATURES = [1, 2, 3, 4] as const;

export default async function LandingPage() {
  // Someone already signed in doesn't need the pitch.
  if (await getAuth()) redirect('/app');

  const locale = await getLocale();
  const t = makeT(locale);
  // Keys that are built from a number or a plan id cannot be checked by the compiler, so
  // the translation test (tests/i18n.test.ts) covers that every language has them.
  const k = (key: string) => key as MessageKey;

  return (
    <div style={{ background: 'var(--surface)' }}>
      <header className="sticky top-0 z-40 border-b backdrop-blur" style={{ background: 'color-mix(in srgb, var(--surface) 85%, transparent)' }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <ReclipLogoFull height={52} />
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link href="#how" className="hidden rounded-lg px-3 py-2 text-sm sm:block" style={{ color: 'var(--text-muted)' }}>
              {t('land.navHow')}
            </Link>
            <Link href="#pricing" className="hidden rounded-lg px-3 py-2 text-sm sm:block" style={{ color: 'var(--text-muted)' }}>
              {t('land.navPricing')}
            </Link>
            <LanguageSwitcher className="mr-1" />
            <Link href="/login" className="btn btn-ghost">
              {t('auth.signIn')}
            </Link>
            <Link href="/signup" className="btn btn-primary">
              {t('land.start')}
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pb-8 pt-16 sm:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <p className="chip mb-5 inline-flex" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent-ink)' }}>
                {t('land.badge')}
              </p>
              <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">{t('land.h1')}</h1>
              <p className="mt-5 max-w-lg text-lg leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {t('land.lead')}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/signup" className="btn btn-accent px-5 py-2.5">
                  {t('land.start')}
                </Link>
                <Link href="#how" className="btn btn-ghost px-5 py-2.5">
                  {t('land.seeHow')}
                </Link>
              </div>
              <p className="mt-4 text-xs" style={{ color: 'var(--text-subtle)' }}>
                {t('land.freeNote')}
              </p>
            </div>

            <HeroDemo />
          </div>
        </section>

        {/* Problem */}
        <section className="mx-auto max-w-6xl px-4 py-20">
          <div className="card px-6 py-10 sm:px-12" style={{ background: 'var(--surface-sunken)' }}>
            <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">{t('land.problem.title')}</h2>
            <p className="mt-4 max-w-2xl leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {t('land.problem.body')}
            </p>
            <dl className="mt-10 grid gap-8 sm:grid-cols-3">
              {PROBLEMS.map((n) => (
                <div key={n}>
                  <dt className="text-sm font-semibold">{t(k(`land.problem.${n}.term`))}</dt>
                  <dd className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {t(k(`land.problem.${n}.detail`))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('land.how.title')}</h2>
          <p className="mt-3 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
            {t('land.how.sub')}
          </p>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((n) => (
              <li key={n} className="card p-5">
                <span
                  className="num flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
                  style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent-ink)' }}
                >
                  {n}
                </span>
                <h3 className="mt-3 text-sm font-semibold">{t(k(`land.how.${n}.title`))}</h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {t(k(`land.how.${n}.body`))}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('land.feat.title')}</h2>
          <p className="mt-3 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
            {t('land.feat.sub')}
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((n) => (
              <div key={n} className="card p-5">
                <h3 className="text-sm font-semibold">{t(k(`land.feat.${n}.title`))}</h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {t(k(`land.feat.${n}.body`))}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Security */}
        <section className="mx-auto max-w-6xl px-4 py-16">
          <div className="card overflow-hidden">
            <div className="grid gap-8 p-8 sm:p-12 lg:grid-cols-2">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">{t('land.sec.title')}</h2>
                <p className="mt-4 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {t('land.sec.p1')}
                </p>
                <p className="mt-4 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {t('land.sec.p2')}
                </p>
                <Link href="/privacy" className="link mt-5 inline-block text-sm">
                  {t('land.sec.link')}
                </Link>
              </div>
              <ul className="grid content-start gap-3">
                {SECURITY.map((n) => (
                  <li key={n} className="flex items-start gap-2.5 text-sm">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true">
                      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span style={{ color: 'var(--text-muted)' }}>{t(k(`land.sec.${n}`))}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('land.price.title')}</h2>
          <p className="mt-3" style={{ color: 'var(--text-muted)' }}>
            {t('land.price.sub')}
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {PRICING_PLANS.map((plan) => (
              <div key={plan.id} className="card flex flex-col p-6" style={plan.highlighted ? { borderColor: 'var(--accent)' } : undefined}>
                {plan.highlighted && (
                  <span className="chip mb-3 self-start" style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent-ink)' }}>
                    {t('land.price.popular')}
                  </span>
                )}
                <h3 className="text-sm font-semibold">{t(k(`land.plan.${plan.id}.name`))}</h3>
                <p className="mt-3">
                  <span className="num text-3xl font-semibold tracking-tight">{plan.priceLabel}</span>
                  {plan.period && <span className="text-sm" style={{ color: 'var(--text-muted)' }}>/{t('land.price.month')}</span>}
                </p>
                <p className="num mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {t('land.price.quota', { n: formatNumber(plan.receiptQuota, locale) })}
                </p>
                <ul className="mt-5 grid gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {PLAN_FEATURES.map((n) => (
                    <li key={n}>· {t(k(`land.plan.${plan.id}.f${n}`))}</li>
                  ))}
                </ul>
                <Link href="/signup" className={`btn mt-6 w-full ${plan.highlighted ? 'btn-accent' : 'btn-ghost'}`}>
                  {t('land.start')}
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-6xl px-4 py-20">
          <div className="card flex flex-col items-center gap-6 px-6 py-14 text-center" style={{ background: 'var(--text)', color: 'var(--surface)', borderColor: 'transparent' }}>
            <ReclipMark size={40} />
            <h2 className="max-w-xl text-3xl font-semibold tracking-tight">{t('land.cta.title')}</h2>
            <Link href="/signup" className="btn btn-accent px-6 py-3 text-base">
              {t('land.start')}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 sm:flex-row sm:items-center sm:justify-between">
          <ReclipLogoFull height={72} />
          <div className="flex flex-wrap gap-5 text-sm" style={{ color: 'var(--text-muted)' }}>
            <Link href="/terms">{t('land.footer.terms')}</Link>
            <Link href="/privacy">{t('land.footer.privacy')}</Link>
            <Link href="/dpa">{t('land.footer.dpa')}</Link>
            <Link href="/login">{t('auth.signIn')}</Link>
            <Link href="/signup">{t('land.footer.createAccount')}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
