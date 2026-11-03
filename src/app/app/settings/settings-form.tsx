'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Card, Spinner, useToast } from '@/components/ui';
import type { MatchingConfig } from '@/lib/matching/config';
import { useApiError, useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';

/**
 * Matching is configurable, and this is where.
 *
 * Weights are shown as a set that must add to 100%, because that is how they behave —
 * the engine renormalizes anyway, and presenting them as independent numbers would
 * mislead. Thresholds are the two lines that separate automatic from reviewed from
 * ignored.
 */

const WEIGHT_FIELDS: Array<{ key: keyof MatchingConfig['weights']; label: MessageKey; hint: MessageKey }> = [
  { key: 'amount', label: 'sig.amount', hint: 'st.hint.amount' },
  { key: 'merchant', label: 'sig.merchant', hint: 'st.hint.merchant' },
  { key: 'date', label: 'sig.date', hint: 'st.hint.date' },
  { key: 'currency', label: 'sig.currency', hint: 'st.hint.currency' },
  { key: 'paymentMethod', label: 'sig.paymentMethod', hint: 'st.hint.paymentMethod' },
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
  const t = useT();
  const apiError = useApiError();
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
        toast.show(apiError(data.error) ?? t('st.err.save'), 'danger');
        return;
      }
      toast.show(t('st.saved'));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function demo(action: 'load' | 'clear') {
    const confirmText =
      action === 'load' ? t('st.confirmLoad') : t('st.confirmClear');
    if (!window.confirm(confirmText)) return;

    setDemoBusy(true);
    try {
      const res = await fetch('/api/demo', { method: action === 'load' ? 'POST' : 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show(apiError(data.error) ?? t('st.err.demo'), 'danger');
        return;
      }
      toast.show(action === 'load' ? t('st.demoLoaded', { receipts: data.receipts, transactions: data.transactions }) : t('st.cleared'));
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
        <h2 className="text-sm font-semibold">{t('st.weights')}</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('st.weightsNote')}
        </p>

        <div className="mt-5 grid gap-4">
          {WEIGHT_FIELDS.map((field) => (
            <div key={field.key}>
              <div className="flex items-baseline justify-between gap-3">
                <label className="text-sm font-medium" htmlFor={`w-${field.key}`}>
                  {t(field.label)}
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
                {t(field.hint)}
              </p>
            </div>
          ))}
        </div>

        {!balanced && (
          <p className="mt-4 text-xs" style={{ color: 'var(--warn)' }}>
            {t('st.unbalanced', { pct: Math.round(weightTotal * 100) })}
          </p>
        )}
      </Card>

      {/* Thresholds */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold">{t('st.thresholds')}</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('st.thresholdsNote')}
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="t-auto">
              {t('st.auto')}
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
              {t('st.review')}
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
              {t('st.daysAfter')}
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
              {t('st.daysBefore')}
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
            {t('st.thresholdWarn')}
          </p>
        )}

        <button className="btn btn-accent mt-5" onClick={save} disabled={busy}>
          {busy && <Spinner />}
          {t('st.saveMatching')}
        </button>
      </Card>

      {/* Providers */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold">{t('st.ai')}</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('st.aiNote')}
        </p>

        <dl className="mt-4 grid gap-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt style={{ color: 'var(--text-muted)' }}>{t('st.extractionProvider')}</dt>
            <dd className="font-medium">{providers.extraction}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt style={{ color: 'var(--text-muted)' }}>{t('st.semantic')}</dt>
            <dd className="font-medium">{providers.semantic}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt style={{ color: 'var(--text-muted)' }}>{t('st.available')}</dt>
            <dd className="font-medium">{providers.availableExtraction.join(', ') || 'local'}</dd>
          </div>
        </dl>

        {providers.extraction === 'local' || providers.extraction === 'mock' ? (
          <div className="mt-4">
            <Alert tone="info">
              {t('st.localA')} <code className="text-xs">ANTHROPIC_API_KEY</code> {t('st.localB')}{' '}
              <code className="text-xs">EXTRACTION_PROVIDER=anthropic</code> {t('st.localC')}
            </Alert>
          </div>
        ) : null}
      </Card>

      {/* Workspace data */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold">{t('st.data')}</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('st.dataNote')}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-ghost" onClick={() => demo('load')} disabled={demoBusy}>
            {demoBusy && <Spinner />}
            {hasData ? t('st.replaceDemo') : t('st.loadDemo')}
          </button>
          <button className="btn btn-danger" onClick={() => demo('clear')} disabled={demoBusy || !hasData}>
            {t('st.deleteAll')}
          </button>
        </div>
        <p className="mt-3 text-xs" style={{ color: 'var(--text-subtle)' }}>
          {t('st.deleteNote')}
        </p>
      </Card>

      {toast.node}
    </div>
  );
}
