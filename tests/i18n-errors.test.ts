import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeT } from '@/lib/i18n/translate';
import { translateError } from '@/lib/i18n/errors';

const en = makeT('en');
const fr = makeT('fr');

/** Every file that raises an error a person can see in the app. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

// Messages only an operator ever sees (internal checks, the plan command), not the customer.
const OPERATOR_ONLY = [
  'Invalid storage key',
  'Invalid organization id',
  'Not a backup key',
];

describe('server messages', () => {
  const literals = new Set<string>();
  for (const file of [...sourceFiles('src/app/api'), 'src/lib/api.ts', 'src/lib/storage.ts', 'src/lib/services/account.ts', 'src/lib/services/imports.ts', 'src/lib/import/csv.ts']) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/ApiError\(\s*\d+,\s*'([^'\n]+)'/g)) literals.add(m[1]);
    for (const m of text.matchAll(/reason: '([^'\n]+)'/g)) literals.add(m[1]);
    for (const m of text.matchAll(/(?:notFound|forbidden|badRequest)\('([^'\n]+)'/g)) literals.add(m[1]);
  }

  it('finds the messages to check', () => {
    expect(literals.size).toBeGreaterThan(25);
  });

  it('every customer-facing message has a French translation', () => {
    const missing: string[] = [];
    for (const message of literals) {
      if (OPERATOR_ONLY.includes(message)) continue;
      const french = translateError(message, fr);
      if (!french || french === message) missing.push(message);
    }
    expect(missing).toEqual([]);
  });

  it('English stays exactly as the server wrote it', () => {
    for (const message of literals) {
      if (OPERATOR_ONLY.includes(message)) continue;
      expect(translateError(message, en), message).toBe(message);
    }
  });

  it('fills in numbers, dates and plan names', () => {
    expect(translateError('File is larger than 15MB', fr)).toBe('Le fichier dépasse 15 Mo');
    expect(translateError('Unreadable date: "31/31/2026"', fr)).toBe('Date illisible : « 31/31/2026 »');
    expect(translateError('You have used all 50 receipts on the Free plan this month. Upgrade to add more.', fr)).toContain('50 justificatifs de l’offre Gratuit');
    expect(
      translateError('Your Pro plan ended on 2026-10-30, so the Free limit of 50 receipts a month applies. Renew to add more.', fr),
    ).toContain('2026-10-30');
    expect(translateError('This exact file was already imported on 01/11/2026. Import it again anyway?', fr)).toContain('01/11/2026');
  });

  it('shows an unknown message as written, and nothing for no message', () => {
    expect(translateError('Brand new server sentence', fr)).toBe('Brand new server sentence');
    expect(translateError(undefined, fr)).toBeUndefined();
    expect(translateError('', fr)).toBeUndefined();
  });
});

describe('emails', () => {
  it('have the same placeholders in both languages and French text', () => {
    for (const kind of ['reset', 'verify'] as const) {
      expect(fr(`mail.${kind}.subject`)).not.toBe(en(`mail.${kind}.subject`));
      expect(fr(`mail.${kind}.valid`, { n: 2 })).toContain('2');
    }
  });
});
