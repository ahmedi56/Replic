/**
 * Pure formatting helpers.
 *
 * Deliberately in their own module with no 'use client' directive, so server components
 * and client components can both import them.
 *
 * Every helper takes an optional language. Without one, output is exactly what it always was
 * (British English), so callers that have not been translated yet are unaffected.
 */
import { DEFAULT_LOCALE, FORMAT_LOCALE, type Locale } from './i18n/config';

export function formatMoney(
  amount: number | null | undefined,
  currency = 'EUR',
  opts: { signed?: boolean; locale?: Locale } = {},
): string {
  if (amount == null || !Number.isFinite(amount)) return '-';
  const value = opts.signed ? amount : Math.abs(amount);
  try {
    return new Intl.NumberFormat(FORMAT_LOCALE[opts.locale ?? DEFAULT_LOCALE], { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(value);
  } catch {
    // Unknown or malformed currency code — fall back rather than throwing mid-render.
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** A plain number with thousands separators ("1,250" in English, "1 250" in French). */
export function formatNumber(value: number, locale: Locale = DEFAULT_LOCALE): string {
  return value.toLocaleString(FORMAT_LOCALE[locale]);
}

export function formatDate(date: Date | string | null | undefined, locale: Locale = DEFAULT_LOCALE): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString(FORMAT_LOCALE[locale], { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatRelative(date: Date | string, locale: Locale = DEFAULT_LOCALE): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const minutes = Math.round(diff / 60000);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);

  if (locale === 'fr') {
    if (minutes < 1) return "à l'instant";
    if (minutes < 60) return `il y a ${minutes} min`;
    if (hours < 24) return `il y a ${hours} h`;
    if (days < 30) return `il y a ${days} jour${days === 1 ? '' : 's'}`;
    return formatDate(d, locale);
  }

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDate(d);
}
