'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The hero visual: a reconciliation run, played once.
 *
 * It exists to make the value legible in ten seconds, so it shows the real shape of an
 * outcome — most matched, a few to review, a few with no counterpart — rather than a
 * flattering 100%. Honours prefers-reduced-motion by jumping straight to the result.
 */
const STAGES = [
  { label: '100 receipts uploaded', detail: 'JPG, PNG and PDF' },
  { label: 'Extracting', detail: 'merchant · date · total · VAT' },
  { label: '100 receipts processed', detail: 'each field scored for confidence' },
  { label: 'Matching', detail: 'amount · date · merchant · currency' },
];

const OUTCOME = [
  { value: 91, label: 'automatically matched', tone: 'var(--accent)' },
  { value: 6, label: 'need review', tone: 'var(--warn)' },
  { value: 3, label: 'unmatched', tone: 'var(--text-subtle)' },
];

export function HeroDemo() {
  const [step, setStep] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setStep(STAGES.length);
      return;
    }
    for (let i = 1; i <= STAGES.length; i++) {
      timers.current.push(setTimeout(() => setStep(i), i * 850));
    }
    const captured = timers.current;
    return () => captured.forEach(clearTimeout);
  }, []);

  return (
    <div className="card overflow-hidden p-1.5 shadow-pop" aria-label="A reconciliation run: 91 matched, 6 need review, 3 unmatched">
      <div className="rounded-lg px-5 py-6 sm:px-7 sm:py-8" style={{ background: 'var(--surface-sunken)' }}>
        <ol className="grid gap-3">
          {STAGES.map((stage, i) => {
            const active = step > i;
            return (
              <li key={stage.label} className="flex items-center gap-3 transition-opacity duration-500" style={{ opacity: active ? 1 : 0.32 }}>
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-semibold"
                  style={{
                    background: active ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'color-mix(in srgb, var(--text-subtle) 14%, transparent)',
                    color: active ? 'var(--accent-ink)' : 'var(--text-subtle)',
                  }}
                >
                  {active ? '✓' : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{stage.label}</span>
                  <span className="block truncate text-xs" style={{ color: 'var(--text-subtle)' }}>
                    {stage.detail}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        <div
          className="mt-6 grid gap-2 border-t pt-6 transition-opacity duration-700"
          style={{ opacity: step >= STAGES.length ? 1 : 0 }}
        >
          {OUTCOME.map((row) => (
            <div key={row.label} className="flex items-baseline gap-3">
              <span className="num w-10 text-right text-2xl font-semibold tracking-tight" style={{ color: row.tone }}>
                {row.value}
              </span>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {row.label}
              </span>
            </div>
          ))}
          <p className="mt-3 text-xs" style={{ color: 'var(--text-subtle)' }}>
            You review six. Reclip did the other ninety-four.
          </p>
        </div>
      </div>
    </div>
  );
}
