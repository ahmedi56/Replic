import Link from 'next/link';
import { ReclipWordmark } from '@/components/brand';

export const metadata = { title: 'Privacy' };

const SECTIONS = [
  {
    heading: 'What Reclip stores',
    body: [
      'Your account: email address, name, a bcrypt hash of your password, and the organization you belong to. Session tokens are stored only as hashes, so a database copy cannot be used to sign in as you.',
      'Your documents: every receipt you upload is kept exactly as you sent it. The original is never modified or overwritten. Extracted data is stored as a separate record alongside it.',
      'Your transactions: the rows from any bank CSV you import, including the original description text, which is kept verbatim for auditability. Reclip has no connection to your bank and cannot initiate anything.',
    ],
  },
  {
    heading: 'How documents are processed',
    body: [
      'Extraction reads the text layer of PDFs and parses it locally, inside your own instance. In this default configuration nothing about your documents leaves the server.',
      'If an AI provider is configured by whoever runs your instance, documents are sent to that provider only for extraction, and only using API endpoints that do not train on submitted content. Provider selection is an explicit environment setting and can be removed at any time, at which point processing falls back to local parsing.',
      'Semantic matching, used only for merchant names the deterministic scorer cannot resolve, sends merchant text, never the document itself, and only for the small number of pairs that are genuinely ambiguous.',
    ],
  },
  {
    heading: 'What Reclip never does',
    body: [
      'Your documents are not used to train any AI model, by Reclip or by any configured provider.',
      'Your data is not sold, shared with advertisers, or used to build a profile of you.',
      'No one from another organization can see your receipts or transactions. Every database query is scoped to your organization, and document downloads re-check ownership before a single byte is served.',
    ],
  },
  {
    heading: 'How long things are kept',
    body: [
      'Documents and extracted data are kept until you delete them. There is no silent expiry.',
      'Audit log entries are kept for the life of the organization, because their purpose is to explain what happened to financial data months later.',
      'Password reset tokens expire after 30 minutes and can only be used once. Sessions expire after 14 days.',
    ],
  },
  {
    heading: 'Deleting your data',
    body: [
      'Any receipt can be deleted from its detail page, which removes the stored document along with its extracted data and any matches referencing it.',
      'Clearing your workspace from Settings removes every receipt, transaction, import and match in one action.',
      'Deletion is immediate and permanent. Reclip keeps no shadow copy.',
    ],
  },
];

export default function PrivacyPage() {
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
        <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
        <p className="mt-4 text-lg leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Reclip handles receipts, invoices and bank data. This page says plainly what is stored, what is processed,
          and what you can delete.
        </p>

        <div className="mt-12 grid gap-10">
          {SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2 className="text-lg font-semibold tracking-tight">{section.heading}</h2>
              <div className="mt-3 grid gap-3">
                {section.body.map((paragraph) => (
                  <p key={paragraph.slice(0, 40)} className="leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-14 text-sm" style={{ color: 'var(--text-subtle)' }}>
          This describes how the software behaves. If you are using an instance run by someone else, their own terms
          apply on top of this.
        </p>
      </main>
    </div>
  );
}
