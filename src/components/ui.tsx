'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Shared presentational primitives. Deliberately small — no component library. */

export { formatMoney, formatDate, formatRelative } from '@/lib/format';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONE_STYLE: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: 'color-mix(in srgb, var(--text-subtle) 14%, transparent)', fg: 'var(--text-muted)' },
  success: { bg: 'color-mix(in srgb, var(--accent) 16%, transparent)', fg: 'var(--accent-ink)' },
  warning: { bg: 'var(--warn-bg)', fg: 'var(--warn)' },
  danger: { bg: 'var(--danger-bg)', fg: 'var(--danger)' },
  info: { bg: 'color-mix(in srgb, #3b82f6 14%, transparent)', fg: '#2563eb' },
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  const style = TONE_STYLE[tone];
  return (
    <span className="chip" style={{ background: style.bg, color: style.fg }}>
      {children}
    </span>
  );
}

/** Confidence is the product's core signal, so it always reads the same way. */
export function ConfidenceBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <Badge tone="neutral">-</Badge>;
  const pct = value <= 1 ? Math.round(value * 100) : Math.round(value);
  const tone: Tone = pct >= 90 ? 'success' : pct >= 70 ? 'warning' : 'danger';
  return <Badge tone={tone}>{pct}%</Badge>;
}

export function StatusBadge({ status, isDuplicate }: { status: string; isDuplicate?: boolean }) {
  if (isDuplicate) return <Badge tone="warning">Possible duplicate</Badge>;
  const map: Record<string, { label: string; tone: Tone }> = {
    uploaded: { label: 'Uploaded', tone: 'neutral' },
    processing: { label: 'Processing', tone: 'info' },
    extracting: { label: 'Extracting', tone: 'info' },
    matching: { label: 'Matching', tone: 'info' },
    completed: { label: 'Processed', tone: 'neutral' },
    unmatched: { label: 'Unmatched', tone: 'neutral' },
    needs_review: { label: 'Needs review', tone: 'warning' },
    failed: { label: 'Failed', tone: 'danger' },
    confirmed: { label: 'Confirmed', tone: 'success' },
    auto: { label: 'Auto-matched', tone: 'success' },
    suggested: { label: 'Needs review', tone: 'warning' },
    rejected: { label: 'Rejected', tone: 'neutral' },
  };
  const entry = map[status] ?? { label: status, tone: 'neutral' as Tone };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card shadow-card ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm" style={{ color: 'var(--text-muted)' }}>
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

/** Empty states carry the next action, never just an apology. */
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 opacity-40">{icon}</div>}
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm" style={{ color: 'var(--text-muted)' }}>
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.2" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: 'color-mix(in srgb, var(--text-subtle) 20%, transparent)' }}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
      >
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
      </div>
    </div>
  );
}

export function Alert({ tone = 'info', title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  const style = TONE_STYLE[tone];
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}
      className="rounded-lg border px-4 py-3 text-sm"
      style={{ background: style.bg, borderColor: 'transparent', color: style.fg }}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1' : ''}>{children}</div>
    </div>
  );
}

/** Transient confirmation for actions that don't navigate. */
export function useToast() {
  const [message, setMessage] = useState<{ text: string; tone: Tone } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function show(text: string, tone: Tone = 'success') {
    setMessage({ text, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 4000);
  }

  const node = message ? (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto rounded-lg px-4 py-2.5 text-sm font-medium shadow-pop"
        style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: TONE_STYLE[message.tone].fg }}
      >
        {message.text}
      </div>
    </div>
  ) : null;

  return { show, node };
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        <span className="num">{from}–{to}</span> of <span className="num">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <button className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={() => onChange(page - 1)} disabled={page <= 1}>
          Previous
        </button>
        <span className="num text-xs" style={{ color: 'var(--text-muted)' }}>
          {page} / {pages}
        </span>
        <button className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={() => onChange(page + 1)} disabled={page >= pages}>
          Next
        </button>
      </div>
    </div>
  );
}

/** Debounce for search inputs, so typing doesn't fire a request per keystroke. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
