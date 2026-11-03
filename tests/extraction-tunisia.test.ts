import { describe, it, expect } from 'vitest';
import { parseAmount, parseDate, parseReceiptText } from '@/lib/extraction/parse-text';
import { defaultImportCurrency } from '@/lib/currency';
import { previewCsv, parseRows } from '@/lib/import/csv';

/**
 * Receipts as they are printed in Tunisia: French (sometimes Arabic) labels, "TTC", "TVA",
 * the dinar written "DT", amounts with three decimals ("47,850"), and a 1 DT stamp duty
 * ("timbre fiscal") that is not VAT.
 */

const SUPERMARKET = `MONOPRIX
Av. Habib Bourguiba, Tunis
MF: 1234567/A/M/000
Date: 12/10/2026
Ticket N° 4521

Total HT          40,210 DT
TVA 19%            7,640 DT
Total TTC         47,850 DT

Payé par carte bancaire`;

describe('Tunisian receipts: the basics', () => {
  const r = parseReceiptText(SUPERMARKET);

  it('reads the merchant, date, invoice number and payment', () => {
    expect(r.fields.merchant).toBe('MONOPRIX');
    expect(r.fields.date).toBe('2026-10-12');
    expect(r.fields.invoiceNumber).toBe('4521');
    expect(r.fields.paymentMethod).toBe('card');
  });

  it('recognises "DT" as the Tunisian dinar', () => {
    expect(r.fields.currency).toBe('TND');
  });

  it('reads three-decimal amounts as dinars, not thousands', () => {
    expect(r.fields.total).toBe(47.85);
    expect(r.fields.subtotal).toBe(40.21);
    expect(r.fields.tax).toBe(7.64);
  });

  it('is confident, because subtotal + tax matches the total', () => {
    expect(r.confidence.total).toBeGreaterThanOrEqual(0.97);
    expect(r.confidence.tax).toBeGreaterThanOrEqual(0.9);
    expect(r.overallConfidence).toBeGreaterThan(0.85);
  });
});

describe('Tunisian receipts: currency', () => {
  it.each([
    ['47,850 DT after a digit', 'Total TTC 47,850 DT', 'TND'],
    ['DT with no space', 'Total TTC 47,850DT', 'TND'],
    ['DTN spelling', 'Total TTC 47,850 DTN', 'TND'],
    ['the code TND', 'Total TTC 47,850 TND', 'TND'],
    ['the Arabic abbreviation', 'المجموع 47.850 د.ت', 'TND'],
    ['the words "dinars tunisiens"', 'Montant en dinars tunisiens : 47,850', 'TND'],
  ])('%s', (_name, text, code) => {
    expect(parseReceiptText(`SHOP\n${text}`).fields.currency).toBe(code);
  });

  it('does not mistake other uses of the letters DT for a currency', () => {
    expect(parseReceiptText('SHOP\nTicket DT-4521\nTotal 12.50').fields.currency).toBeNull();
    expect(parseReceiptText('SHOP\nOUTDT 5\nTotal 12.50').fields.currency).toBeNull();
    expect(parseReceiptText('SHOP\nDTP Services\nTotal 12.50').fields.currency).toBeNull();
  });
});

describe('Tunisian receipts: three-decimal amounts', () => {
  it('reads a dot-written three-decimal total when the currency says dinar (was 1000 times too big)', () => {
    const r = parseReceiptText('MAGASIN\nTotal TTC 54.600 DT');
    expect(r.fields.total).toBe(54.6);
  });

  it('reads them from the page alone when no currency is printed', () => {
    const r = parseReceiptText('MAGASIN\nSous-total 40.210\nTVA 7.640\nTotal TTC 47.850');
    expect(r.fields.total).toBe(47.85);
    expect(r.fields.subtotal).toBe(40.21);
    expect(r.fields.currency).toBeNull(); // nothing is invented
  });

  it('is not thrown by a percentage written with two decimals', () => {
    const r = parseReceiptText('MAGASIN\nSous-total 40,210\nTVA 19,00 % 7,640\nTotal TTC 47,850');
    expect(r.fields.total).toBe(47.85);
    expect(r.fields.tax).toBe(7.64);
  });

  it('does not guess when the page mixes two and three decimals', () => {
    // 1.500 here is more likely one thousand five hundred than 1.5
    const r = parseReceiptText('SHOP\nItem            12.50\nItem          1.500\nTotal         1.500');
    expect(r.fields.total).toBe(1500);
  });

  it('works for the other three-decimal currencies', () => {
    expect(parseReceiptText('SHOP\nTOTAL KWD 12.500').fields.total).toBe(12.5);
    expect(parseReceiptText('SHOP\nTOTAL OMR 3,250').fields.total).toBe(3.25);
  });

  it('parseAmount: the three-decimal switch changes only the ambiguous single-separator case', () => {
    expect(parseAmount('47,850', { threeDecimals: true })).toBe(47.85);
    expect(parseAmount('54.600', { threeDecimals: true })).toBe(54.6);
    expect(parseAmount('-12,500', { threeDecimals: true })).toBe(-12.5);
    expect(parseAmount('1.234,567', { threeDecimals: true })).toBe(1234.567);
    expect(parseAmount('1,234.567', { threeDecimals: true })).toBe(1234.567);
    expect(parseAmount('12,5', { threeDecimals: true })).toBe(12.5);
    // without the switch, behaviour is exactly as it was
    expect(parseAmount('47,850')).toBe(47.85);
    expect(parseAmount('54.600')).toBe(54600);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('1,234.56')).toBe(1234.56);
  });
});

describe('Tunisian receipts: the timbre fiscal (stamp duty) is not VAT', () => {
  it('does not make a correct receipt look inconsistent', () => {
    const r = parseReceiptText(`RESTAURANT DAR EL JELD
Facture N° 2026-0873
Date : 05-10-2026
Sous-total HT      40,210 DT
TVA 19%             7,640 DT
Timbre fiscal       1,000 DT
Total TTC          48,850 DT`);
    expect(r.fields.total).toBe(48.85);
    expect(r.fields.tax).toBe(7.64);
    expect(r.confidence.tax).toBeGreaterThanOrEqual(0.9); // was dropped to 0.55 "mismatch"
    expect(r.confidence.total).toBeGreaterThanOrEqual(0.97);
  });

  it('leaves the stamp duty out when working out the tax it did not read', () => {
    const r = parseReceiptText(`RESTAURANT DAR EL JELD
Sous-total HT      40,210 DT
Timbre fiscal       1,000 DT
Total TTC          48,850 DT`);
    expect(r.fields.tax).toBe(7.64); // was 8.64
    expect(r.confidence.tax).toBeLessThan(0.7); // still marked as inferred, not read
  });

  it('is unchanged when there is no stamp duty', () => {
    const r = parseReceiptText(`SHOP\nSous-total HT      40,210 DT\nTotal TTC          47,850 DT`);
    expect(r.fields.tax).toBe(7.64);
  });
});

describe('Tunisian receipts: French and Arabic labels', () => {
  it.each([
    ['Net à payer TTC', 'Net à payer TTC   85,500 DT', 85.5],
    ['Montant TTC', 'Montant TTC       85,500 DT', 85.5],
    ['Total général', 'Total général     85,500 DT', 85.5],
    ['Arabic total', 'المجموع 54.600 د.ت', 54.6],
    ['Arabic total amount', 'المبلغ الجملي 54.600 د.ت', 54.6],
  ])('%s is read as a labelled total', (_name, line, expected) => {
    const r = parseReceiptText(`MAGASIN\n${line}`);
    expect(r.fields.total).toBe(expected);
    expect(r.confidence.total).toBeGreaterThanOrEqual(0.86); // labelled, not "the biggest number"
  });

  it('reads a year-first date, as printed on Arabic receipts', () => {
    expect(parseDate('التاريخ: 2026/10/09')?.iso).toBe('2026-10-09');
    expect(parseDate('2026.10.09')?.iso).toBe('2026-10-09');
    expect(parseDate('2026/10/09')?.confidence).toBeGreaterThanOrEqual(0.97);
  });

  it('reads French month names and day-first dates', () => {
    expect(parseDate('Le 14 octobre 2026')?.iso).toBe('2026-10-14');
    expect(parseDate('Date : 05-10-2026')?.iso).toBe('2026-10-05');
    expect(parseDate('12/10/2026')?.iso).toBe('2026-10-12');
  });

  it('flags an Arabic-only receipt for review instead of pretending', () => {
    const r = parseReceiptText('مغازة الورد\nنهج الحبيب بورقيبة\nالتاريخ: 2026/10/09\nالمجموع 54.600 د.ت');
    expect(r.fields.total).toBe(54.6);
    expect(r.fields.date).toBe('2026-10-09');
    expect(r.fields.merchant).toBeNull(); // not read: the merchant is left for a person
    expect(r.overallConfidence).toBeLessThan(0.85);
  });
});

describe('Gulf and North African currency codes', () => {
  it.each([
    ['AED 125.50', 'AED', 125.5],
    ['SAR 99.00', 'SAR', 99],
    ['QAR 45.50', 'QAR', 45.5],
    ['KWD 12.500', 'KWD', 12.5],
    ['EGP 350.00', 'EGP', 350],
    ['DZD 4,500.00', 'DZD', 4500],
    ['KES 1,250.00', 'KES', 1250],
  ])('%s', (text, code, total) => {
    const r = parseReceiptText(`SHOP
TOTAL ${text}`);
    expect(r.fields.currency).toBe(code);
    expect(r.fields.total).toBe(total);
  });

  it('does not read an ordinary word as a currency', () => {
    expect(parseReceiptText('Sar Restaurant\nTotal 45.50').fields.currency).toBeNull();
    expect(parseReceiptText('Kes Cafe\nTotal 45.50').fields.currency).toBeNull();
  });
});

describe('Receipts elsewhere are read exactly as before', () => {
  it('English euro receipt', () => {
    const r = parseReceiptText('CARREFOUR MARKET\n12 Avenue Habib Bourguiba, Tunis\nInvoice No: INV-48000\nDate: 12 Oct 2026\nTOTAL EUR 47.85\nCurrency: EUR');
    expect(r.fields).toMatchObject({ merchant: 'CARREFOUR MARKET', date: '2026-10-12', total: 47.85, currency: 'EUR', invoiceNumber: 'INV-48000' });
  });

  it('thousands separators in dollars and euros', () => {
    expect(parseReceiptText('SHOP\nTOTAL $1,234.50').fields.total).toBe(1234.5);
    expect(parseReceiptText('SHOP\nTOTAL EUR 1.234,56').fields.total).toBe(1234.56);
    expect(parseReceiptText('SHOP\nTOTAL £2,500.00').fields.total).toBe(2500);
  });

  it('a euro receipt with subtotal and VAT keeps its high confidence', () => {
    const r = parseReceiptText('SHOP\nSubtotal EUR 40.21\nVAT EUR 7.64\nTOTAL EUR 47.85');
    expect(r.fields.tax).toBe(7.64);
    expect(r.confidence.total).toBeGreaterThanOrEqual(0.97);
  });

  it('a euro receipt that does not add up still loses tax confidence', () => {
    const r = parseReceiptText('SHOP\nSubtotal EUR 40.21\nVAT EUR 9.99\nTOTAL EUR 47.85');
    expect(r.confidence.tax).toBeLessThanOrEqual(0.55);
  });

  it('a two-decimal page is never taken for three decimals', () => {
    expect(parseReceiptText('SHOP\nItem 4.20\nTotal 4.20').fields.total).toBe(4.2);
  });

  it('a US-style total of a thousand with no cents is left alone when the currency is dollars', () => {
    expect(parseReceiptText('SHOP\nTOTAL USD 1.250,00').fields.total).toBe(1250);
  });
});

describe('Tunisian bank statement import', () => {
  const csv = [
    'Date opération;Date valeur;Libellé;Débit;Crédit;Solde',
    '12/10/2026;12/10/2026;ACHAT CB MONOPRIX TUNIS 0871;47,850;;1 952,150',
    '09/10/2026;09/10/2026;VIREMENT RECU CLIENT FACT 2291;;1 800,000;3 448,700',
    '08/10/2026;08/10/2026;ACHAT CB MAGASIN GENERAL;54.600;;1 848,700',
  ].join('\n');

  it('maps accented French headers', () => {
    const p = previewCsv(csv);
    expect(p.suggestedMapping['Date opération']).toBe('date');
    expect(p.suggestedMapping['Libellé']).toBe('description');
    expect(p.suggestedMapping['Débit']).toBe('debit');
    expect(p.suggestedMapping['Crédit']).toBe('credit');
  });

  it('notices that amounts have three decimals', () => {
    expect(previewCsv(csv).amountsLookThreeDecimal).toBe(true);
    expect(previewCsv('Date,Description,Amount\n01/02/2026,Coffee,4.50\n02/02/2026,Tea,3.20').amountsLookThreeDecimal).toBe(false);
  });

  it('reads dinar amounts as dinars when the currency is TND', () => {
    const mapping = previewCsv(csv).suggestedMapping;
    const { rows, issues } = parseRows(csv, { mapping, defaultCurrency: 'TND', dateOrder: 'dmy' });
    expect(issues).toEqual([]);
    expect(rows.map((r) => r.amount)).toEqual([-47.85, 1800, -54.6]);
    expect(rows[0].currency).toBe('TND');
  });

  it('keeps the old reading for euro files', () => {
    const mapping = previewCsv(csv).suggestedMapping;
    const { rows } = parseRows(csv, { mapping, defaultCurrency: 'EUR', dateOrder: 'dmy' });
    expect(rows[2].amount).toBe(-54600);
  });
});

describe('default import currency', () => {
  it('uses the bank account currency when there is one', () => {
    expect(defaultImportCurrency('tnd', null, 'en')).toBe('TND');
    expect(defaultImportCurrency('EUR', 'TND', 'fr')).toBe('EUR');
  });

  it('then the currency most receipts are in, whatever the language', () => {
    expect(defaultImportCurrency(null, 'EUR', 'fr')).toBe('EUR'); // a French visitor in France
    expect(defaultImportCurrency(undefined, 'tnd', 'en')).toBe('TND'); // an English reader in Tunisia
  });

  it('follows the language only as a last guess', () => {
    expect(defaultImportCurrency(undefined, null, 'fr')).toBe('TND');
    expect(defaultImportCurrency(null, undefined, 'en')).toBe('USD');
    expect(defaultImportCurrency('', '', 'fr')).toBe('TND');
    expect(defaultImportCurrency('??', 'xx', 'en')).toBe('USD');
  });
});
