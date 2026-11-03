'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, ConfidenceBadge, Spinner, formatDate, formatMoney, useToast } from '@/components/ui';
import type { StoredBreakdown } from '@/lib/matching/score';
import { useLocale, useT } from '@/lib/i18n/client';
import { translateReason } from '@/lib/i18n/reasons';
import type { MessageKey } from '@/lib/i18n/messages';

/**
 * The review queue.
 *
 * The goal is fifty decisions in a few minutes, so each card puts the two sides
 * side by side, states the confidence, lists the reasons behind it, and offers exactly
 * two buttons. Decisions apply optimistically — the card leaves immediately and rolls
 * back only if the request fails.
 */

export interface ReviewRow {
  matchId: string;
  score: number;
  status: string;
  method: string;
  parsedBreakdown: StoredBreakdown | null;
  receiptId: string;
  receiptName: string;
  merchantRaw: string | null;
  receiptDate: Date | string | null;
  receiptTotal: number | null;
  receiptCurrency: string | null;
  receiptConfidence: number | null;
  transactionId: string;
  descriptionRaw: string;
  transactionDate: Date | string;
  amount: number;
  transactionCurrency: string;
}

const SIGNAL_LABEL: Record<string, MessageKey> = {
  amount: 'sig.amount',
  date: 'sig.date',
  merchant: 'sig.merchant',
  currency: 'sig.currency',
  paymentMethod: 'sig.paymentMethod',
};

export function ReviewQueue({ initial, total }: { initial: ReviewRow[]; total: number }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const toast = useToast();

  const decided = total - rows.length;

  async function decide(matchId: string, action: 'confirm' | 'reject') {
    setPending(matchId);
    const snapshot = rows;
    setRows((prev) => prev.filter((r) => r.matchId !== matchId));

    try {
      const res = await fetch(`/api/matches/${matchId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRows(snapshot); // put it back — the decision didn't stick
        toast.show(data.error ?? t('rev.err.save'), 'danger');
        return;
      }
      toast.show(action === 'confirm' ? t('rev.confirmed') : t('rev.rejected'));
      router.refresh();
    } catch {
      setRows(snapshot);
      toast.show(t('common.offline'), 'danger');
    } finally {
      setPending(null);
    }
  }

  if (rows.length === 0) {
    return (
      <Card className="px-6 py-14 text-center">
        <p className="text-sm font-semibold">{t('rev.caughtUp')}</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          {decided === 1 ? t('rev.reviewedOne') : t('rev.reviewedMany', { n: decided })}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/app" className="btn btn-ghost">
            {t('rev.backDash')}
          </Link>
          <Link href="/app/matches" className="btn btn-accent">
            {t('rev.seeMatched')}
          </Link>
        </div>
        {toast.node}
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
        {t('rev.remaining', { n: rows.length })}
        {decided > 0 && <> · {t('rev.decided', { n: decided })}</>}
      </p>

      {rows.map((row) => {
        const reasons = row.parsedBreakdown?.signals.filter((s) => s.applicable) ?? [];
        const busy = pending === row.matchId;

        return (
          <Card key={row.matchId} className="overflow-hidden">
            {/* Two sides */}
            <div className="grid sm:grid-cols-2">
              <div className="border-b p-5 sm:border-b-0 sm:border-r">
                <p className="text-[0.68rem] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-subtle)' }}>
                  {t('rev.receipt')}
                </p>
                <Link href={`/app/receipts/${row.receiptId}`} className="mt-2 block truncate text-base font-semibold hover:underline">
                  {row.merchantRaw ?? row.receiptName}
                </Link>
                <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {formatDate(row.receiptDate, locale)}
                </p>
                <p className="num mt-3 text-xl font-semibold tracking-tight">
                  {formatMoney(row.receiptTotal, row.receiptCurrency ?? 'EUR', { locale })}
                </p>
                {row.receiptConfidence != null && row.receiptConfidence < 0.7 && (
                  <p className="mt-2 text-xs" style={{ color: 'var(--warn)' }}>
                    {t('rev.extractConf', { pct: Math.round(row.receiptConfidence * 100) })}
                  </p>
                )}
              </div>

              <div className="p-5">
                <p className="text-[0.68rem] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-subtle)' }}>
                  {t('rev.transaction')}
                </p>
                <p className="mt-2 truncate text-base font-semibold" title={row.descriptionRaw}>
                  {row.descriptionRaw}
                </p>
                <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {formatDate(row.transactionDate, locale)}
                </p>
                <p className="num mt-3 text-xl font-semibold tracking-tight" style={{ color: row.amount < 0 ? 'var(--text)' : 'var(--accent-ink)' }}>
                  {row.amount < 0 ? '−' : '+'}
                  {formatMoney(row.amount, row.transactionCurrency, { locale })}
                </p>
              </div>
            </div>

            {/* Why matched */}
            <div className="border-t px-5 py-4" style={{ background: 'var(--surface-sunken)' }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-medium">{t('rev.matchConf')}</span>
                  <ConfidenceBadge value={row.score} />
                  {row.method === 'semantic' && (
                    <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                      {t('rev.semanticNote')}
                    </span>
                  )}
                </div>
              </div>

              <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {reasons.map((signal) => (
                  <li key={signal.name} className="flex items-start gap-2 text-sm">
                    <span
                      className="mt-0.5 shrink-0 text-xs font-bold"
                      style={{ color: signal.positive ? 'var(--accent)' : 'var(--warn)' }}
                      aria-hidden="true"
                    >
                      {signal.positive ? '✓' : '!'}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      <span className="font-medium" style={{ color: 'var(--text)' }}>
                        {SIGNAL_LABEL[signal.name] ? t(SIGNAL_LABEL[signal.name]) : signal.name}:
                      </span>{' '}
                      {translateReason(signal.reason, t)}
                    </span>
                  </li>
                ))}
              </ul>

              {row.parsedBreakdown?.veto && (
                <p className="mt-3 text-xs font-medium" style={{ color: 'var(--warn)' }}>
                  {translateReason(row.parsedBreakdown.veto, t)}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn btn-accent" onClick={() => decide(row.matchId, 'confirm')} disabled={busy}>
                  {busy && <Spinner />}
                  {t('rev.confirm')}
                </button>
                <button className="btn btn-ghost" onClick={() => decide(row.matchId, 'reject')} disabled={busy}>
                  {t('rev.reject')}
                </button>
                <Link href={`/app/receipts/${row.receiptId}`} className="btn btn-ghost">
                  {t('rev.openReceipt')}
                </Link>
              </div>
            </div>
          </Card>
        );
      })}

      {toast.node}
    </div>
  );
}
