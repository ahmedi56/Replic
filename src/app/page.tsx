import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/session';
import { ReclipLogoFull, ReclipMark } from '@/components/brand';
import { PRICING_PLANS } from '@/lib/pricing';
import { HeroDemo } from './_landing/hero-demo';

export default async function LandingPage() {
  // Someone already signed in doesn't need the pitch.
  if (await getAuth()) redirect('/app');

  return (
    <div style={{ background: 'var(--surface)' }}>
      <header className="sticky top-0 z-40 border-b backdrop-blur" style={{ background: 'color-mix(in srgb, var(--surface) 85%, transparent)' }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <ReclipLogoFull height={52} />
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link href="#how" className="hidden rounded-lg px-3 py-2 text-sm sm:block" style={{ color: 'var(--text-muted)' }}>
              How it works
            </Link>
            <Link href="#pricing" className="hidden rounded-lg px-3 py-2 text-sm sm:block" style={{ color: 'var(--text-muted)' }}>
              Pricing
            </Link>
            <Link href="/login" className="btn btn-ghost">
              Sign in
            </Link>
            <Link href="/signup" className="btn btn-primary">
              Start for free
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
                Receipts in. Reconciliation done.
              </p>
              <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
                Stop matching receipts manually.
              </h1>
              <p className="mt-5 max-w-lg text-lg leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Upload receipts. Import transactions. Reclip reconciles them automatically, and shows you exactly why
                every match was made.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/signup" className="btn btn-accent px-5 py-2.5">
                  Start for free
                </Link>
                <Link href="#how" className="btn btn-ghost px-5 py-2.5">
                  See how it works
                </Link>
              </div>
              <p className="mt-4 text-xs" style={{ color: 'var(--text-subtle)' }}>
                50 receipts a month on the free plan. No card required.
              </p>
            </div>

            <HeroDemo />
          </div>
        </section>

        {/* Problem */}
        <section className="mx-auto max-w-6xl px-4 py-20">
          <div className="card px-6 py-10 sm:px-12" style={{ background: 'var(--surface-sunken)' }}>
            <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
              Your receipts and your bank statement shouldn&apos;t cost you a weekend.
            </h2>
            <p className="mt-4 max-w-2xl leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              A month of expenses is a shoebox of photos, a folder of PDFs and a CSV that calls the same shop three
              different things. Matching them by hand is slow, and the mistakes are the kind that surface at tax time.
            </p>
            <dl className="mt-10 grid gap-8 sm:grid-cols-3">
              {[
                { term: 'The names never match', detail: '“CARREFOUR MARKET TUNIS 2391” and a receipt that just says Carrefour.' },
                { term: 'The dates drift', detail: 'You paid on the 28th. The bank posted it on the 30th.' },
                { term: 'The duplicates hide', detail: 'The photo and the emailed PDF of the same lunch, counted twice.' },
              ].map((item) => (
                <div key={item.term}>
                  <dt className="text-sm font-semibold">{item.term}</dt>
                  <dd className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {item.detail}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
          <p className="mt-3 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
            Five steps, and only one of them needs you.
          </p>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { n: '1', title: 'Upload', body: 'Drop 100 receipts at once: JPG, PNG, WEBP or PDF.' },
              { n: '2', title: 'Import', body: 'Bring in your bank CSV. Any column names; map them once.' },
              { n: '3', title: 'Match', body: 'Amount, date, merchant, currency and payment method, weighted.' },
              { n: '4', title: 'Review', body: 'Only the uncertain ones, sorted so the easiest come first.' },
              { n: '5', title: 'Export', body: 'A clean reconciled file for your accountant.' },
            ].map((step) => (
              <li key={step.n} className="card p-5">
                <span
                  className="num flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
                  style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent-ink)' }}
                >
                  {step.n}
                </span>
                <h3 className="mt-3 text-sm font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Built around the one thing that matters</h2>
          <p className="mt-3 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
            Not how many AI features it has. How fast you get from 500 receipts to a reconciled dataset.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: 'Data extraction', body: 'Merchant, date, total, VAT, invoice number and line items, each with its own confidence score.' },
              { title: 'Multi-factor matching', body: 'Five weighted signals, not a string comparison. Every weight is yours to change.' },
              { title: 'Transparent scoring', body: 'Every match shows its reasons: exact amount, one day after, merchant similarity 94%.' },
              { title: 'Duplicate detection', body: 'The same file twice, the same invoice number, or the same purchase captured two ways.' },
              { title: 'Bulk processing', body: 'Hundreds of receipts at a time, with progress you can watch and an interface that stays responsive.' },
              { title: 'Export and audit trail', body: 'Reconciled CSV for your accountant, and a log of every change that was ever made.' },
            ].map((f) => (
              <div key={f.title} className="card p-5">
                <h3 className="text-sm font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {f.body}
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
                <h2 className="text-2xl font-semibold tracking-tight">Your documents stay yours</h2>
                <p className="mt-4 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Reclip handles financial documents, so the boring guarantees come first. Files are stored outside the
                  web root and served only through authenticated, tenant-scoped requests. Every query is scoped to your
                  organization. There is no code path that reads another organization&apos;s data.
                </p>
                <p className="mt-4 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Your documents are never used to train AI models. Extraction runs locally by default; if you connect a
                  provider, that choice is explicit and reversible.
                </p>
                <Link href="/privacy" className="link mt-5 inline-block text-sm">
                  Read the privacy details
                </Link>
              </div>
              <ul className="grid content-start gap-3">
                {[
                  'Passwords hashed with bcrypt; sessions stored as hashes only',
                  'Uploads validated by file signature, not by what the browser claims',
                  'Rate limiting on authentication, uploads and exports',
                  'Full audit log: financial data is never changed silently',
                  'Delete your data at any time, documents included',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true">
                      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span style={{ color: 'var(--text-muted)' }}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Simple pricing</h2>
          <p className="mt-3" style={{ color: 'var(--text-muted)' }}>
            Start free. Upgrade when the volume is worth it.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {PRICING_PLANS.map((plan) => (
              <div key={plan.id} className="card flex flex-col p-6" style={plan.highlighted ? { borderColor: 'var(--accent)' } : undefined}>
                {plan.highlighted && (
                  <span className="chip mb-3 self-start" style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent-ink)' }}>
                    Most popular
                  </span>
                )}
                <h3 className="text-sm font-semibold">{plan.name}</h3>
                <p className="mt-3">
                  <span className="num text-3xl font-semibold tracking-tight">{plan.priceLabel}</span>
                  {plan.period && <span className="text-sm" style={{ color: 'var(--text-muted)' }}>/{plan.period}</span>}
                </p>
                <p className="num mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {plan.receiptQuota.toLocaleString('en-GB')} receipts a month
                </p>
                <ul className="mt-5 grid gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {plan.features.map((f) => (
                    <li key={f}>· {f}</li>
                  ))}
                </ul>
                <Link href="/signup" className={`btn mt-6 w-full ${plan.highlighted ? 'btn-accent' : 'btn-ghost'}`}>
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-6xl px-4 py-20">
          <div className="card flex flex-col items-center gap-6 px-6 py-14 text-center" style={{ background: 'var(--text)', color: 'var(--surface)', borderColor: 'transparent' }}>
            <ReclipMark size={40} />
            <h2 className="max-w-xl text-3xl font-semibold tracking-tight">Reconcile a month of receipts before your coffee goes cold.</h2>
            <Link href="/signup" className="btn btn-accent px-6 py-3 text-base">
              Start for free
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 sm:flex-row sm:items-center sm:justify-between">
          <ReclipLogoFull height={72} />
          <div className="flex flex-wrap gap-5 text-sm" style={{ color: 'var(--text-muted)' }}>
            <Link href="/privacy">Privacy</Link>
            <Link href="/login">Sign in</Link>
            <Link href="/signup">Create account</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
