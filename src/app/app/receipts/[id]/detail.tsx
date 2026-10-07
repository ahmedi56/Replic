'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Card,
  ConfidenceBadge,
  StatusBadge,
  Spinner,
  formatDate,
  formatMoney,
  formatRelative,
  useToast,
} from '@/components/ui';
import type { StoredBreakdown } from '@/lib/matching/score';

/**
 * Receipt detail: the document, what was read from it, what it was matched to, and
 * everything that has ever happened to it.
 *
 * Extracted values are editable in place, and each one shows the confidence it was read
 * with, so a user's attention lands on the weak fields rather than being spread evenly.
 */

interface ReceiptProps {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  categoryId: string | null;
  createdAt: string;
}

interface ExtractionProps {
  merchantRaw: string | null;
  date: string | null;
  total: number | null;
  subtotal: number | null;
  tax: number | null;
  currency: string | null;
  invoiceNumber: string | null;
  paymentMethod: string | null;
  items: string | null;
  fieldConfidence: string | null;
  overallConfidence: number;
  provider: string;
  editedByUser: boolean;
}

interface MatchProps {
  matchId: string;
  status: string;
  score: number;
  method: string;
  breakdown: StoredBreakdown | null;
  transactionId: string;
  descriptionRaw: string;
  transactionDate: string;
  amount: number;
  currency: string;
}

interface Candidate {
  transaction: { id: string; descriptionRaw: string; date: string; amount: number; currency: string };
  score: number;
  classification: string;
}

const FIELDS: Array<{ key: keyof ExtractionProps; label: string; type: 'text' | 'number' | 'date' }> = [
  { key: 'merchantRaw', label: 'Merchant', type: 'text' },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'total', label: 'Total', type: 'number' },
  { key: 'subtotal', label: 'Subtotal', type: 'number' },
  { key: 'tax', label: 'VAT / Tax', type: 'number' },
  { key: 'currency', label: 'Currency', type: 'text' },
  { key: 'invoiceNumber', label: 'Invoice number', type: 'text' },
];

const CONFIDENCE_KEY: Partial<Record<string, string>> = {
  merchantRaw: 'merchant',
  date: 'date',
  total: 'total',
  subtotal: 'subtotal',
  tax: 'tax',
  currency: 'currency',
  invoiceNumber: 'invoiceNumber',
};

export function ReceiptDetail({
  receipt,
  extraction,
  categories,
  matches,
  audit,
}: {
  receipt: ReceiptProps;
  extraction: ExtractionProps | null;
  categories: Array<{ id: string; name: string; color: string }>;
  matches: MatchProps[];
  audit: Array<{ id: string; action: string; actorLabel: string; detail: string | null; createdAt: string }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(() => ({
    merchantRaw: extraction?.merchantRaw ?? '',
    date: extraction?.date ?? '',
    total: extraction?.total?.toString() ?? '',
    subtotal: extraction?.subtotal?.toString() ?? '',
    tax: extraction?.tax?.toString() ?? '',
    currency: extraction?.currency ?? '',
    invoiceNumber: extraction?.invoiceNumber ?? '',
    paymentMethod: extraction?.paymentMethod ?? '',
  }));
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const confidence: Record<string, number> = extraction?.fieldConfidence ? JSON.parse(extraction.fieldConfidence) : {};
  const items: Array<{ description: string; quantity?: number; unitPrice?: number }> = extraction?.items
    ? JSON.parse(extraction.items)
    : [];

  const liveMatch = matches.find((m) => m.status === 'confirmed' || m.status === 'auto');
  const suggested = matches.filter((m) => m.status === 'suggested' || m.status === 'alternate');

  async function save() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        merchant: draft.merchantRaw || null,
        date: draft.date || null,
        total: draft.total === '' ? null : Number(draft.total),
        subtotal: draft.subtotal === '' ? null : Number(draft.subtotal),
        tax: draft.tax === '' ? null : Number(draft.tax),
        currency: draft.currency ? draft.currency.toUpperCase() : null,
        invoiceNumber: draft.invoiceNumber || null,
        paymentMethod: draft.paymentMethod || null,
      };

      const res = await fetch(`/api/receipts/${receipt.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show(data.error ?? 'Could not save those changes', 'danger');
        return;
      }
      toast.show('Saved and re-matched');
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function patch(body: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.show(data.error ?? 'Could not save', 'danger');
        return;
      }
      toast.show(successMessage);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function matchAction(matchId: string, action: 'confirm' | 'reject' | 'unlink') {
    setBusy(true);
    try {
      const res = await fetch(`/api/matches/${matchId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.show(data.error ?? 'Could not update that match', 'danger');
        return;
      }
      toast.show(action === 'confirm' ? 'Match confirmed' : action === 'reject' ? 'Match rejected' : 'Transaction unlinked');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function loadCandidates() {
    setLoadingCandidates(true);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}/candidates`);
      const data = await res.json().catch(() => ({}));
      setCandidates(res.ok ? data.candidates : []);
    } finally {
      setLoadingCandidates(false);
    }
  }

  async function linkTo(transactionId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}/candidates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transactionId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.show(data.error ?? 'Could not link that transaction', 'danger');
        return;
      }
      toast.show('Linked');
      setCandidates(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this receipt and its stored document? This cannot be undone.')) return;
    setBusy(true);
    const res = await fetch(`/api/receipts/${receipt.id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.show('Could not delete this receipt', 'danger');
      setBusy(false);
      return;
    }
    router.push('/app/receipts');
    router.refresh();
  }

  return (
    <div className="grid gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{extraction?.merchantRaw ?? receipt.originalName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={receipt.status} isDuplicate={receipt.isDuplicate} />
            {extraction && <ConfidenceBadge value={extraction.overallConfidence} />}
            <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>
              uploaded {formatRelative(receipt.createdAt)} · {(receipt.sizeBytes / 1024).toFixed(0)} KB
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/receipts/${receipt.id}/file?download=1`} className="btn btn-ghost text-xs" download>
            Download original
          </a>
          <button className="btn btn-danger text-xs" onClick={remove} disabled={busy}>
            Delete
          </button>
        </div>
      </div>

      {receipt.isDuplicate && (
        <Alert tone="warning" title="Possible duplicate">
          This looks like a receipt you already have.{' '}
          {receipt.duplicateOfId && (
            <Link href={`/app/receipts/${receipt.duplicateOfId}`} className="link">
              Open the original
            </Link>
          )}
          <button className="btn btn-ghost ml-3 px-2 py-1 text-xs" onClick={() => patch({ isDuplicate: false }, 'No longer flagged as a duplicate')} disabled={busy}>
            Not a duplicate
          </button>
        </Alert>
      )}

      {receipt.status === 'failed' && (
        <Alert tone="danger" title="We couldn't read this receipt">
          Nothing readable was found in this file. You can enter the details by hand below, or upload a clearer copy.
          <div className="mt-2 flex gap-2">
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(true)}>
              Enter data manually
            </button>
            <Link href="/app/upload" className="btn btn-ghost px-2 py-1 text-xs">
              Upload a new copy
            </Link>
          </div>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Document */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Original document</h2>
            <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>
              never modified
            </span>
          </div>
          <div style={{ background: 'var(--surface-sunken)' }}>
            {receipt.mimeType === 'application/pdf' ? (
              <div className="relative h-[520px] w-full">
                {/* Behind the frame, so it shows through when the browser has no PDF viewer. */}
                <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  <p>Preview isn&apos;t available in this browser.</p>
                  <a href={`/api/receipts/${receipt.id}/file?download=1`} className="link mt-2" download>
                    Download the original
                  </a>
                </div>
                <iframe
                  src={`/api/receipts/${receipt.id}/file`}
                  title={`Receipt: ${receipt.originalName}`}
                  className="absolute inset-0 h-full w-full border-0"
                />
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/receipts/${receipt.id}/file`} alt={`Receipt: ${receipt.originalName}`} className="max-h-[520px] w-full object-contain" />
            )}
          </div>
        </Card>

        <div className="grid gap-5">
          {/* Extracted data */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Extracted data</h2>
                {extraction && (
                  <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                    read by {extraction.provider}
                    {extraction.editedByUser && ' · edited by you'}
                  </p>
                )}
              </div>
              {extraction && !editing && (
                <button className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
            </div>

            {!extraction ? (
              <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                Nothing has been extracted from this document yet.
              </div>
            ) : editing ? (
              <div className="grid gap-3 p-4">
                {FIELDS.map((field) => (
                  <div key={String(field.key)}>
                    <label className="label" htmlFor={`f-${String(field.key)}`}>
                      {field.label}
                    </label>
                    <input
                      id={`f-${String(field.key)}`}
                      className="input"
                      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                      step={field.type === 'number' ? '0.01' : undefined}
                      value={draft[field.key as keyof typeof draft] ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
                    />
                  </div>
                ))}
                <div>
                  <label className="label" htmlFor="f-payment">
                    Payment method
                  </label>
                  <select
                    id="f-payment"
                    className="input"
                    value={draft.paymentMethod}
                    onChange={(e) => setDraft((d) => ({ ...d, paymentMethod: e.target.value }))}
                  >
                    <option value="">Unknown</option>
                    <option value="card">Card</option>
                    <option value="cash">Cash</option>
                    <option value="transfer">Bank transfer</option>
                    <option value="direct_debit">Direct debit</option>
                  </select>
                </div>
                <div className="mt-1 flex gap-2">
                  <button className="btn btn-accent" onClick={save} disabled={busy}>
                    {busy && <Spinner />}
                    Save and re-match
                  </button>
                  <button className="btn btn-ghost" onClick={() => setEditing(false)} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <dl className="divide-y">
                  {FIELDS.map((field) => {
                    const raw = extraction[field.key];
                    const conf = confidence[CONFIDENCE_KEY[String(field.key)] ?? ''];
                    const display =
                      field.key === 'total' || field.key === 'subtotal' || field.key === 'tax'
                        ? formatMoney(raw as number | null, extraction.currency ?? 'EUR')
                        : field.key === 'date'
                          ? formatDate(raw as string | null)
                          : (raw as string | null) || '-';
                    return (
                      <div key={String(field.key)} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <dt className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          {field.label}
                        </dt>
                        <dd className="flex items-center gap-2.5">
                          <span className="num text-sm font-medium">{display}</span>
                          {conf != null && <ConfidenceBadge value={conf} />}
                        </dd>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <dt className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      Category
                    </dt>
                    <dd>
                      <select
                        className="input w-auto py-1 text-xs"
                        value={receipt.categoryId ?? ''}
                        onChange={(e) => patch({ categoryId: e.target.value || null }, 'Category updated')}
                        disabled={busy}
                        aria-label="Category"
                      >
                        <option value="">Uncategorised</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </dd>
                  </div>
                </dl>

                {extraction.overallConfidence < 0.7 && (
                  <div className="border-t px-4 py-3">
                    <p className="text-xs" style={{ color: 'var(--warn)' }}>
                      ⚠ Review required: some fields were read with low confidence. Check them before exporting.
                    </p>
                  </div>
                )}

                {items.length > 0 && (
                  <div className="border-t px-4 py-3">
                    <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                      Line items
                    </p>
                    <ul className="grid gap-1">
                      {items.slice(0, 12).map((item, i) => (
                        <li key={i} className="flex justify-between gap-3 text-xs">
                          <span className="truncate" style={{ color: 'var(--text-muted)' }}>
                            {item.quantity && item.quantity > 1 ? `${item.quantity} × ` : ''}
                            {item.description}
                          </span>
                          <span className="num shrink-0">{formatMoney(item.unitPrice ?? null, extraction.currency ?? 'EUR')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* Matched transaction */}
          <Card className="overflow-hidden">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Matched transaction</h2>
            </div>

            {liveMatch ? (
              <div className="p-4">
                <p className="truncate text-sm font-medium" title={liveMatch.descriptionRaw}>
                  {liveMatch.descriptionRaw}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span>{formatDate(liveMatch.transactionDate)}</span>
                  <span className="num font-medium">{formatMoney(liveMatch.amount, liveMatch.currency)}</span>
                  <ConfidenceBadge value={liveMatch.score} />
                  <span>{liveMatch.method === 'manual' ? 'matched by you' : `matched ${liveMatch.method}`}</span>
                </div>

                {liveMatch.breakdown && (
                  <ul className="mt-3 grid gap-1">
                    {liveMatch.breakdown.signals
                      .filter((s) => s.applicable)
                      .map((s) => (
                        <li key={s.name} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                          <span style={{ color: s.positive ? 'var(--accent)' : 'var(--warn)' }} aria-hidden="true">
                            {s.positive ? '✓' : '!'}
                          </span>
                          {s.reason}
                        </li>
                      ))}
                  </ul>
                )}

                <button className="btn btn-ghost mt-4 text-xs" onClick={() => matchAction(liveMatch.matchId, 'unlink')} disabled={busy}>
                  Unlink transaction
                </button>
              </div>
            ) : suggested.length > 0 ? (
              <div className="grid gap-3 p-4">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {suggested.length} suggestion{suggested.length === 1 ? '' : 's'} waiting for your decision.
                </p>
                {suggested.map((m) => (
                  <div key={m.matchId} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium">{m.descriptionRaw}</p>
                      <ConfidenceBadge value={m.score} />
                    </div>
                    <p className="num mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {formatDate(m.transactionDate)} · {formatMoney(m.amount, m.currency)}
                    </p>
                    <div className="mt-2.5 flex gap-2">
                      <button className="btn btn-accent px-2.5 py-1 text-xs" onClick={() => matchAction(m.matchId, 'confirm')} disabled={busy}>
                        Confirm
                      </button>
                      <button className="btn btn-ghost px-2.5 py-1 text-xs" onClick={() => matchAction(m.matchId, 'reject')} disabled={busy}>
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  No transaction is linked to this receipt.
                </p>
                {candidates === null ? (
                  <button className="btn btn-ghost mt-3 text-xs" onClick={loadCandidates} disabled={loadingCandidates}>
                    {loadingCandidates && <Spinner size={12} />}
                    Find a transaction manually
                  </button>
                ) : candidates.length === 0 ? (
                  <p className="mt-3 text-xs" style={{ color: 'var(--text-subtle)' }}>
                    No transactions to offer. Import a bank statement first.
                  </p>
                ) : (
                  <ul className="mt-3 grid gap-2">
                    {candidates.map((c) => (
                      <li key={c.transaction.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium">{c.transaction.descriptionRaw}</p>
                          <p className="num text-xs" style={{ color: 'var(--text-subtle)' }}>
                            {formatDate(c.transaction.date)} · {formatMoney(c.transaction.amount, c.transaction.currency)} · {c.score}% fit
                          </p>
                        </div>
                        <button className="btn btn-ghost shrink-0 px-2 py-1 text-xs" onClick={() => linkTo(c.transaction.id)} disabled={busy}>
                          Link
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Audit history */}
      <Card className="overflow-hidden">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Audit history</h2>
          <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
            Nothing about this receipt changes without a line here.
          </p>
        </div>
        <ul className="divide-y">
          {audit.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{entry.actorLabel}</span>{' '}
                <span style={{ color: 'var(--text-muted)' }}>{entry.action.replace(/[._]/g, ' ')}</span>
                {entry.detail && (
                  <span className="block truncate text-xs" style={{ color: 'var(--text-subtle)' }}>
                    {entry.detail}
                  </span>
                )}
              </div>
              <span className="shrink-0 text-xs" style={{ color: 'var(--text-subtle)' }}>
                {formatDate(entry.createdAt)} · {formatRelative(entry.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {toast.node}
    </div>
  );
}
