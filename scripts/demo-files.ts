/**
 * Make a small set of demo receipts (PDF) and a matching bank statement (CSV), to upload live
 * in a demo or interview. Dates are relative to today, so run it on the day.
 *
 *   npm run demo:files            writes to go-to-market/demo-files
 *   npm run demo:files -- some/dir
 *
 * Everything is fictional. The set is chosen to show every outcome in about five minutes:
 * clean matches, two near-misses that need a human decision (a tip, a small difference), a cash
 * receipt with no bank line, a duplicate file, and bank lines that have no receipt.
 *
 * A second set in the "tunisia" subfolder shows the same outcomes the way a Tunisian business
 * sees them: dinars (DT, three decimals), French labels, a timbre fiscal, and a semicolon-separated
 * bank export with French headers. Import that statement with the currency set to TND.
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeReceiptPdf } from '../src/lib/demo/pdf';

const outDir = path.resolve(process.argv[2] ?? 'go-to-market/demo-files');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const readable = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

interface Receipt {
  file: string;
  merchant: string;
  address: string;
  total: number;
  vat: number;
  daysAgo: number;
  paidBy: string;
  invoice: string;
}

const RECEIPTS: Receipt[] = [
  { file: '1-carrefour-market.pdf', merchant: 'Carrefour Market', address: '12 Avenue Habib Bourguiba, Tunis', total: 47.85, vat: 0.19, daysAgo: 2, paidBy: 'VISA', invoice: 'INV-52101' },
  { file: '2-figma.pdf', merchant: 'Figma', address: 'Online subscription', total: 13.5, vat: 0.2, daysAgo: 3, paidBy: 'VISA', invoice: 'INV-52102' },
  { file: '3-amazon-eu.pdf', merchant: 'Amazon EU', address: 'Online order', total: 39.99, vat: 0.19, daysAgo: 4, paidBy: 'VISA', invoice: 'INV-52103' },
  { file: '4-uber.pdf', merchant: 'Uber', address: 'Trip receipt', total: 18.2, vat: 0.1, daysAgo: 5, paidBy: 'Mastercard', invoice: 'INV-52104' },
  { file: '5-le-petit-cafe-cash.pdf', merchant: 'Le Petit Cafe', address: '9 Rue Ibn Khaldoun', total: 14.3, vat: 0.1, daysAgo: 6, paidBy: 'Cash', invoice: 'INV-52105' },
];

function lines(r: Receipt): string[] {
  const d = readable(daysAgo(r.daysAgo));
  const subtotal = Math.round((r.total / (1 + r.vat)) * 100) / 100;
  const vat = Math.round((r.total - subtotal) * 100) / 100;
  return [
    r.merchant.toUpperCase(),
    r.address,
    '',
    `Invoice No: ${r.invoice}`,
    `Date: ${d}`,
    '',
    `Item                 €${subtotal.toFixed(2)}`,
    '',
    `Subtotal             €${subtotal.toFixed(2)}`,
    `VAT                  €${vat.toFixed(2)}`,
    `TOTAL                €${r.total.toFixed(2)}`,
    '',
    `Paid by ${r.paidBy}`,
    'Currency: EUR',
  ];
}

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, f), { force: true, recursive: true });

for (const r of RECEIPTS) fs.writeFileSync(path.join(outDir, r.file), makeReceiptPdf(lines(r)));
// The same file again under another name: Reclip should flag it as a duplicate.
fs.copyFileSync(path.join(outDir, '1-carrefour-market.pdf'), path.join(outDir, '6-carrefour-market-COPY.pdf'));

// What the bank shows. Note what differs from the receipts: the bank text is cryptic, the Amazon
// amount is 0.50 higher, and the Uber amount includes a tip.
const bank: Array<[Date, string, number]> = [
  [daysAgo(2), 'POS CARREFOUR MARKET TUNIS 2391', -47.85],
  [daysAgo(3), 'FIGMA MONTHLY SUBSCRIPTION', -13.5],
  [daysAgo(3), 'AMZN Mktp DE*2K4LM9XQ1', -40.49],
  [daysAgo(4), 'UBER *TRIP HELP.UBER.COM', -18.95],
  [daysAgo(5), 'ATM WITHDRAWAL TUNIS CENTRE', -200.0],
  [daysAgo(7), 'BANK FEE MONTHLY', -4.5],
  [daysAgo(8), 'SEPA CT CLIENT PAYMENT INV-2291', 1800.0],
];
const csv = ['Date,Description,Amount,Currency', ...bank.map(([d, text, amount]) => `${iso(d)},"${text}",${amount.toFixed(2)},EUR`)].join('\n');
fs.writeFileSync(path.join(outDir, 'bank-statement.csv'), csv + '\n');

console.log(`Wrote ${RECEIPTS.length + 1} receipts and bank-statement.csv to ${outDir}`);
console.log('Expected: 2 clean matches, 2 for review (Amazon, Uber), 1 receipt with no bank line (cash cafe),');
console.log('1 duplicate (the COPY file), and 3 bank lines with no receipt (ATM, bank fee, client payment).');

// ---- Tunisian set -------------------------------------------------------------------------------

const tnDir = path.join(outDir, 'tunisia');
fs.mkdirSync(tnDir, { recursive: true });

const dmy = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
const dt = (n: number) => n.toFixed(3).replace('.', ',');
const pad = (label: string, value: string) => label.padEnd(18) + value.padStart(11);

interface TnReceipt {
  file: string;
  name: string;
  address: string;
  daysAgo: number;
  invoice: string;
  total: number;
  ht?: number;
  tva?: number;
  stamp?: number;
  paid: string;
}

const TN_RECEIPTS: TnReceipt[] = [
  { file: '1-monoprix.pdf', name: 'MONOPRIX', address: 'Av. Habib Bourguiba, Tunis', daysAgo: 2, invoice: 'Ticket N° 4521', total: 47.85, ht: 40.21, tva: 7.64, paid: 'Payé par carte bancaire' },
  { file: '2-restaurant-dar-el-jeld.pdf', name: 'RESTAURANT DAR EL JELD', address: 'Rue Sidi Ben Arous, Tunis', daysAgo: 3, invoice: 'Facture N° 2026-0873', total: 48.85, ht: 40.21, tva: 7.64, stamp: 1, paid: 'Règlement : carte bancaire' },
  { file: '3-pharmacie-centrale.pdf', name: 'PHARMACIE CENTRALE', address: 'Avenue de Paris, Tunis', daysAgo: 4, invoice: 'Facture N° F-5521', total: 26.8, paid: 'Règlement : carte bancaire' },
  { file: '4-magasin-general.pdf', name: 'MAGASIN GENERAL', address: 'La Marsa, Tunis', daysAgo: 5, invoice: 'Facture N° M-8812', total: 54.6, ht: 45.882, tva: 8.718, paid: 'Payé par carte bancaire' },
  { file: '5-station-cash.pdf', name: 'STATION SERVICE LA MARSA', address: 'Route de La Marsa, Tunis', daysAgo: 6, invoice: 'Ticket N° 90412', total: 60, paid: 'Règlement : espèces' },
];

function tnLines(r: TnReceipt): string[] {
  const out = [r.name, r.address, '', r.invoice, `Date : ${dmy(daysAgo(r.daysAgo))}`, ''];
  if (r.ht != null) out.push(pad('Total HT', `${dt(r.ht)} DT`));
  if (r.tva != null) out.push(pad('TVA 19%', `${dt(r.tva)} DT`));
  if (r.stamp != null) out.push(pad('Timbre fiscal', `${dt(r.stamp)} DT`));
  out.push(pad('Total TTC', `${dt(r.total)} DT`), '', r.paid);
  return out;
}

for (const r of TN_RECEIPTS) fs.writeFileSync(path.join(tnDir, r.file), makeReceiptPdf(tnLines(r)));
fs.copyFileSync(path.join(tnDir, '1-monoprix.pdf'), path.join(tnDir, '6-monoprix-COPIE.pdf'));

// The bank text is cryptic, the magasin line is 0.500 higher than its receipt, and the statement
// has lines with no receipt.
const tnBank: Array<[Date, string, number | null, number | null, number]> = [
  [daysAgo(2), 'ACHAT CB MONOPRIX TUNIS 0871', 47.85, null, 1952.15],
  [daysAgo(3), 'PAIEMENT TPE DAR EL JELD', 48.85, null, 1903.3],
  [daysAgo(4), 'ACHAT CB PHARMACIE CENTRALE', 26.8, null, 1876.5],
  [daysAgo(5), 'ACHAT CB MAGASIN GENERAL MARSA', 55.1, null, 1821.4],
  [daysAgo(7), 'RETRAIT DAB TUNIS CENTRE', 200, null, 1621.4],
  [daysAgo(8), 'COMMISSION TENUE DE COMPTE', 4.5, null, 1616.9],
  [daysAgo(9), 'VIREMENT RECU CLIENT FACT 2291', null, 1800, 3416.9],
];
const spaced = (n: number) => dt(n).replace(/\B(?=(\d{3})+,)/g, ' ');
const tnCsv = [
  'Date opération;Date valeur;Libellé;Débit;Crédit;Solde',
  ...tnBank.map(([d, text, debit, credit, balance]) =>
    [dmy(d), dmy(d), text, debit == null ? '' : dt(debit), credit == null ? '' : dt(credit), spaced(balance)].join(';'),
  ),
].join('\n');
fs.writeFileSync(path.join(tnDir, 'releve-bancaire.csv'), tnCsv + '\n');

console.log(`\nTunisian set: ${TN_RECEIPTS.length + 1} receipts and releve-bancaire.csv in ${tnDir}`);
console.log('Import the statement with currency TND. Expected: 2 automatic matches (Monoprix, Pharmacie),');
console.log('2 for review (Dar El Jeld: name only 64% alike; Magasin General: 0,500 DT higher), 1 receipt with no bank line (cash station),');
console.log('1 duplicate (the COPIE file), and 3 bank lines with no receipt (retrait, commission, virement).');
