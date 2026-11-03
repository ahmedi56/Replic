'use client';

import { useRouter } from 'next/navigation';
import { LOCALES, LOCALE_COOKIE, LOCALE_LABELS, type Locale } from '@/lib/i18n/config';
import { useLocale, useT } from '@/lib/i18n/client';

/** Saves the choice in a cookie (a year), then asks the server to render the page again. */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useT();

  function choose(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div className={`inline-flex items-center gap-1 text-xs ${className}`} role="group" aria-label={t('common.language')}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => choose(l)}
          lang={l}
          aria-pressed={l === locale}
          className="rounded-md px-2 py-1 transition-colors"
          style={{
            background: l === locale ? 'color-mix(in srgb, var(--accent) 13%, transparent)' : 'transparent',
            color: l === locale ? 'var(--accent-ink)' : 'var(--text-muted)',
            fontWeight: l === locale ? 600 : 400,
          }}
        >
          {LOCALE_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
