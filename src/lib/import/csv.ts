/**
 * Bank CSV import.
 *
 * No two banks agree on anything: the date column is called "Booking Date" or "Value Date"
 * or "Transaction Date"; the amount is one signed column, or a Debit column and a Credit
 * column, or an amount plus a separate "D/C" indicator. Numbers use either decimal
 * convention. Dates use any order.
 *
 * So: guess a mapping, show the user what was guessed, and let them correct it before
 * anything is written. `detectMapping` produces the guess; `parseRows` applies whatever
 * mapping the user confirmed.
 */
import Papa from 'papaparse';
import crypto from 'node:crypto';
import { parseAmount } from '../extraction/parse-text';
import { normalizeDescription, normalizeMerchant, inferPaymentMethod, extractReference } from '../matching/normalize';

export type TargetField = 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'currency' | 'reference' | 'ignore';

export interface ColumnMapping {
  [csvColumn: string]: TargetField;
}

export interface ParsedTransactionRow {
  rowNumber: number;
  date: Date;
  descriptionRaw: string;
  descriptionNorm: string;
  merchantNorm: string;
  amount: number;
  currency: string;
  reference: string | null;
  paymentMethod: string | null;
  fingerprint: string;
}

export interface ParseIssue {
  rowNumber: number;
  reason: string;
}

export interface CsvPreview {
  headers: string[];
  sampleRows: string[][];
  suggestedMapping: ColumnMapping;
  totalRows: number;
  /** Dates were ambiguous (e.g. 01/02/2026); the UI asks the user which order to use. */
  dateOrderAmbiguous: boolean;
}

/** Header aliases, lower-cased and punctuation-stripped. */
const HEADER_ALIASES: Record<Exclude<TargetField, 'ignore'>, string[]> = {
  date: [
    'date', 'transaction date', 'booking date', 'value date', 'posted date', 'post date',
    'datum', 'buchungstag', 'wertstellung', 'date operation', "date d'operation", 'date de valeur',
    'fecha', 'data', 'completed date', 'started date', 'trans date', 'txn date', 'entry date',
  ],
  description: [
    'description', 'details', 'narrative', 'memo', 'reference', 'payee', 'merchant', 'name',
    'transaction description', 'transaction details', 'particulars', 'text', 'verwendungszweck',
    'buchungstext', 'libelle', 'concepto', 'descrizione', 'beneficiary', 'counterparty', 'remitter',
  ],
  amount: ['amount', 'value', 'betrag', 'montant', 'importe', 'importo', 'transaction amount', 'amount (eur)', 'net amount', 'sum'],
  debit: ['debit', 'withdrawal', 'paid out', 'money out', 'soll', 'debito', 'debit amount', 'outflow'],
  credit: ['credit', 'deposit', 'paid in', 'money in', 'haben', 'credito', 'credit amount', 'inflow'],
  currency: ['currency', 'ccy', 'waehrung', 'wahrung', 'devise', 'moneda', 'valuta', 'currency code'],
  reference: ['reference', 'ref', 'transaction id', 'transaction reference', 'mandate reference', 'cheque number', 'check number'],
};

function canonical(header: string): string {
  return header
    .replace(/^﻿/, '')
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreHeader(header: string, field: Exclude<TargetField, 'ignore'>): number {
  const c = canonical(header);
  const aliases = HEADER_ALIASES[field];
  if (aliases.includes(c)) return 100;
  let best = 0;
  for (const alias of aliases) {
    if (c === alias) return 100;
    if (c.startsWith(alias) || c.endsWith(alias)) best = Math.max(best, 80);
    else if (c.includes(alias)) best = Math.max(best, 65);
    else if (alias.includes(c) && c.length >= 3) best = Math.max(best, 55);
  }
  return best;
}

/** Guess a mapping, assigning each target field to at most one column. */
export function detectMapping(headers: string[], sampleRows: string[][] = []): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const h of headers) mapping[h] = 'ignore';

  const fields: Array<Exclude<TargetField, 'ignore'>> = ['date', 'amount', 'debit', 'credit', 'description', 'currency', 'reference'];
  const taken = new Set<string>();

  for (const field of fields) {
    let bestHeader: string | null = null;
    let bestScore = 50; // below this, don't guess
    for (const h of headers) {
      if (taken.has(h)) continue;
      const s = scoreHeader(h, field);
      if (s > bestScore) {
        bestScore = s;
        bestHeader = h;
      }
    }
    if (bestHeader) {
      mapping[bestHeader] = field;
      taken.add(bestHeader);
    }
  }

  // A single signed "amount" column makes debit/credit redundant, and vice versa.
  const hasAmount = Object.values(mapping).includes('amount');
  const hasDebit = Object.values(mapping).includes('debit');
  const hasCredit = Object.values(mapping).includes('credit');
  if (hasAmount && (hasDebit || hasCredit)) {
    // Keep whichever actually carries values in the sample.
    const amountCol = Object.keys(mapping).find((k) => mapping[k] === 'amount')!;
    const idx = headers.indexOf(amountCol);
    const amountFilled = sampleRows.filter((r) => (r[idx] ?? '').trim()).length;
    if (amountFilled === 0) mapping[amountCol] = 'ignore';
    else {
      for (const k of Object.keys(mapping)) if (mapping[k] === 'debit' || mapping[k] === 'credit') mapping[k] = 'ignore';
    }
  }

  // Last resort for description: the widest free-text column.
  if (!Object.values(mapping).includes('description') && sampleRows.length) {
    let bestHeader: string | null = null;
    let bestLen = 0;
    headers.forEach((h, i) => {
      if (mapping[h] !== 'ignore') return;
      const avg = sampleRows.reduce((s, r) => s + (r[i]?.length ?? 0), 0) / sampleRows.length;
      const looksTextual = sampleRows.some((r) => /[a-zA-Z]{3}/.test(r[i] ?? ''));
      if (looksTextual && avg > bestLen) {
        bestLen = avg;
        bestHeader = h;
      }
    });
    if (bestHeader) mapping[bestHeader] = 'description';
  }

  return mapping;
}

export type DateOrder = 'auto' | 'dmy' | 'mdy';

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function parseCsvDate(raw: string, order: DateOrder = 'auto'): Date | null {
  const s = raw.trim();
  if (!s) return null;

  // ISO, with or without a time part.
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return utc(+iso[1], +iso[2], +iso[3]);

  // "28 Sep 2026" / "Sep 28 2026"
  const named = s.toLowerCase().match(/^(\d{1,2})[\s-]+([a-z]{3})[a-z]*[\s-]+(\d{2,4})/);
  if (named && MONTH_NAMES[named[2]]) return utc(fullYear(+named[3]), MONTH_NAMES[named[2]], +named[1]);
  const named2 = s.toLowerCase().match(/^([a-z]{3})[a-z]*[\s-]+(\d{1,2}),?[\s-]+(\d{2,4})/);
  if (named2 && MONTH_NAMES[named2[1]]) return utc(fullYear(+named2[3]), MONTH_NAMES[named2[1]], +named2[2]);

  // Numeric with any separator.
  const numeric = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (numeric) {
    const a = +numeric[1];
    const b = +numeric[2];
    const year = fullYear(+numeric[3]);
    if (a > 12) return utc(year, b, a);
    if (b > 12) return utc(year, a, b);
    return order === 'mdy' ? utc(year, a, b) : utc(year, b, a);
  }

  // yyyymmdd
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return utc(+compact[1], +compact[2], +compact[3]);

  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function fullYear(y: number): number {
  return y >= 1000 ? y : y >= 70 ? 1900 + y : 2000 + y;
}

function utc(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d : null;
}

/** True when at least one numeric date could be read either way round. */
export function detectDateAmbiguity(values: string[]): boolean {
  let sawAmbiguous = false;
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (!m) continue;
    if (+m[1] > 12 || +m[2] > 12) return false; // one sample settles it for the file
    sawAmbiguous = true;
  }
  return sawAmbiguous;
}

export function checksum(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function fingerprint(orgScopedParts: string[]): string {
  return crypto.createHash('sha256').update(orgScopedParts.join('|')).digest('hex');
}

export function previewCsv(content: string): CsvPreview {
  const parsed = Papa.parse<string[]>(content.trim(), { skipEmptyLines: 'greedy' });
  const rows = (parsed.data as string[][]).filter((r) => r.some((c) => (c ?? '').trim()));
  if (!rows.length) return { headers: [], sampleRows: [], suggestedMapping: {}, totalRows: 0, dateOrderAmbiguous: false };

  const headers = rows[0].map((h, i) => (h ?? '').trim() || `Column ${i + 1}`);
  const body = rows.slice(1);
  const sampleRows = body.slice(0, 5);
  const suggestedMapping = detectMapping(headers, body.slice(0, 25));

  const dateCol = Object.keys(suggestedMapping).find((k) => suggestedMapping[k] === 'date');
  const dateIdx = dateCol ? headers.indexOf(dateCol) : -1;
  const dateOrderAmbiguous = dateIdx >= 0 ? detectDateAmbiguity(body.slice(0, 50).map((r) => r[dateIdx] ?? '')) : false;

  return { headers, sampleRows, suggestedMapping, totalRows: body.length, dateOrderAmbiguous };
}

export interface ParseOptions {
  mapping: ColumnMapping;
  defaultCurrency?: string;
  dateOrder?: DateOrder;
  bankAccountId?: string | null;
  /** Bank convention: some export expenses as positive numbers in a single column. */
  invertAmounts?: boolean;
}

export function parseRows(content: string, options: ParseOptions): { rows: ParsedTransactionRow[]; issues: ParseIssue[] } {
  const parsed = Papa.parse<string[]>(content.trim(), { skipEmptyLines: 'greedy' });
  const all = (parsed.data as string[][]).filter((r) => r.some((c) => (c ?? '').trim()));
  if (all.length < 2) return { rows: [], issues: [{ rowNumber: 0, reason: 'File contains no data rows' }] };

  const headers = all[0].map((h, i) => (h ?? '').trim() || `Column ${i + 1}`);
  const body = all.slice(1);
  const issues: ParseIssue[] = [];
  const rows: ParsedTransactionRow[] = [];

  const indexOf = (field: TargetField): number => {
    const col = Object.keys(options.mapping).find((k) => options.mapping[k] === field);
    return col ? headers.indexOf(col) : -1;
  };

  const iDate = indexOf('date');
  const iDesc = indexOf('description');
  const iAmount = indexOf('amount');
  const iDebit = indexOf('debit');
  const iCredit = indexOf('credit');
  const iCurrency = indexOf('currency');
  const iReference = indexOf('reference');

  if (iDate === -1) issues.push({ rowNumber: 0, reason: 'No column mapped to Date' });
  if (iAmount === -1 && iDebit === -1 && iCredit === -1) {
    issues.push({ rowNumber: 0, reason: 'No column mapped to Amount (or Debit/Credit)' });
  }
  if (issues.length) return { rows: [], issues };

  const defaultCurrency = (options.defaultCurrency ?? 'EUR').toUpperCase();
  const seen = new Set<string>();

  body.forEach((raw, i) => {
    const rowNumber = i + 2; // 1-based, and row 1 is the header
    const cell = (idx: number) => (idx >= 0 ? (raw[idx] ?? '').trim() : '');

    const date = parseCsvDate(cell(iDate), options.dateOrder ?? 'auto');
    if (!date) {
      issues.push({ rowNumber, reason: `Unreadable date: "${cell(iDate)}"` });
      return;
    }

    let amount: number | null = null;
    if (iAmount >= 0 && cell(iAmount)) {
      amount = parseAmount(cell(iAmount));
      // A bare "1.234" in a European file is a thousands separator, not a decimal.
      if (amount != null && options.invertAmounts) amount = -amount;
    } else {
      const debit = iDebit >= 0 ? parseAmount(cell(iDebit)) : null;
      const credit = iCredit >= 0 ? parseAmount(cell(iCredit)) : null;
      if (debit != null && debit !== 0) amount = -Math.abs(debit);
      else if (credit != null && credit !== 0) amount = Math.abs(credit);
    }

    if (amount == null || !Number.isFinite(amount)) {
      issues.push({ rowNumber, reason: 'Unreadable amount' });
      return;
    }
    if (amount === 0) {
      issues.push({ rowNumber, reason: 'Zero-amount row skipped' });
      return;
    }

    const descriptionRaw = cell(iDesc) || '(no description)';
    const currency = (cell(iCurrency) || defaultCurrency).toUpperCase().slice(0, 3);
    const reference = cell(iReference) || extractReference(descriptionRaw);

    const fp = fingerprint([
      date.toISOString().slice(0, 10),
      amount.toFixed(2),
      descriptionRaw.toLowerCase(),
      options.bankAccountId ?? 'none',
    ]);

    // Identical rows inside one file are legitimate (two identical coffees), but an exact
    // repeat of date+amount+description+position is far more likely a duplicated export.
    if (seen.has(fp)) {
      issues.push({ rowNumber, reason: 'Duplicate of an earlier row in this file' });
      return;
    }
    seen.add(fp);

    rows.push({
      rowNumber,
      date,
      descriptionRaw,
      descriptionNorm: normalizeDescription(descriptionRaw),
      merchantNorm: normalizeMerchant(descriptionRaw),
      amount,
      currency,
      reference,
      paymentMethod: inferPaymentMethod(descriptionRaw),
      fingerprint: fp,
    });
  });

  return { rows, issues };
}
