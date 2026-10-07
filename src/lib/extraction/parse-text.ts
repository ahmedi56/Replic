/**
 * Heuristic receipt parser.
 *
 * This runs on whatever text we have — a PDF text layer, OCR output, or a plain-text
 * receipt — and pulls structured fields out of it. It has to cope with real-world mess:
 * several languages, several date orders, VAT labelled five different ways, totals that
 * appear three times on the page.
 *
 * Every field comes back with a confidence, derived from *how* it was found: an explicitly
 * labelled "TOTAL TTC" line scores higher than the largest number on the page.
 */
import type { ExtractedFields, ExtractedLineItem, FieldConfidence } from '../ai/types';

export interface ParseResult {
  fields: ExtractedFields;
  confidence: FieldConfidence;
  overallConfidence: number;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  '€': 'EUR',
  $: 'USD',
  '£': 'GBP',
  '¥': 'JPY',
  '₺': 'TRY',
  '₹': 'INR',
  'د.ت': 'TND',
};

const CURRENCY_CODES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'TND', 'MAD', 'CAD', 'AUD', 'JPY', 'INR', 'TRY', 'NGN', 'ZAR'];

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, janvier: 1, januar: 1, enero: 1, gennaio: 1,
  feb: 2, february: 2, fevrier: 2, februar: 2, febrero: 2, febbraio: 2,
  mar: 3, march: 3, mars: 3, marz: 3, marzo: 3,
  apr: 4, april: 4, avril: 4, abril: 4, aprile: 4,
  may: 5, mai: 5, mayo: 5, maggio: 5, maj: 5,
  jun: 6, june: 6, juin: 6, juni: 6, junio: 6, giugno: 6,
  jul: 7, july: 7, juillet: 7, juli: 7, julio: 7, luglio: 7,
  aug: 8, august: 8, aout: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, septembre: 9, septiembre: 9, settembre: 9,
  oct: 10, october: 10, octobre: 10, oktober: 10, octubre: 10, ottobre: 10,
  nov: 11, november: 11, novembre: 11, noviembre: 11,
  dec: 12, december: 12, decembre: 12, dezember: 12, diciembre: 12, dicembre: 12,
};

const TOTAL_LABELS = [
  'total ttc', 'grand total', 'total amount', 'amount due', 'amount paid', 'balance due',
  'total due', 'montant total', 'total a payer', 'gesamtbetrag', 'gesamt', 'summe',
  'importe total', 'totale', 'total', 'montant', 'to pay', 'paid',
];
const SUBTOTAL_LABELS = ['subtotal', 'sub total', 'sous-total', 'sous total', 'total ht', 'net amount', 'nettobetrag', 'zwischensumme', 'imponibile', 'base imponible'];
const TAX_LABELS = ['vat', 'tva', 'mwst', 'ust', 'iva', 'sales tax', 'tax', 'taxe', 'impuesto', 'btw'];

/** Strip accents so label matching works across languages. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Parse a number written in either decimal convention.
 * "1.234,56" (EU) and "1,234.56" (US/UK) both mean 1234.56.
 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,-]/g, '').trim();
  if (!cleaned || !/\d/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized: string;

  if (lastComma === -1 && lastDot === -1) {
    normalized = cleaned;
  } else if (lastComma > lastDot) {
    // Comma is the decimal separator.
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    normalized = cleaned.replace(/,/g, '');
  } else {
    normalized = cleaned;
  }

  // A lone separator with exactly 3 trailing digits is a thousands separator, not a decimal.
  const sepMatch = normalized.match(/^-?\d+\.(\d+)$/);
  if (sepMatch && sepMatch[1].length === 3 && !cleaned.includes(',')) {
    const isThousands = /^-?\d{1,3}\.\d{3}$/.test(normalized);
    if (isThousands) normalized = normalized.replace('.', '');
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

interface DateGuess {
  iso: string;
  confidence: number;
}

/** Find a date anywhere in the text, trying the unambiguous formats first. */
export function parseDate(text: string, currencyHint?: string | null): DateGuess | null {
  const folded = fold(text);

  // ISO — unambiguous.
  const iso = folded.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const g = buildDate(+iso[1], +iso[2], +iso[3]);
    if (g) return { iso: g, confidence: 0.99 };
  }

  // "28 Sep 2026" / "28 septembre 2026"
  const dMonY = folded.match(/\b(\d{1,2})[\s.-]+([a-z]{3,12})\.?[\s.,-]+(\d{2,4})\b/);
  if (dMonY && MONTHS[dMonY[2]]) {
    const g = buildDate(normalizeYear(+dMonY[3]), MONTHS[dMonY[2]], +dMonY[1]);
    if (g) return { iso: g, confidence: 0.97 };
  }

  // "Sep 28, 2026"
  const monDY = folded.match(/\b([a-z]{3,12})\.?\s+(\d{1,2})(?:st|nd|rd|th)?[\s,]+(\d{2,4})\b/);
  if (monDY && MONTHS[monDY[1]]) {
    const g = buildDate(normalizeYear(+monDY[3]), MONTHS[monDY[1]], +monDY[2]);
    if (g) return { iso: g, confidence: 0.97 };
  }

  // Numeric: 28/09/2026, 09.28.26, 28-09-2026
  const numeric = folded.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
  if (numeric) {
    const a = +numeric[1];
    const b = +numeric[2];
    const year = normalizeYear(+numeric[3]);
    let day: number;
    let month: number;
    let confidence: number;

    if (a > 12 && b <= 12) {
      day = a; month = b; confidence = 0.96;
    } else if (b > 12 && a <= 12) {
      month = a; day = b; confidence = 0.96;
    } else {
      // Genuinely ambiguous. Currency is the best hint we have about locale.
      const usStyle = currencyHint === 'USD';
      day = usStyle ? b : a;
      month = usStyle ? a : b;
      confidence = 0.72; // flagged for review
    }
    const g = buildDate(year, month, day);
    if (g) return { iso: g, confidence };
  }

  return null;
}

function normalizeYear(y: number): number {
  if (y >= 1000) return y;
  return y >= 70 ? 1900 + y : 2000 + y;
}

function buildDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

function detectCurrency(text: string): { code: string; confidence: number } | null {
  for (const code of CURRENCY_CODES) {
    if (new RegExp(`\\b${code}\\b`, 'i').test(text)) return { code, confidence: 0.96 };
  }
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(symbol)) return { code, confidence: 0.9 };
  }
  return null;
}

/** All numbers on a line that look like money. */
function amountsOnLine(line: string): number[] {
  const matches = line.match(/-?[\d][\d.,\s]*\d|\d/g) ?? [];
  return matches
    .map((m) => parseAmount(m))
    .filter((n): n is number => n != null && Math.abs(n) < 10_000_000);
}

function findLabelled(lines: string[], labels: string[]): { value: number; line: string; exact: boolean } | null {
  // Longest labels first so "total ttc" wins over "total".
  const ordered = [...labels].sort((a, b) => b.length - a.length);
  let fallback: { value: number; line: string; exact: boolean } | null = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    const folded = fold(lines[i]);
    for (const label of ordered) {
      if (!folded.includes(label)) continue;
      // Ignore lines where the label is part of a longer word.
      const nums = amountsOnLine(lines[i]);
      if (nums.length === 0) {
        // Value may sit on the next line (common in two-column layouts).
        const next = lines[i + 1] ? amountsOnLine(lines[i + 1]) : [];
        if (next.length) {
          const cand = { value: next[next.length - 1], line: lines[i], exact: false };
          if (!fallback) fallback = cand;
        }
        continue;
      }
      const value = nums[nums.length - 1];
      const startsWithLabel = folded.trimStart().startsWith(label);
      return { value, line: lines[i].trim(), exact: startsWithLabel };
    }
  }
  return fallback;
}

/** The merchant is usually the first real line: not an address, phone, date or number. */
function findMerchant(lines: string[]): { name: string; confidence: number } | null {
  const skip = /^(receipt|invoice|facture|rechnung|ticket|bill|tax invoice|vat invoice|customer copy|merchant copy)\b/i;
  for (const rawLine of lines.slice(0, 8)) {
    const line = rawLine.trim();
    if (line.length < 2 || line.length > 60) continue;
    if (skip.test(line)) continue;
    if (/^\+?[\d\s()./-]{6,}$/.test(line)) continue; // phone or number run
    if (/\b(street|str\.|road|rue|avenue|ave|blvd|zone|tel|phone|fax|www\.|@|http)\b/i.test(line)) continue;
    if (/^\d/.test(line) && /\d{4}/.test(line)) continue; // postcode-led address
    const letters = line.replace(/[^a-zA-Z]/g, '').length;
    if (letters < 2) continue;

    // ALL-CAPS short lines at the top are very often the trading name.
    const isShouty = line === line.toUpperCase() && letters >= 3;
    return { name: line.replace(/\s{2,}/g, ' '), confidence: isShouty ? 0.93 : 0.82 };
  }
  return null;
}

function findInvoiceNumber(text: string): { value: string; confidence: number } | null {
  // The separator run is spelled out rather than using a character class: a class
  // containing "n" (for "N°") also matches the "n" inside "Invoice", which lets the
  // engine backtrack into the middle of the label word and capture nonsense.
  const labelled = text.match(
    /\b(?:invoice|inv|facture|rechnung|receipt|ticket|bill|order|ref)\b(?:\s|[.#:_-]|n[o°]\.?|nr\.?|no\.?|number)*([a-z0-9][a-z0-9\/-]{2,24})\b/i,
  );
  // An invoice number essentially always contains a digit; a bare word is a false positive.
  if (labelled && /\d/.test(labelled[1])) return { value: labelled[1].toUpperCase(), confidence: 0.88 };

  const bare = text.match(/\b(INV[-\/]?[0-9]{3,12})\b/i);
  if (bare) return { value: bare[1].toUpperCase(), confidence: 0.75 };
  return null;
}

function findPaymentMethod(text: string): { value: string; confidence: number } | null {
  const s = fold(text);
  if (/\b(visa|mastercard|maestro|amex|american express|credit card|debit card|carte bancaire|cb|card)\b/.test(s)) {
    return { value: 'card', confidence: 0.9 };
  }
  if (/\b(cash|especes|espece|bar|contanti|efectivo)\b/.test(s)) return { value: 'cash', confidence: 0.88 };
  if (/\b(bank transfer|virement|uberweisung|transfer|sepa)\b/.test(s)) return { value: 'transfer', confidence: 0.85 };
  if (/\b(paypal|apple pay|google pay)\b/.test(s)) return { value: 'card', confidence: 0.8 };
  return null;
}

function findItems(lines: string[]): ExtractedLineItem[] {
  const items: ExtractedLineItem[] = [];
  const labelLine = new RegExp(`\\b(${[...TOTAL_LABELS, ...SUBTOTAL_LABELS, ...TAX_LABELS].join('|')})\\b`, 'i');

  for (const line of lines) {
    if (labelLine.test(fold(line))) continue;
    // "2 x Coffee     9.00" or "Coffee  2  4.50  9.00"
    const m = line.match(/^\s*(\d{1,3})\s*[xX*]\s*(.+?)\s{2,}([\d.,]+)\s*$/);
    if (m) {
      const qty = +m[1];
      const total = parseAmount(m[3]);
      items.push({
        description: m[2].trim(),
        quantity: qty,
        unitPrice: total != null && qty > 0 ? Math.round((total / qty) * 100) / 100 : undefined,
      });
      continue;
    }
    const simple = line.match(/^\s*(.{2,40}?)\s{2,}([\d.,]+)\s*$/);
    if (simple && /[a-zA-Z]{2}/.test(simple[1])) {
      const price = parseAmount(simple[2]);
      if (price != null && price > 0) {
        items.push({ description: simple[1].trim(), quantity: 1, unitPrice: price });
      }
    }
    if (items.length >= 40) break;
  }
  return items;
}

export function parseReceiptText(text: string): ParseResult {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\t/g, '  ')).filter((l) => l.trim().length > 0);
  const joined = lines.join('\n');

  const confidence: FieldConfidence = {};

  const currency = detectCurrency(joined);
  if (currency) confidence.currency = currency.confidence;

  const dateGuess = parseDate(joined, currency?.code ?? null);
  if (dateGuess) confidence.date = dateGuess.confidence;

  const merchant = findMerchant(lines);
  if (merchant) confidence.merchant = merchant.confidence;

  const totalHit = findLabelled(lines, TOTAL_LABELS);
  const subtotalHit = findLabelled(lines, SUBTOTAL_LABELS);
  const taxHit = findLabelled(lines, TAX_LABELS);

  let total: number | null = null;
  if (totalHit) {
    total = Math.abs(totalHit.value);
    confidence.total = totalHit.exact ? 0.98 : 0.86;
  } else {
    // No labelled total: fall back to the largest money-looking number, low confidence.
    const all = lines.flatMap(amountsOnLine).filter((n) => n > 0);
    if (all.length) {
      total = Math.max(...all);
      confidence.total = 0.45;
    }
  }

  const subtotal = subtotalHit ? Math.abs(subtotalHit.value) : null;
  if (subtotalHit) confidence.subtotal = subtotalHit.exact ? 0.93 : 0.8;

  let tax = taxHit ? Math.abs(taxHit.value) : null;
  if (taxHit) confidence.tax = taxHit.exact ? 0.9 : 0.72;

  // Arithmetic cross-check: subtotal + tax should equal total. Agreement raises confidence.
  if (total != null && subtotal != null && tax != null) {
    if (Math.abs(subtotal + tax - total) < 0.02) {
      confidence.total = Math.max(confidence.total ?? 0, 0.99);
      confidence.subtotal = Math.max(confidence.subtotal ?? 0, 0.97);
      confidence.tax = Math.max(confidence.tax ?? 0, 0.97);
    } else {
      confidence.tax = Math.min(confidence.tax ?? 1, 0.55);
    }
  } else if (total != null && subtotal != null && tax == null) {
    const derived = Math.round((total - subtotal) * 100) / 100;
    if (derived > 0 && derived < total) {
      tax = derived;
      confidence.tax = 0.6; // inferred, not read
    }
  }

  const invoice = findInvoiceNumber(joined);
  if (invoice) confidence.invoiceNumber = invoice.confidence;

  const payment = findPaymentMethod(joined);
  if (payment) confidence.paymentMethod = payment.confidence;

  const items = findItems(lines);
  if (items.length) confidence.items = 0.7;

  const fields: ExtractedFields = {
    merchant: merchant?.name ?? null,
    date: dateGuess?.iso ?? null,
    total,
    subtotal,
    tax,
    currency: currency?.code ?? null,
    invoiceNumber: invoice?.value ?? null,
    paymentMethod: payment?.value ?? null,
    items,
  };

  return { fields, confidence, overallConfidence: computeOverall(fields, confidence) };
}

/**
 * Overall confidence is deliberately weighted toward the fields matching depends on.
 * A receipt with a perfect invoice number but no readable total is not a good extraction.
 */
export function computeOverall(fields: ExtractedFields, confidence: FieldConfidence): number {
  const weights: Partial<Record<keyof ExtractedFields, number>> = {
    total: 0.4,
    date: 0.25,
    merchant: 0.25,
    currency: 0.1,
  };
  let sum = 0;
  let total = 0;
  for (const [key, weight] of Object.entries(weights) as Array<[keyof ExtractedFields, number]>) {
    total += weight;
    const present = fields[key] != null && fields[key] !== '';
    sum += weight * (present ? confidence[key] ?? 0.5 : 0);
  }
  return total > 0 ? Math.round((sum / total) * 1000) / 1000 : 0;
}
