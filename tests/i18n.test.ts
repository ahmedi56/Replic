import { describe, it, expect } from 'vitest';
import { messages } from '@/lib/i18n/messages';
import { interpolate, negotiateLocale } from '@/lib/i18n/config';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  const keys = Object.keys(messages.en) as Array<keyof typeof messages.en>;

  it('French has every English key and nothing extra', () => {
    expect(Object.keys(messages.fr).sort()).toEqual([...keys].sort());
  });

  it('no French string is empty', () => {
    for (const k of keys) expect(messages.fr[k].trim(), k).not.toBe('');
  });

  it('has every key that pages build from a number or an id', () => {
    const built: string[] = [];
    for (const n of [1, 2, 3]) built.push(`land.problem.${n}.term`, `land.problem.${n}.detail`);
    for (const n of [1, 2, 3, 4, 5]) built.push(`land.how.${n}.title`, `land.how.${n}.body`, `land.sec.${n}`);
    for (const n of [1, 2, 3, 4, 5, 6]) built.push(`land.feat.${n}.title`, `land.feat.${n}.body`);
    for (const plan of ['free', 'pro', 'business']) {
      built.push(`land.plan.${plan}.name`);
      for (const n of [1, 2, 3, 4]) built.push(`land.plan.${plan}.f${n}`);
    }
    // every audit action the dashboard can label
    for (const a of [
      'match.auto', 'match.confirmed', 'match.manual', 'match.suggested', 'match.rejected', 'match.unlinked',
      'receipt.uploaded', 'receipt.extracted', 'receipt.edited', 'receipt.deleted', 'receipt.duplicate_flagged',
      'receipt.duplicate_cleared', 'import.created', 'import.blocked_duplicate', 'export.generated',
      'demo.loaded', 'demo.cleared', 'plan.changed',
    ]) built.push(`act.${a}`);
    for (const key of built) {
      expect(messages.en, key).toHaveProperty([key]);
      expect(messages.fr, key).toHaveProperty([key]);
    }
  });

  it('uses the same {placeholders} in both languages', () => {
    for (const k of keys) expect(placeholders(messages.fr[k]), k).toEqual(placeholders(messages.en[k]));
  });

  it('does not use em dashes in any language', () => {
    for (const k of keys) {
      expect(messages.en[k], k).not.toContain('—');
      expect(messages.fr[k], k).not.toContain('—');
    }
  });
});

describe('interpolate and negotiateLocale', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(interpolate('Hello {name}', { name: 'Sam' })).toBe('Hello Sam');
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}');
    expect(interpolate('Plain')).toBe('Plain');
  });

  it('picks French from a browser header, English otherwise', () => {
    expect(negotiateLocale('fr-TN,fr;q=0.9,en;q=0.5')).toBe('fr');
    expect(negotiateLocale('ar-TN,ar;q=0.9,fr;q=0.5')).toBe('fr');
    expect(negotiateLocale('de-DE,de;q=0.9')).toBe('en');
    expect(negotiateLocale(null)).toBe('en');
    expect(negotiateLocale('en-GB,en;q=0.9,fr;q=0.8')).toBe('en');
  });
});
