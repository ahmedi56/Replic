'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';

/**
 * The hero visual: a reconciliation run, played once.
 *
 * It exists to make the value legible in ten seconds, so it shows the real shape of an
 * outcome — most matched, a few to review, a few with no counterpart — rather than a
 * flattering 100%. Honours prefers-reduced-motion by jumping straight to the result.
 */
const STAGES: Array<{ label: MessageKey; detail: MessageKey }> = [
  { label: 'hero.s1', detail: 'hero.s1d' },
  { label: 'hero.s2', detail: 'hero.s2d' },
  { label: 'hero.s3', detail: 'hero.s3d' },
  { label: 'hero.s4', detail: 'hero.s4d' },
];

const OUTCOME: Array<{ value: number; label: MessageKey; tone: string }> = [
  { value: 91, label: 'hero.o1', tone: 'var(--accent)' },
  { value: 6, label: 'hero.o2', tone: 'var(--warn)' },
  { value: 3, label: 'hero.o3', tone: 'var(--text-subtle)' },
];

export function HeroDemo() {
  const t = useT();
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
    <div className="card overflow-hidden p-1.5 shadow-pop" aria-label={t('hero.aria')}>
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
                  <span className="block truncate text-sm font-medium">{t(stage.label)}</span>
                  <span className="block truncate text-xs" style={{ color: 'var(--text-subtle)' }}>
                    {t(stage.detail)}
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
                {t(row.label)}
              </span>
            </div>
          ))}
          <p className="mt-3 text-xs" style={{ color: 'var(--text-subtle)' }}>
            {t('hero.note')}
          </p>
        </div>
      </div>
    </div>
  );
}
