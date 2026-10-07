'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Card, Spinner, useToast } from '@/components/ui';
import type { TargetField, ColumnMapping } from '@/lib/import/csv';

/**
 * Three steps: choose a file, confirm the mapping, commit.
 *
 * The mapping step is the important one. Reclip's guess is shown pre-filled with a sample
 * of each column's real values underneath, because "is this the right column?" is much
 * easier to answer while looking at the data than from the header name alone.
 */

const TARGETS: Array<{ value: TargetField; label: string }> = [
  { value: 'ignore', label: 'Ignore' },
  { value: 'date', label: 'Date' },
  { value: 'description', label: 'Description' },
  { value: 'amount', label: 'Amount (signed)' },
  { value: 'debit', label: 'Debit (money out)' },
  { value: 'credit', label: 'Credit (money in)' },
  { value: 'currency', label: 'Currency' },
  { value: 'reference', label: 'Reference' },
];

interface Preview {
  headers: string[];
  sampleRows: string[][];
  suggestedMapping: ColumnMapping;
  totalRows: number;
  dateOrderAmbiguous: boolean;
  filename: string;
  content: string;
}

export function ImportWizard({ accounts }: { accounts: Array<{ id: string; name: string; currency: string }> }) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [dateOrder, setDateOrder] = useState<'auto' | 'dmy' | 'mdy'>('auto');
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? '');
  const [accountName, setAccountName] = useState('Main account');
  const [currency, setCurrency] = useState('EUR');
  const [invertAmounts, setInvertAmounts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; skippedDuplicates: number; issues: Array<{ rowNumber: number; reason: string }>; matching: { auto: number; review: number } } | null>(null);

  async function choose(file: File) {
    setError(null);
    setBusy(true);
    setResult(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/imports/preview', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'That file could not be read');
        return;
      }
      setPreview(data);
      setMapping(data.suggestedMapping);
      setDateOrder(data.dateOrderAmbiguous ? 'dmy' : 'auto');
    } catch {
      setError('Could not upload that file');
    } finally {
      setBusy(false);
    }
  }

  async function commit(force = false) {
    if (!preview) return;
    setBusy(true);
    setError(null);
    setDuplicatePrompt(null);

    try {
      const res = await fetch('/api/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: preview.filename,
          content: preview.content,
          mapping,
          bankAccountId: accountId || null,
          bankAccountName: accountId ? undefined : accountName,
          defaultCurrency: currency,
          dateOrder,
          invertAmounts,
          force,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data.code === 'duplicate_import') {
        setDuplicatePrompt(data.error);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? 'Import failed');
        return;
      }

      setResult(data);
      setPreview(null);
      toast.show(`${data.imported} transactions imported`);
      router.refresh();
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  const mappedTargets = Object.values(mapping);
  const hasDate = mappedTargets.includes('date');
  const hasAmount = mappedTargets.includes('amount') || mappedTargets.includes('debit') || mappedTargets.includes('credit');
  const canCommit = hasDate && hasAmount;

  /* --- Result --- */
  if (result) {
    return (
      <Card className="p-6">
        <h2 className="text-sm font-semibold">Import complete</h2>
        <div className="mt-4 grid gap-2 text-sm">
          <p>
            <span className="num font-semibold">{result.imported}</span> transactions imported.
          </p>
          {result.skippedDuplicates > 0 && (
            <p style={{ color: 'var(--text-muted)' }}>
              <span className="num">{result.skippedDuplicates}</span> rows were already in Reclip and were skipped.
            </p>
          )}
          <p style={{ color: 'var(--text-muted)' }}>
            Matching ran automatically: <span className="num">{result.matching.auto}</span> matched,{' '}
            <span className="num">{result.matching.review}</span> need review.
          </p>
        </div>

        {result.issues.length > 0 && (
          <div className="mt-4">
            <Alert tone="warning" title={`${result.issues.length} row${result.issues.length === 1 ? '' : 's'} skipped`}>
              <ul className="mt-1 grid gap-1">
                {result.issues.slice(0, 6).map((issue) => (
                  <li key={`${issue.rowNumber}-${issue.reason}`} className="text-xs">
                    Row {issue.rowNumber}: {issue.reason}
                  </li>
                ))}
              </ul>
            </Alert>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/app/review" className="btn btn-accent">
            Review matches
          </Link>
          <Link href="/app/transactions" className="btn btn-ghost">
            See transactions
          </Link>
          <button className="btn btn-ghost" onClick={() => setResult(null)}>
            Import another file
          </button>
        </div>
        {toast.node}
      </Card>
    );
  }

  /* --- Step 1: choose a file --- */
  if (!preview) {
    return (
      <div className="grid gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div
          className="card flex flex-col items-center justify-center px-6 py-14 text-center"
          style={{ borderStyle: 'dashed', borderWidth: 2, borderColor: 'var(--border-strong)' }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) choose(file);
          }}
        >
          <p className="text-sm font-medium">Drop your bank CSV here</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Nothing is saved until you confirm the columns.
          </p>
          <button className="btn btn-accent mt-5" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy && <Spinner />}
            Choose CSV file
          </button>
          <input
            ref={inputRef}
            type="file"
            aria-label="Choose a bank statement CSV file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) choose(file);
              e.target.value = '';
            }}
          />
        </div>

        <Card className="p-5">
          <h2 className="text-sm font-semibold">Reclip understands most bank exports</h2>
          <p className="mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
            Column names like <code className="text-xs">Booking Date</code>, <code className="text-xs">Value Date</code>,{' '}
            <code className="text-xs">Verwendungszweck</code> or <code className="text-xs">Libellé</code> are recognised
            automatically, as are separate Debit and Credit columns and both decimal conventions.
          </p>
        </Card>
      </div>
    );
  }

  /* --- Step 2: confirm mapping --- */
  return (
    <div className="grid gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {duplicatePrompt && (
        <Alert tone="warning" title="This file has been imported before">
          {duplicatePrompt}
          <div className="mt-2 flex gap-2">
            <button className="btn btn-ghost px-2.5 py-1 text-xs" onClick={() => commit(true)} disabled={busy}>
              Import anyway
            </button>
            <button className="btn btn-ghost px-2.5 py-1 text-xs" onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </Alert>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{preview.filename}</h2>
          <p className="num text-xs" style={{ color: 'var(--text-muted)' }}>
            {preview.totalRows} rows
          </p>
        </div>

        <p className="mt-4 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
          Match your CSV columns to Reclip fields
        </p>

        <div className="mt-3 grid gap-2">
          {preview.headers.map((header, i) => {
            const samples = preview.sampleRows.map((r) => r[i]).filter(Boolean).slice(0, 2);
            return (
              <div key={header} className="grid items-center gap-2 rounded-lg border px-3 py-2.5 sm:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{header}</p>
                  {samples.length > 0 && (
                    <p className="truncate text-xs" style={{ color: 'var(--text-subtle)' }}>
                      {samples.join(' · ')}
                    </p>
                  )}
                </div>
                <select
                  className="input w-full py-1.5 text-xs sm:w-44"
                  value={mapping[header] ?? 'ignore'}
                  onChange={(e) => setMapping((m) => ({ ...m, [header]: e.target.value as TargetField }))}
                  aria-label={`Map column ${header}`}
                >
                  {TARGETS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        {!canCommit && (
          <p className="mt-3 text-xs" style={{ color: 'var(--warn)' }}>
            Map at least a Date column and an Amount column (or Debit/Credit) to continue.
          </p>
        )}
      </Card>

      <Card className="grid gap-4 p-5">
        <h2 className="text-sm font-semibold">Import settings</h2>

        {preview.dateOrderAmbiguous && (
          <div>
            <label className="label" htmlFor="date-order">
              Date order
            </label>
            <select id="date-order" className="input" value={dateOrder} onChange={(e) => setDateOrder(e.target.value as never)}>
              <option value="dmy">Day / Month / Year (01/02/2026 = 1 February)</option>
              <option value="mdy">Month / Day / Year (01/02/2026 = 2 January)</option>
            </select>
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-subtle)' }}>
              This file&apos;s dates could be read either way round, so please confirm.
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="account">
              Bank account
            </label>
            {accounts.length > 0 ? (
              <select id="account" className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value="">+ New account…</option>
              </select>
            ) : (
              <input id="account" className="input" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
            )}
            {accounts.length > 0 && accountId === '' && (
              <input
                className="input mt-2"
                placeholder="New account name"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                aria-label="New account name"
              />
            )}
          </div>

          <div>
            <label className="label" htmlFor="currency">
              Default currency
            </label>
            <input
              id="currency"
              className="input"
              value={currency}
              maxLength={3}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-subtle)' }}>
              Used only for rows without their own currency column.
            </p>
          </div>
        </div>

        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-0.5" checked={invertAmounts} onChange={(e) => setInvertAmounts(e.target.checked)} />
          <span>
            Flip the sign on amounts
            <span className="block text-xs" style={{ color: 'var(--text-subtle)' }}>
              Tick this if your bank exports expenses as positive numbers.
            </span>
          </span>
        </label>
      </Card>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-accent" onClick={() => commit(false)} disabled={busy || !canCommit}>
          {busy && <Spinner />}
          Import {preview.totalRows} rows
        </button>
        <button className="btn btn-ghost" onClick={() => setPreview(null)} disabled={busy}>
          Choose a different file
        </button>
      </div>
      {toast.node}
    </div>
  );
}
