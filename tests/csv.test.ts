import { describe, it, expect } from 'vitest';
import { previewCsv, parseRows, detectMapping, parseCsvDate, checksum } from '@/lib/import/csv';
import { parseAmount, parseReceiptText } from '@/lib/extraction/parse-text';

const SIMPLE = `date,description,amount,currency
2026-09-28,POS CARREFOUR,-47.85,EUR
2026-09-27,AMAZON EU,-39.99,EUR
2026-09-26,UBER,-18.20,EUR`;

describe('column detection', () => {
  it('maps a straightforward header row', () => {
    const m = detectMapping(['date', 'description', 'amount', 'currency']);
    expect(m).toEqual({ date: 'date', description: 'description', amount: 'amount', currency: 'currency' });
  });

  it('recognises bank-specific header names', () => {
    const m = detectMapping(['Booking Date', 'Transaction Details', 'Debit', 'Credit']);
    expect(m['Booking Date']).toBe('date');
    expect(m['Transaction Details']).toBe('description');
    expect(m['Debit']).toBe('debit');
    expect(m['Credit']).toBe('credit');
  });

  it('recognises German and French headers', () => {
    const de = detectMapping(['Buchungstag', 'Verwendungszweck', 'Betrag', 'Waehrung']);
    expect(de['Buchungstag']).toBe('date');
    expect(de['Verwendungszweck']).toBe('description');
    expect(de['Betrag']).toBe('amount');

    const fr = detectMapping(['Date operation', 'Libelle', 'Montant']);
    expect(fr['Date operation']).toBe('date');
    expect(fr['Libelle']).toBe('description');
    expect(fr['Montant']).toBe('amount');
  });

  it('never assigns one target field to two columns', () => {
    const m = detectMapping(['Date', 'Value Date', 'Description', 'Amount']);
    const dates = Object.values(m).filter((v) => v === 'date');
    expect(dates).toHaveLength(1);
  });

  it('falls back to the widest text column for description', () => {
    const m = detectMapping(['Date', 'Amount', 'Blurb'], [['2026-09-28', '-47.85', 'POS CARREFOUR MARKET TUNIS']]);
    expect(m['Blurb']).toBe('description');
  });
});

describe('date parsing', () => {
  it('reads ISO, named-month and numeric dates', () => {
    expect(parseCsvDate('2026-09-28')?.toISOString().slice(0, 10)).toBe('2026-09-28');
    expect(parseCsvDate('28 Sep 2026')?.toISOString().slice(0, 10)).toBe('2026-09-28');
    expect(parseCsvDate('28/09/2026')?.toISOString().slice(0, 10)).toBe('2026-09-28');
    expect(parseCsvDate('20260928')?.toISOString().slice(0, 10)).toBe('2026-09-28');
  });

  it('uses the day when it cannot be a month', () => {
    expect(parseCsvDate('28/09/2026')?.toISOString().slice(0, 10)).toBe('2026-09-28');
    expect(parseCsvDate('09/28/2026')?.toISOString().slice(0, 10)).toBe('2026-09-28');
  });

  it('honours the chosen order when genuinely ambiguous', () => {
    expect(parseCsvDate('01/02/2026', 'dmy')?.toISOString().slice(0, 10)).toBe('2026-02-01');
    expect(parseCsvDate('01/02/2026', 'mdy')?.toISOString().slice(0, 10)).toBe('2026-01-02');
  });

  it('rejects an impossible date', () => {
    expect(parseCsvDate('32/13/2026')).toBeNull();
  });
});

describe('amount parsing', () => {
  it('handles both decimal conventions', () => {
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('47,85')).toBe(47.85);
    expect(parseAmount('47.85')).toBe(47.85);
    expect(parseAmount('-47.85')).toBe(-47.85);
    expect(parseAmount('€ 47.85')).toBe(47.85);
  });

  it('returns null for junk', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});

describe('previewCsv', () => {
  it('returns headers, samples and a suggested mapping', () => {
    const p = previewCsv(SIMPLE);
    expect(p.headers).toEqual(['date', 'description', 'amount', 'currency']);
    expect(p.totalRows).toBe(3);
    expect(p.sampleRows[0][1]).toBe('POS CARREFOUR');
    expect(p.suggestedMapping['amount']).toBe('amount');
  });

  it('flags ambiguous date order', () => {
    const p = previewCsv(`Date,Description,Amount\n01/02/2026,SHOP,-10.00\n03/04/2026,SHOP,-11.00`);
    expect(p.dateOrderAmbiguous).toBe(true);
  });

  it('does not flag when a sample settles the order', () => {
    const p = previewCsv(`Date,Description,Amount\n28/09/2026,SHOP,-10.00`);
    expect(p.dateOrderAmbiguous).toBe(false);
  });

  it('survives an empty file', () => {
    expect(previewCsv('').totalRows).toBe(0);
  });
});

describe('parseRows', () => {
  it('parses a clean file and normalizes descriptions', () => {
    const { rows, issues } = parseRows(SIMPLE, { mapping: previewCsv(SIMPLE).suggestedMapping });
    expect(issues).toHaveLength(0);
    expect(rows).toHaveLength(3);
    expect(rows[0].amount).toBe(-47.85);
    expect(rows[0].descriptionRaw).toBe('POS CARREFOUR'); // original preserved
    expect(rows[0].merchantNorm).toBe('carrefour');
    expect(rows[0].paymentMethod).toBe('card');
  });

  it('combines split debit and credit columns into one signed amount', () => {
    const csv = `Booking Date,Details,Debit,Credit\n28/09/2026,CARREFOUR,47.85,\n27/09/2026,SALARY,,2500.00`;
    const { rows } = parseRows(csv, { mapping: previewCsv(csv).suggestedMapping });
    expect(rows[0].amount).toBe(-47.85);
    expect(rows[1].amount).toBe(2500);
  });

  it('reports missing required columns instead of importing nothing silently', () => {
    const csv = `Foo,Bar\nhello,world`;
    const { rows, issues } = parseRows(csv, { mapping: { Foo: 'ignore', Bar: 'ignore' } });
    expect(rows).toHaveLength(0);
    expect(issues.some((i) => /Date/.test(i.reason))).toBe(true);
  });

  it('skips malformed rows but keeps the good ones', () => {
    const csv = `date,description,amount\n2026-09-28,OK,-10.00\nnot-a-date,BAD,-11.00\n2026-09-26,ALSO OK,-12.00`;
    const { rows, issues } = parseRows(csv, { mapping: { date: 'date', description: 'description', amount: 'amount' } });
    expect(rows).toHaveLength(2);
    expect(issues).toHaveLength(1);
    expect(issues[0].rowNumber).toBe(3);
  });

  it('gives identical rows the same fingerprint across imports', () => {
    const a = parseRows(SIMPLE, { mapping: previewCsv(SIMPLE).suggestedMapping }).rows;
    const b = parseRows(SIMPLE, { mapping: previewCsv(SIMPLE).suggestedMapping }).rows;
    expect(a[0].fingerprint).toBe(b[0].fingerprint);
  });

  it('gives the same file a stable checksum, so a re-import can be blocked', () => {
    expect(checksum(SIMPLE)).toBe(checksum(SIMPLE));
    expect(checksum(SIMPLE)).not.toBe(checksum(SIMPLE + '\n2026-09-25,X,-1.00,EUR'));
  });

  it('handles quoted fields containing commas', () => {
    const csv = `date,description,amount\n2026-09-28,"CARREFOUR, TUNIS",-47.85`;
    const { rows } = parseRows(csv, { mapping: { date: 'date', description: 'description', amount: 'amount' } });
    expect(rows[0].descriptionRaw).toBe('CARREFOUR, TUNIS');
  });

  it('inverts amounts when the bank exports expenses as positive', () => {
    const csv = `date,description,amount\n2026-09-28,CARREFOUR,47.85`;
    const { rows } = parseRows(csv, { mapping: { date: 'date', description: 'description', amount: 'amount' }, invertAmounts: true });
    expect(rows[0].amount).toBe(-47.85);
  });
});

describe('receipt text extraction', () => {
  const RECEIPT = `CARREFOUR MARKET
12 Avenue Habib Bourguiba, Tunis
Tel: +216 71 000 000

Invoice No: INV-48291
Date: 28/09/2026

2 x Coffee            9.00
1 x Baguette          1.20
Cheese               37.65

Subtotal             40.21
VAT 19%               7.64
TOTAL TTC            47.85

Paid by VISA`;

  it('extracts the fields matching depends on', () => {
    const { fields, confidence } = parseReceiptText(RECEIPT);
    expect(fields.merchant).toBe('CARREFOUR MARKET');
    expect(fields.date).toBe('2026-09-28');
    expect(fields.total).toBe(47.85);
    expect(fields.subtotal).toBe(40.21);
    expect(fields.tax).toBe(7.64);
    expect(fields.currency).toBeNull(); // no symbol or code on this receipt
    expect(fields.invoiceNumber).toBe('INV-48291');
    expect(fields.paymentMethod).toBe('card');
    expect(confidence.total).toBeGreaterThan(0.9);
  });

  it('raises confidence when subtotal + tax reconciles to the total', () => {
    const { confidence } = parseReceiptText(RECEIPT);
    expect(confidence.total).toBeGreaterThanOrEqual(0.99);
  });

  it('lowers confidence when the arithmetic does not reconcile', () => {
    const broken = RECEIPT.replace('VAT 19%               7.64', 'VAT 19%              99.00');
    const { confidence } = parseReceiptText(broken);
    expect(confidence.tax).toBeLessThan(0.7);
  });

  it('flags a low overall confidence when the total is unlabelled', () => {
    const { confidence, overallConfidence } = parseReceiptText('SOME SHOP\n28/09/2026\n47.85');
    expect(confidence.total).toBeLessThan(0.6);
    expect(overallConfidence).toBeLessThan(0.8);
  });

  it('reads a euro symbol and a different date format', () => {
    const { fields } = parseReceiptText('BLUE BOTTLE\n28 September 2026\nTOTAL  €12.50');
    expect(fields.currency).toBe('EUR');
    expect(fields.date).toBe('2026-09-28');
    expect(fields.total).toBe(12.5);
  });

  it('returns nulls rather than guesses on unreadable input', () => {
    const { fields, overallConfidence } = parseReceiptText('~~~ ### ~~~');
    expect(fields.total).toBeNull();
    expect(overallConfidence).toBeLessThan(0.3);
  });

  it('extracts line items', () => {
    const { fields } = parseReceiptText(RECEIPT);
    expect(fields.items.length).toBeGreaterThanOrEqual(2);
    expect(fields.items[0]).toMatchObject({ description: 'Coffee', quantity: 2 });
  });
});
