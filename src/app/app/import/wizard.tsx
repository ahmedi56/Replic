'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Card, Spinner, useToast } from '@/components/ui';
import type { TargetField, ColumnMapping } from '@/lib/import/csv';
import { defaultImportCurrency, isThreeDecimalCurrency } from '@/lib/currency';
import { useApiError, useLocale, useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';

/**
 * Three steps: choose a file, confirm the mapping, commit.
 *
 * The mapping step is the important one. Reclip's guess is shown pre-filled with a sample
 * of each column's real values underneath, because "is this the right column?" is much
 * easier to answer while looking at the data than from the header name alone.
 */

const TARGETS: Array<{ value: TargetField; label: MessageKey }> = [
  { value: 'ignore', label: 'imp.field.ignore' },
  { value: 'date', label: 'imp.field.date' },
  { value: 'description', label: 'imp.field.description' },
  { value: 'amount', label: 'imp.field.amount' },
  { value: 'debit', label: 'imp.field.debit' },
  { value: 'credit', label: 'imp.field.credit' },
  { value: 'currency', label: 'imp.field.currency' },
  { value: 'reference', label: 'imp.field.reference' },
];

interface Preview {
  headers: string[];
  sampleRows: string[][];
  suggestedMapping: ColumnMapping;
  totalRows: number;
  dateOrderAmbiguous: boolean;
  amountsLookThreeDecimal: boolean;
  filename: string;
  content: string;
}

export function ImportWizard({
  accounts,
  receiptCurrency,
}: {
  accounts: Array<{ id: string; name: string; currency: string }>;
  receiptCurrency: string | null;
}) {
  const t = useT();
  const apiError = useApiError();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [dateOrder, setDateOrder] = useState<'auto' | 'dmy' | 'mdy'>('auto');
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? '');
  const [accountName, setAccountName] = useState(t('imp.mainAccount'));
  const [currency, setCurrency] = useState(() => defaultImportCurrency(accounts[0]?.currency, receiptCurrency, locale));
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
        setError(apiError(data.error) ?? t('imp.err.read'));
        return;
      }
      setPreview(data);
      setMapping(data.suggestedMapping);
      setDateOrder(data.dateOrderAmbiguous ? 'dmy' : 'auto');
    } catch {
      setError(t('imp.err.upload'));
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
        setDuplicatePrompt(apiError(data.error) ?? t('imp.dupTitle'));
        return;
      }
      if (!res.ok) {
        setError(apiError(data.error) ?? t('imp.err.import'));
        return;
      }

      setResult(data);
      setPreview(null);
      toast.show(t('imp.toast', { n: data.imported }));
      router.refresh();
    } catch {
      setError(t('common.offline'));
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
        <h2 className="text-sm font-semibold">{t('imp.done')}</h2>
        <div className="mt-4 grid gap-2 text-sm">
          <p>
            {t('imp.doneCount', { n: result.imported })}
          </p>
          {result.skippedDuplicates > 0 && (
            <p style={{ color: 'var(--text-muted)' }}>
              {t('imp.skippedDup', { n: result.skippedDuplicates })}
            </p>
          )}
          <p style={{ color: 'var(--text-muted)' }}>
            {t('imp.matchingRan', { auto: result.matching.auto, review: result.matching.review })}
          </p>
        </div>

        {result.issues.length > 0 && (
          <div className="mt-4">
            <Alert tone="warning" title={result.issues.length === 1 ? t('imp.rowsSkippedOne') : t('imp.rowsSkippedMany', { n: result.issues.length })}>
              <ul className="mt-1 grid gap-1">
                {result.issues.slice(0, 6).map((issue) => (
                  <li key={`${issue.rowNumber}-${issue.reason}`} className="text-xs">
                    {t('imp.rowIssue', { row: issue.rowNumber, reason: apiError(issue.reason) ?? issue.reason })}
                  </li>
                ))}
              </ul>
            </Alert>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/app/review" className="btn btn-accent">
            {t('imp.reviewMatches')}
          </Link>
          <Link href="/app/transactions" className="btn btn-ghost">
            {t('imp.seeTransactions')}
          </Link>
          <button className="btn btn-ghost" onClick={() => setResult(null)}>
            {t('imp.another')}
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
          <p className="text-sm font-medium">{t('imp.drop')}</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            {t('imp.dropNote')}
          </p>
          <button className="btn btn-accent mt-5" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy && <Spinner />}
            {t('imp.chooseFile')}
          </button>
          <input
            ref={inputRef}
            type="file"
            aria-label={t('imp.inputLabel')}
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
          <h2 className="text-sm font-semibold">{t('imp.understandsTitle')}</h2>
          <p className="mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
            {t('imp.understandsBody', { a: 'Booking Date', b: 'Value Date', c: 'Verwendungszweck', d: 'Libellé' })}
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
        <Alert tone="warning" title={t('imp.dupTitle')}>
          {duplicatePrompt}
          <div className="mt-2 flex gap-2">
            <button className="btn btn-ghost px-2.5 py-1 text-xs" onClick={() => commit(true)} disabled={busy}>
              {t('imp.importAnyway')}
            </button>
            <button className="btn btn-ghost px-2.5 py-1 text-xs" onClick={() => setPreview(null)}>
              {t('imp.cancel')}
            </button>
          </div>
        </Alert>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{preview.filename}</h2>
          <p className="num text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('imp.rows', { n: preview.totalRows })}
          </p>
        </div>

        <p className="mt-4 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
          {t('imp.matchColumns')}
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
                  aria-label={t('imp.mapColumn', { name: header })}
                >
                  {TARGETS.map((target) => (
                    <option key={target.value} value={target.value}>
                      {t(target.label)}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        {!canCommit && (
          <p className="mt-3 text-xs" style={{ color: 'var(--warn)' }}>
            {t('imp.needMap')}
          </p>
        )}
      </Card>

      <Card className="grid gap-4 p-5">
        <h2 className="text-sm font-semibold">{t('imp.settings')}</h2>

        {preview.dateOrderAmbiguous && (
          <div>
            <label className="label" htmlFor="date-order">
              {t('imp.dateOrder')}
            </label>
            <select id="date-order" className="input" value={dateOrder} onChange={(e) => setDateOrder(e.target.value as never)}>
              <option value="dmy">{t('imp.dmy')}</option>
              <option value="mdy">{t('imp.mdy')}</option>
            </select>
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-subtle)' }}>
              {t('imp.dateAmbiguous')}
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="account">
              {t('imp.account')}
            </label>
            {accounts.length > 0 ? (
              <select id="account" className="input" value={accountId} onChange={(e) => {
                  setAccountId(e.target.value);
                  // An existing account knows its currency; a new one keeps what is typed.
                  const picked = accounts.find((a) => a.id === e.target.value);
                  if (picked) setCurrency(defaultImportCurrency(picked.currency, receiptCurrency, locale));
                }}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value="">{t('imp.newAccountOption')}</option>
              </select>
            ) : (
              <input id="account" className="input" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
            )}
            {accounts.length > 0 && accountId === '' && (
              <input
                className="input mt-2"
                placeholder={t('imp.newAccountName')}
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                aria-label={t('imp.newAccountName')}
              />
            )}
          </div>

          <div>
            <label className="label" htmlFor="currency">
              {t('imp.currency')}
            </label>
            <input
              id="currency"
              className="input"
              value={currency}
              maxLength={3}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-subtle)' }}>
              {t('imp.currencyNote')}
            </p>
            {preview.amountsLookThreeDecimal && !isThreeDecimalCurrency(currency) && (
              <p className="mt-2 text-xs" style={{ color: 'var(--warn, #b45309)' }} role="note">
                {t('imp.threeDecimals')}
              </p>
            )}
          </div>
        </div>

        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-0.5" checked={invertAmounts} onChange={(e) => setInvertAmounts(e.target.checked)} />
          <span>
            {t('imp.flip')}
            <span className="block text-xs" style={{ color: 'var(--text-subtle)' }}>
              {t('imp.flipNote')}
            </span>
          </span>
        </label>
      </Card>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-accent" onClick={() => commit(false)} disabled={busy || !canCommit}>
          {busy && <Spinner />}
          {t('imp.importRows', { n: preview.totalRows })}
        </button>
        <button className="btn btn-ghost" onClick={() => setPreview(null)} disabled={busy}>
          {t('imp.different')}
        </button>
      </div>
      {toast.node}
    </div>
  );
}
