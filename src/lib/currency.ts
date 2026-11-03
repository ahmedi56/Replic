/**
 * Currency facts the reader, the bank importer and the import screen all rely on.
 * Kept free of server-only code so the browser can use it too.
 */

/** Currencies written with three decimals, so "47,850" is 47.85 and not 47,850. */
export const THREE_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set(['TND', 'KWD', 'BHD', 'OMR', 'JOD', 'LYD']);

export function isThreeDecimalCurrency(code: string | null | undefined): boolean {
  return Boolean(code) && THREE_DECIMAL_CURRENCIES.has((code as string).toUpperCase());
}

/**
 * Do these number strings look like three-decimal amounts? True when at least two of them
 * are written like "40,210" or "40.210" and none like "40,21". With fewer than two examples,
 * or a mix, there is not enough to say, and the answer is false.
 */
export function valuesLookThreeDecimal(values: string[]): boolean {
  let three = 0;
  for (const raw of values) {
    const v = raw.trim().replace(/\s+/g, '');
    if (!/\d[.,]\d/.test(v)) continue; // no separator: says nothing
    if (/^-?\d{1,6}[.,]\d{3}$/.test(v)) three++;
    else if (/^-?\d{1,6}[.,]\d{2}$/.test(v)) return false;
  }
  return three >= 2;
}
