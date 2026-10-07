import { describe, it, expect } from 'vitest';
import { normalizeDescription, normalizeMerchant, inferPaymentMethod, extractReference } from '@/lib/matching/normalize';
import { merchantSimilarity, jaroWinkler, tokenSetRatio } from '@/lib/matching/similarity';

describe('normalizeDescription', () => {
  it('strips processor prefixes', () => {
    expect(normalizeDescription('POS CARREFOUR')).toBe('carrefour');
    expect(normalizeDescription('VISA DEBIT AMAZON EU')).toContain('amazon');
    expect(normalizeDescription('SEPA DD SPOTIFY AB')).toContain('spotify');
  });

  it('unwraps star aggregators', () => {
    expect(normalizeDescription('SQ *BLUE BOTTLE COFFEE')).toBe('blue bottle coffee');
    expect(normalizeDescription('PAYPAL *STEAM GAMES')).toBe('steam games');
  });

  it('removes store numbers, refs, dates and card tails', () => {
    expect(normalizeDescription('CARREFOUR #2391')).toBe('carrefour');
    expect(normalizeDescription('UBER TRIP XXXX4412')).toBe('uber trip');
    expect(normalizeDescription('MONOPRIX 28/09/2026')).toBe('monoprix');
  });

  it('keeps diacritic-folded text comparable', () => {
    expect(normalizeDescription('CAFÉ DE FLORE')).toContain('cafe');
  });

  it('never returns the raw string mutated in place', () => {
    const raw = 'POS CARREFOUR MARKET TUNIS';
    normalizeDescription(raw);
    expect(raw).toBe('POS CARREFOUR MARKET TUNIS');
  });
});

describe('normalizeMerchant', () => {
  it('collapses the Carrefour family to one key', () => {
    const keys = ['CARREFOUR TUNIS', 'CARREFOUR MARKET', 'CARREFOUR #2391', 'POS CARREFOUR'].map(normalizeMerchant);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('carrefour');
  });

  it('expands card-network abbreviations', () => {
    expect(normalizeMerchant('AMZN Mktp DE*1A2B3C')).toContain('amazon');
    expect(normalizeMerchant('SBUX STORE 1123')).toBe('starbucks');
  });

  it('does not collapse genuinely different merchants', () => {
    expect(normalizeMerchant('CARREFOUR')).not.toBe(normalizeMerchant('MONOPRIX'));
  });

  it('falls back rather than returning an empty key', () => {
    expect(normalizeMerchant('THE CO')).not.toBe('');
  });
});

describe('similarity', () => {
  it('scores a typo highly', () => {
    expect(merchantSimilarity('carrefour', 'carefour')).toBeGreaterThan(0.85);
  });

  it('scores containment highly', () => {
    expect(merchantSimilarity('carrefour', 'carrefour market tunis')).toBeGreaterThan(0.85);
  });

  it('scores unrelated merchants low', () => {
    expect(merchantSimilarity('carrefour', 'netflix')).toBeLessThan(0.5);
  });

  it('jaroWinkler and tokenSetRatio stay within 0..1', () => {
    for (const [a, b] of [['abc', 'abc'], ['', 'x'], ['uber trip', 'uber technologies']]) {
      expect(jaroWinkler(a, b)).toBeGreaterThanOrEqual(0);
      expect(jaroWinkler(a, b)).toBeLessThanOrEqual(1);
      expect(tokenSetRatio(a, b)).toBeGreaterThanOrEqual(0);
      expect(tokenSetRatio(a, b)).toBeLessThanOrEqual(1);
    }
  });
});

describe('metadata helpers', () => {
  it('infers payment method', () => {
    expect(inferPaymentMethod('POS VISA CARREFOUR')).toBe('card');
    expect(inferPaymentMethod('ATM WITHDRAWAL')).toBe('cash');
    expect(inferPaymentMethod('SEPA TRANSFER RENT')).toBe('transfer');
  });

  it('extracts a reference', () => {
    expect(extractReference('PAYMENT REF INV-48291')).toBe('INV-48291');
  });
});
