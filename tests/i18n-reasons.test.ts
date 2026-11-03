import { describe, it, expect } from 'vitest';
import { messages } from '@/lib/i18n/messages';
import { interpolate, type Locale } from '@/lib/i18n/config';
import { translateReason } from '@/lib/i18n/reasons';

const tFor = (locale: Locale) => (key: keyof typeof messages.en, params?: Record<string, string | number>) =>
  interpolate(messages[locale][key], params);

/** Every sentence the matching engine can write (see src/lib/matching/score.ts and duplicates.ts). */
const ENGLISH_REASONS = [
  'Receipt total missing',
  'Exact amount',
  'Amounts differ by 0.50',
  'Receipt date missing',
  'Same date',
  '9 days after receipt, outside tolerance',
  '2 days before receipt, outside tolerance',
  'Transaction 1 day after receipt',
  'Transaction 3 days before receipt',
  'Merchant unavailable',
  'Merchant similarity 12%, too low',
  'Merchant similarity 94%',
  'Merchant similarity 88% (semantic)',
  'Receipt currency missing',
  'Same currency (TND)',
  'Currency mismatch: EUR vs TND',
  'Payment method unknown',
  'Both paid by card',
  'Payment method differs: card vs cash',
  'Amounts are too far apart',
  'Currency mismatch: needs a human',
  'Dates are outside the tolerance window',
  'The same file has already been uploaded',
  'Invoice number INV-1 already recorded',
  'Same merchant, amount and date as an existing receipt',
  'Same merchant and amount as a receipt from 1 day earlier',
  'Same merchant and amount as a receipt from 2 days earlier',
];

describe('translateReason', () => {
  it('turns English into itself, so English users see exactly what the engine wrote', () => {
    for (const r of ENGLISH_REASONS) expect(translateReason(r, tFor('en')), r).toBe(r);
  });

  it('recognises every sentence in French, and leaves no English behind', () => {
    for (const r of ENGLISH_REASONS) {
      const fr = translateReason(r, tFor('fr'));
      expect(fr, r).not.toBe(r);
      expect(fr, r).not.toMatch(/\{\w+\}/); // no unfilled placeholder
    }
  });

  it('fills the numbers and codes in', () => {
    const t = tFor('fr');
    expect(translateReason('Transaction 1 day after receipt', t)).toBe('Opération 1 jour après le justificatif');
    expect(translateReason('Transaction 3 days before receipt', t)).toBe('Opération 3 jours avant le justificatif');
    expect(translateReason('Merchant similarity 88% (semantic)', t)).toBe('Similarité du commerçant 88 % (sémantique)');
    expect(translateReason('Same currency (TND)', t)).toBe('Même devise (TND)');
  });

  it('shows a sentence it does not know as written, never blank', () => {
    expect(translateReason('Something new the engine says', tFor('fr'))).toBe('Something new the engine says');
  });
});
