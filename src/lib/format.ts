/**
 * Pure formatting helpers.
 *
 * Deliberately in their own module with no 'use client' directive, so server components
 * and client components can both import them.
 */

export function formatMoney(amount: number | null | undefined, currency = 'EUR', opts: { signed?: boolean } = {}): string {
  if (amount == null || !Number.isFinite(amount)) return '-';
  const value = opts.signed ? amount : Math.abs(amount);
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(value);
  } catch {
    // Unknown or malformed currency code — fall back rather than throwing mid-render.
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatRelative(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDate(d);
}
