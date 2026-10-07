'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Card, Spinner, useToast } from '@/components/ui';
import type { MatchingConfig } from '@/lib/matching/config';

/**
 * Matching is configurable, and this is where.
 *
 * Weights are shown as a set that must add to 100%, because that is how they behave —
 * the engine renormalizes anyway, and presenting them as independent numbers would
 * mislead. Thresholds are the two lines that separate automatic from reviewed from
 * ignored.
 */

const WEIGHT_FIELDS: Array<{ key: keyof MatchingConfig['weights']; label: string; hint: string }> = [
  { key: 'amount', label: 'Amount', hint: 'The strongest signal: two purchases rarely cost exactly the same' },
  { key: 'merchant', label: 'Merchant', hint: 'Fuzzy-matched against the normalized bank description' },
  { key: 'date', label: 'Date', hint: 'Allows for the delay between paying and the bank posting' },
  { key: 'currency', label: 'Currency', hint: 'A mismatch never matches automatically, whatever the weight' },
  { key: 'paymentMethod', label: 'Payment method', hint: 'Only counted when both sides state one' },
];

export function SettingsForm({
  config,
  providers,
  hasData,
}: {
  config: MatchingConfig;
  providers: { extraction: string; semantic: string; availableExtraction: string[]; availableSemantic: string[] };
  hasData: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [weights, setWeights] = useState(config.weights);
  const [thresholds, setThresholds] = useState(config.thresholds);
  const [dateWindow, setDateWindow] = useState(config.date);
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  const weightTotal = Object.values(weights).reduce((a, b) => a + b, 0);
  const balanced = Math.abs(weightTotal - 1) < 0.001;

  async function save() {
    setBusy(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weights, thresholds, date: dateWindow }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.show(data.error ?? 'Could not save settings', 'danger');
        return;
      }
      toast.show('Settings saved. Re-run matching to apply them');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function demo(action: 'load' | 'clear') {
    const confirmText =
      action === 'load'
        ? 'Loading the demo replaces everything in this workspace with sample data. Continue?'
        : 'This permanently deletes every receipt, transaction and match in this workspace. Continue?';
    if (!window.confirm(confirmText)) return;

    setDemoBusy(true);
    try {
      const res = await fetch('/api/demo', { method: action === 'load' ? 'POST' : 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show(data.error ?? 'That did not work', 'danger');
        return;
      }
      toast.show(action === 'load' ? `Demo loaded: ${data.receipts} receipts, ${data.transactions} transactions` : 'Workspace cleared');
      router.push('/app');
      router.refresh();
    } finally {
      setDemoBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      {/* Weights */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Matching weights</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          How much each signal counts towards the final score. These should add up to 100%.
        </p>

        <div className="mt-5 grid gap-4">
          {WEIGHT_FIELDS.map((field) => (
            <div key={field.key}>
              <div className="flex items-baseline justify-between gap-3">
                <label className="text-sm font-medium" htmlFor={`w-${field.key}`}>
                  {field.label}
                </label>
                <span className="num text-sm" style={{ color: 'var(--text-muted)' }}>
                  {Math.round(weights[field.key] * 100)}%
                </span>
              </div>
              <input
                id={`w-${field.key}`}
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(weights[field.key] * 100)}
                onChange={(e) => setWeights((w) => ({ ...w, [field.key]: Number(e.target.value) / 100 }))}
                className="mt-2 w-full"
                style={{ accentColor: 'var(--accent)' }}
              />
              <p className="mt-1 text-xs" style={{ color: 'var(--text-subtle)' }}>
                {field.hint}
              </p>
            </div>
          ))}
        </div>

        {!balanced && (
          <p className="mt-4 text-xs" style={{ color: 'var(--warn)' }}>
            Weights add up to {Math.round(weightTotal * 100)}%. Reclip will renormalize them, but it&apos;s easier to
            reason about at 100%.
          </p>
        )}
      </Card>

      {/* Thresholds */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Confidence thresholds</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Where the lines fall between automatic, reviewed and ignored.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="t-auto">
              Match automatically at or above
            </label>
            <input
              id="t-auto"
              type="number"
              min={1}
              max={100}
              className="input"
              value={thresholds.auto}
              onChange={(e) => setThresholds((t) => ({ ...t, auto: Number(e.target.value) }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="t-review">
              Send to review at or above
            </label>
            <input
              id="t-review"
              type="number"
              min={1}
              max={100}
              className="input"
              value={thresholds.review}
              onChange={(e) => setThresholds((t) => ({ ...t, review: Number(e.target.value) }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="d-after">
              Days the bank may post after the receipt
            </label>
            <input
              id="d-after"
              type="number"
              min={0}
              max={60}
              className="input"
              value={dateWindow.maxDaysAfter}
              onChange={(e) => setDateWindow((d) => ({ ...d, maxDaysAfter: Number(e.target.value) }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="d-before">
              Days a transaction may precede the receipt
            </label>
            <input
              id="d-before"
              type="number"
              min={0}
              max={60}
              className="input"
              value={dateWindow.maxDaysBefore}
              onChange={(e) => setDateWindow((d) => ({ ...d, maxDaysBefore: Number(e.target.value) }))}
            />
          </div>
        </div>

        {thresholds.review >= thresholds.auto && (
          <p className="mt-3 text-xs" style={{ color: 'var(--warn)' }}>
            The review threshold should be below the automatic one, or nothing will ever reach review.
          </p>
        )}

        <button className="btn btn-accent mt-5" onClick={save} disabled={busy}>
          {busy && <Spinner />}
          Save matching settings
        </button>
      </Card>

      {/* Providers */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Extraction and AI</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Providers are chosen by environment variable, so the choice lives with whoever runs this instance rather than
          in the app database.
        </p>

        <dl className="mt-4 grid gap-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt style={{ color: 'var(--text-muted)' }}>Extraction provider</dt>
            <dd className="font-medium">{providers.extraction}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt style={{ color: 'var(--text-muted)' }}>Semantic matching</dt>
            <dd className="font-medium">{providers.semantic}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt style={{ color: 'var(--text-muted)' }}>Available here</dt>
            <dd className="font-medium">{providers.availableExtraction.join(', ') || 'local'}</dd>
          </div>
        </dl>

        {providers.extraction === 'local' || providers.extraction === 'mock' ? (
          <div className="mt-4">
            <Alert tone="info">
              Running on the local provider: PDFs with a text layer are parsed in full, and photographed receipts are
              accepted and stored but land in Needs Review for manual entry. Set <code className="text-xs">ANTHROPIC_API_KEY</code>{' '}
              and <code className="text-xs">EXTRACTION_PROVIDER=anthropic</code> to read images too.
            </Alert>
          </div>
        ) : null}
      </Card>

      {/* Workspace data */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Workspace data</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Load a fictional dataset to explore the product, or delete everything in this workspace.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-ghost" onClick={() => demo('load')} disabled={demoBusy}>
            {demoBusy && <Spinner />}
            {hasData ? 'Replace with demo data' : 'Load demo data'}
          </button>
          <button className="btn btn-danger" onClick={() => demo('clear')} disabled={demoBusy || !hasData}>
            Delete everything
          </button>
        </div>
        <p className="mt-3 text-xs" style={{ color: 'var(--text-subtle)' }}>
          Deletion is immediate and permanent, documents included. Reclip keeps no shadow copy.
        </p>
      </Card>

      {toast.node}
    </div>
  );
}
