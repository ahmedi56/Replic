import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { receipts, transactions, matches, imports, bankAccounts, merchants, auditLogs } from '@/db/schema';
import { makeReceiptPdf } from './pdf';
import { validateUpload } from '../storage';
import { ingestReceipt } from '../services/receipts';
import { commitImport } from '../services/imports';
import { matchReceipts } from '../services/matching';
import { recordAudit } from '../audit';
import type { AuthContext } from '../auth/session';

/**
 * Demo dataset.
 *
 * Entirely fictional: invented merchants' local branches, invented invoice numbers, no
 * real account or card data anywhere. The receipts are generated as real PDFs and pushed
 * through the real upload → extract → match pipeline, so what a visitor sees is the
 * product actually working, not a screenshot of it.
 *
 * The data is shaped to show all four outcomes: clean auto-matches, a few that need
 * review, receipts with no transaction, transactions with no receipt, and a duplicate.
 */

interface DemoEntry {
  merchant: string;
  address: string;
  bankDescription: string;
  amount: number;
  currency: string;
  vatRate: number;
  daysAgo: number;
  /** Days the bank took to post. */
  postingDelay: number;
  paymentMethod: string;
  /** Outcome to demonstrate. */
  kind: 'auto' | 'review' | 'receipt_only' | 'transaction_only' | 'duplicate';
  /**
   * What the bank actually charged, when it differs from the receipt total — a tip added
   * at the terminal, an FX spread, a rounding difference. Leaving this unset means the
   * two sides agree exactly.
   */
  bankAmount?: number;
}

const CATALOG: DemoEntry[] = [
  { merchant: 'Carrefour Market', address: '12 Avenue Habib Bourguiba, Tunis', bankDescription: 'POS CARREFOUR MARKET TUNIS 2391', amount: 47.85, currency: 'EUR', vatRate: 0.19, daysAgo: 1, postingDelay: 0, paymentMethod: 'VISA', kind: 'auto' },
  { merchant: 'Amazon EU', address: 'Online order', bankDescription: 'AMZN Mktp DE*2K4LM9XQ1', amount: 39.99, bankAmount: 40.49, currency: 'EUR', vatRate: 0.19, daysAgo: 2, postingDelay: 1, paymentMethod: 'VISA', kind: 'review' },
  { merchant: 'Uber', address: 'Trip receipt', bankDescription: 'UBER *TRIP HELP.UBER.COM', amount: 18.2, bankAmount: 18.95, currency: 'EUR', vatRate: 0.1, daysAgo: 3, postingDelay: 1, paymentMethod: 'Mastercard', kind: 'review' },
  { merchant: 'Monoprix', address: '4 Rue de Marseille, Tunis', bankDescription: 'POS MONOPRIX 0871', amount: 62.4, currency: 'EUR', vatRate: 0.19, daysAgo: 4, postingDelay: 0, paymentMethod: 'VISA', kind: 'auto' },
  { merchant: 'Figma', address: 'Online subscription', bankDescription: 'FIGMA MONTHLY SUBSCRIPTION', amount: 13.5, currency: 'EUR', vatRate: 0.2, daysAgo: 5, postingDelay: 0, paymentMethod: 'VISA', kind: 'auto' },
  { merchant: 'Starbucks', address: 'Lac 2, Tunis', bankDescription: 'SBUX STORE 1123', amount: 8.75, bankAmount: 9.05, currency: 'EUR', vatRate: 0.1, daysAgo: 6, postingDelay: 1, paymentMethod: 'Mastercard', kind: 'review' },
  { merchant: 'Shell', address: 'Route de Gabes', bankDescription: 'SHELL SERVICE STATION 4417', amount: 72.0, currency: 'EUR', vatRate: 0.19, daysAgo: 7, postingDelay: 0, paymentMethod: 'VISA', kind: 'auto' },
  { merchant: 'Notion Labs', address: 'Online subscription', bankDescription: 'NOTION LABS INC', amount: 9.6, currency: 'EUR', vatRate: 0.2, daysAgo: 8, postingDelay: 2, paymentMethod: 'VISA', kind: 'auto' },
  { merchant: 'Decathlon', address: 'Centre Urbain Nord', bankDescription: 'POS DECATHLON TUNIS', amount: 129.9, currency: 'EUR', vatRate: 0.19, daysAgo: 9, postingDelay: 1, paymentMethod: 'VISA', kind: 'auto' },
  { merchant: 'Adobe', address: 'Online subscription', bankDescription: 'ADOBE CREATIVE CLOUD', amount: 59.99, currency: 'EUR', vatRate: 0.2, daysAgo: 10, postingDelay: 0, paymentMethod: 'Mastercard', kind: 'auto' },
  { merchant: 'Le Petit Cafe', address: '9 Rue Ibn Khaldoun', bankDescription: 'POS LE PETIT CAFE', amount: 14.3, currency: 'EUR', vatRate: 0.1, daysAgo: 11, postingDelay: 0, paymentMethod: 'Cash', kind: 'receipt_only' },
  { merchant: 'Ikea', address: 'Tunis City', bankDescription: 'IKEA TUNIS', amount: 245.0, currency: 'EUR', vatRate: 0.19, daysAgo: 12, postingDelay: 2, paymentMethod: 'VISA', kind: 'auto' },
  { merchant: 'GitHub', address: 'Online subscription', bankDescription: 'GITHUB INC', amount: 21.0, currency: 'USD', vatRate: 0, daysAgo: 13, postingDelay: 4, paymentMethod: 'VISA', kind: 'review' },
  { merchant: 'Ooredoo', address: 'Mobile services', bankDescription: 'SEPA DD OOREDOO TELECOM', amount: 35.0, currency: 'EUR', vatRate: 0.19, daysAgo: 14, postingDelay: 0, paymentMethod: 'Bank transfer', kind: 'auto' },
  { merchant: 'Fnac', address: 'Avenue de la Liberte', bankDescription: 'POS FNAC 2210', amount: 88.5, currency: 'EUR', vatRate: 0.19, daysAgo: 15, postingDelay: 1, paymentMethod: 'VISA', kind: 'auto' },
  { merchant: 'Bolt', address: 'Ride receipt', bankDescription: 'BOLT.EU/O/2609', amount: 11.4, bankAmount: 11.85, currency: 'EUR', vatRate: 0.1, daysAgo: 16, postingDelay: 1, paymentMethod: 'Mastercard', kind: 'review' },
  { merchant: 'Cloudflare', address: 'Online subscription', bankDescription: 'CLOUDFLARE INC', amount: 20.0, currency: 'USD', vatRate: 0, daysAgo: 17, postingDelay: 0, paymentMethod: 'VISA', kind: 'auto' },
  { merchant: 'La Rose Blanche', address: 'Marsa, Tunis', bankDescription: 'POS LA ROSE BLANCHE', amount: 54.6, currency: 'EUR', vatRate: 0.19, daysAgo: 18, postingDelay: 0, paymentMethod: 'VISA', kind: 'auto' },
  { merchant: 'Carrefour Market', address: '12 Avenue Habib Bourguiba, Tunis', bankDescription: 'POS CARREFOUR MARKET TUNIS 2391', amount: 47.85, currency: 'EUR', vatRate: 0.19, daysAgo: 1, postingDelay: 0, paymentMethod: 'VISA', kind: 'duplicate' },
  { merchant: 'Zara', address: 'Tunis City Mall', bankDescription: 'POS ZARA TUNIS', amount: 79.9, currency: 'EUR', vatRate: 0.19, daysAgo: 19, postingDelay: 1, paymentMethod: 'VISA', kind: 'auto' },
  { merchant: 'Google Cloud', address: 'Online subscription', bankDescription: 'GOOGLE *CLOUD EMEA', amount: 42.17, bankAmount: 43.02, currency: 'EUR', vatRate: 0.2, daysAgo: 20, postingDelay: 2, paymentMethod: 'VISA', kind: 'review' },
  { merchant: 'Pharmacie Centrale', address: 'Avenue de Paris', bankDescription: 'POS PHARMACIE CENTRALE', amount: 26.8, currency: 'EUR', vatRate: 0.07, daysAgo: 21, postingDelay: 0, paymentMethod: 'Cash', kind: 'receipt_only' },
  { merchant: 'Tunisair', address: 'Flight booking', bankDescription: 'TUNISAIR TICKET 0642211', amount: 310.0, currency: 'EUR', vatRate: 0, daysAgo: 22, postingDelay: 1, paymentMethod: 'VISA', kind: 'auto' },
  { merchant: 'Slack', address: 'Online subscription', bankDescription: 'SLACK TECHNOLOGIES', amount: 6.75, currency: 'USD', vatRate: 0, daysAgo: 23, postingDelay: 0, paymentMethod: 'VISA', kind: 'auto' },
  { merchant: 'Boulangerie du Coin', address: '2 Rue de Rome', bankDescription: 'POS BOULANGERIE DU COIN', amount: 4.2, currency: 'EUR', vatRate: 0.07, daysAgo: 24, postingDelay: 0, paymentMethod: 'Cash', kind: 'auto' },
  { merchant: 'Vercel', address: 'Online subscription', bankDescription: 'VERCEL INC', amount: 18.0, currency: 'USD', vatRate: 0, daysAgo: 25, postingDelay: 1, paymentMethod: 'VISA', kind: 'auto' },
];

/** Bank lines with no receipt — the other half of the reconciliation problem. */
const ORPHAN_TRANSACTIONS = [
  { description: 'SEPA DD ASSURANCE HABITATION', amount: -48.0, daysAgo: 3 },
  { description: 'ATM WITHDRAWAL TUNIS CENTRE', amount: -200.0, daysAgo: 6 },
  { description: 'POS TAXI 44219', amount: -12.5, daysAgo: 9 },
  { description: 'BANK FEE MONTHLY', amount: -4.5, daysAgo: 12 },
  { description: 'SEPA CT CLIENT PAYMENT INV-2291', amount: 1800.0, daysAgo: 15 },
  { description: 'POS KIOSQUE PRESSE', amount: -3.2, daysAgo: 18 },
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatDmy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Demo receipts print an unambiguous date ("12 Sep 2026").
 *
 * A numeric "12/09/2026" is genuinely ambiguous, and the parser resolves it using
 * currency as a locale hint — correct behaviour, but it would make the USD demo receipts
 * read as December and quietly fail to match. Demo data should exercise the pipeline,
 * not a known ambiguity.
 */
function formatReadableDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTH_ABBR[Number(m) - 1]} ${y}`;
}

function buildReceiptLines(entry: DemoEntry, index: number): string[] {
  const iso = isoDaysAgo(entry.daysAgo);
  const subtotal = Math.round((entry.amount / (1 + entry.vatRate)) * 100) / 100;
  const vat = Math.round((entry.amount - subtotal) * 100) / 100;
  const symbol = entry.currency === 'USD' ? '$' : '€';

  const lines = [
    entry.merchant.toUpperCase(),
    entry.address,
    '',
    `Invoice No: INV-${48000 + index}`,
    `Date: ${formatReadableDate(iso)}`,
    '',
    `Item                 ${symbol}${subtotal.toFixed(2)}`,
    '',
    `Subtotal             ${symbol}${subtotal.toFixed(2)}`,
  ];
  if (vat > 0) lines.push(`VAT                  ${symbol}${vat.toFixed(2)}`);
  lines.push(`TOTAL                ${symbol}${entry.amount.toFixed(2)}`, '', `Paid by ${entry.paymentMethod}`, `Currency: ${entry.currency}`);
  return lines;
}

export async function loadDemoData(auth: AuthContext): Promise<{ receipts: number; transactions: number; matched: number }> {
  await clearDemoData(auth);

  // --- Bank statement ---------------------------------------------------------
  const csvLines = ['Booking Date,Description,Debit,Credit,Currency'];
  for (const entry of CATALOG) {
    if (entry.kind === 'receipt_only' || entry.kind === 'duplicate') continue;
    const iso = isoDaysAgo(entry.daysAgo - entry.postingDelay);
    const charged = entry.bankAmount ?? entry.amount;
    csvLines.push(`${formatDmy(iso)},"${entry.bankDescription}",${charged.toFixed(2)},,${entry.currency}`);
  }
  for (const orphan of ORPHAN_TRANSACTIONS) {
    const iso = isoDaysAgo(orphan.daysAgo);
    const debit = orphan.amount < 0 ? Math.abs(orphan.amount).toFixed(2) : '';
    const credit = orphan.amount > 0 ? orphan.amount.toFixed(2) : '';
    csvLines.push(`${formatDmy(iso)},"${orphan.description}",${debit},${credit},EUR`);
  }
  const csv = csvLines.join('\n');

  await commitImport(auth, {
    filename: 'demo-statement.csv',
    content: csv,
    mapping: {
      'Booking Date': 'date',
      Description: 'description',
      Debit: 'debit',
      Credit: 'credit',
      Currency: 'currency',
    },
    bankAccountName: 'Demo current account',
    defaultCurrency: 'EUR',
    dateOrder: 'dmy',
    force: true,
  });

  // --- Receipts, through the real upload pipeline ------------------------------
  let receiptCount = 0;
  for (const [index, entry] of CATALOG.entries()) {
    const pdf = makeReceiptPdf(buildReceiptLines(entry, index));
    const safeName = entry.merchant.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const file = validateUpload(pdf, `${safeName}-${isoDaysAgo(entry.daysAgo)}.pdf`, 'application/pdf');
    await ingestReceipt(auth, file);
    receiptCount++;
  }

  // A final sweep, in case an early receipt was ingested before its transaction existed.
  await matchReceipts(auth);
  // Report what actually settled, not what this last (usually no-op) sweep changed.
  const settled = await db
    .select({ count: sql<number>`count(*)` })
    .from(matches)
    .where(and(eq(matches.organizationId, auth.organizationId), inArray(matches.status, ['auto', 'confirmed'])));

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    actorLabel: auth.name ?? auth.email,
    action: 'demo.loaded',
    entityType: 'organization',
    entityId: auth.organizationId,
    detail: `${receiptCount} demo receipts and ${csvLines.length - 1} demo transactions`,
  });

  return { receipts: receiptCount, transactions: csvLines.length - 1, matched: Number(settled[0]?.count ?? 0) };
}

/** Wipe everything in the caller's organization. Used by "reset demo" and by tests. */
export async function clearDemoData(auth: AuthContext): Promise<void> {
  const org = auth.organizationId;
  await db.delete(matches).where(eq(matches.organizationId, org));
  await db.delete(transactions).where(eq(transactions.organizationId, org));
  await db.delete(receipts).where(eq(receipts.organizationId, org));
  await db.delete(imports).where(eq(imports.organizationId, org));
  await db.delete(bankAccounts).where(eq(bankAccounts.organizationId, org));
  await db.delete(merchants).where(eq(merchants.organizationId, org));
  await db.delete(auditLogs).where(eq(auditLogs.organizationId, org));
}
