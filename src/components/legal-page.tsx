import Link from 'next/link';
import { ReclipWordmark } from '@/components/brand';
import type { LegalConfig } from '@/lib/legal';
import { LEGAL_ENV_NAMES, showDraftNotice, unresolvedPlaceholders } from '@/lib/legal';
import type { LegalSection } from '@/lib/legal-content';

/** The shared layout for the Privacy Policy and the Terms of Service. */
export function LegalPage({
  title,
  intro,
  sections,
  config,
}: {
  title: string;
  intro: string;
  sections: LegalSection[];
  config: LegalConfig;
}) {
  const draft = showDraftNotice(config);
  const missing = unresolvedPlaceholders(config).map((key) => LEGAL_ENV_NAMES[key as keyof LegalConfig]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>
      <header className="border-b px-4 py-5">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/">
            <ReclipWordmark />
          </Link>
          <Link href="/signup" className="btn btn-ghost">
            Start for free
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl px-4 py-14">
        {draft && (
          <div role="note" className="mb-8 rounded-lg border px-4 py-3 text-sm" style={{ background: 'var(--warn-bg)', color: 'var(--warn)', borderColor: 'transparent' }}>
            <p className="font-semibold">Draft: not yet reviewed</p>
            <p className="mt-1">
              This text has not been reviewed by a lawyer
              {missing.length > 0 ? ` and some details are still missing (${missing.join(', ')})` : ''}. It describes how the service works, but it is not final.
            </p>
          </div>
        )}

        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-subtle)' }}>
          Last updated: {config.effectiveDate}
        </p>
        <p className="mt-4 text-lg leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {intro}
        </p>

        <nav aria-label="Contents" className="mt-8 rounded-lg border p-4 text-sm" style={{ borderColor: 'var(--border)' }}>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="link">
                  {s.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-12 grid gap-10">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-20">
              <h2 className="text-lg font-semibold tracking-tight">{section.heading}</h2>
              <div className="mt-3 grid gap-3 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {section.paragraphs?.map((p) => <p key={p.slice(0, 50)}>{p}</p>)}
                {section.bullets && (
                  <ul className="grid list-disc gap-2 pl-5">
                    {section.bullets.map((b) => <li key={b.slice(0, 50)}>{b}</li>)}
                  </ul>
                )}
                {section.table && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-sm">
                      <thead>
                        <tr>
                          {section.table.head.map((h) => (
                            <th key={h} className="border-b px-3 py-2 font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {section.table.rows.map((row) => (
                          <tr key={row[0]}>
                            {row.map((cell, i) => (
                              <td key={i} className="border-b px-3 py-2 align-top" style={{ borderColor: 'var(--border)' }}>
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {section.after?.map((p) => <p key={p.slice(0, 50)}>{p}</p>)}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-14 text-sm" style={{ color: 'var(--text-subtle)' }}>
          <Link href="/terms" className="link">Terms of Service</Link> · <Link href="/privacy" className="link">Privacy Policy</Link> · <Link href="/dpa" className="link">Data Processing Addendum</Link>
        </p>
      </main>
    </div>
  );
}
