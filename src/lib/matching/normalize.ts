/**
 * Turning bank noise into something comparable.
 *
 * A bank description is rarely a merchant name. It's a merchant name wrapped in
 * terminal codes, processor prefixes, store numbers, cities and reference strings:
 *
 *   "POS CARREFOUR MARKET TUNIS 2391"  -> "carrefour"
 *   "SQ *BLUE BOTTLE COFFEE"           -> "blue bottle coffee"
 *   "AMZN Mktp DE*1A2B3C4D5"           -> "amazon marketplace"
 *   "UBER   *TRIP HELP.UBER.COM"       -> "uber trip"
 *
 * The raw string is always kept on the row; this only produces a comparison key.
 */

/** Payment-processor and terminal prefixes that carry no merchant information. */
const PROCESSOR_PREFIXES = [
  'pos', 'posd', 'pos debit', 'card payment', 'card purchase', 'cardpurchase',
  'visa', 'visa debit', 'mastercard', 'maestro', 'amex', 'debit', 'credit',
  'sepa', 'sepa dd', 'sepa ct', 'ach', 'ach debit', 'direct debit', 'dd',
  'payment to', 'payment from', 'purchase', 'pmt', 'tfr', 'transfer',
  'withdrawal', 'wd', 'bill payment', 'recurring', 'contactless', 'chip card',
];

/** Aggregator prefixes that appear as "X *MERCHANT". */
const STAR_AGGREGATORS = ['sq', 'tst', 'sp', 'py', 'paypal', 'pp', 'iz', 'wl', 'ec', 'zettle', 'sumup', 'stripe', 'shopify'];

/** Generic words that survive normalization but never distinguish two merchants. */
const NOISE_TOKENS = new Set([
  'market', 'markt', 'marche', 'supermarket', 'hypermarket', 'store', 'shop', 'shopping',
  'express', 'expres', 'city', 'centre', 'center', 'mall', 'branch', 'store no', 'no',
  'ltd', 'limited', 'llc', 'inc', 'incorporated', 'corp', 'co', 'gmbh', 'ag', 'sa', 'sas',
  'sarl', 'srl', 'spa', 'bv', 'nv', 'plc', 'pty', 'ab', 'oy', 'as', 'aps',
  'the', 'and', 'of', 'de', 'du', 'la', 'le', 'les', 'el', 'al',
  'intl', 'international', 'group', 'holdings', 'services', 'service', 'company',
  'online', 'web', 'www', 'com', 'net', 'eu', 'uk', 'us', 'fr', 'tn',
]);

/**
 * Brands we recognise by name. When one of these appears anywhere in a description,
 * it *is* the merchant and the surrounding tokens (city, store format, franchise number)
 * are decoration. This is deliberately a short, high-confidence list rather than an
 * attempt to enumerate the world's cities — anything not listed here still matches
 * through fuzzy similarity, which tolerates trailing tokens by design.
 */
const KNOWN_BRANDS = [
  'amazon web services', 'amazon marketplace', 'amazon', 'carrefour', 'monoprix', 'auchan', 'lidl', 'aldi',
  'walmart', 'target', 'costco', 'tesco', 'sainsburys', 'mcdonalds', 'starbucks', 'subway', 'burger king',
  'uber eats', 'ubereats', 'uber', 'lyft', 'bolt', 'deliveroo', 'just eat',
  'netflix', 'spotify', 'apple', 'google', 'microsoft', 'adobe', 'dropbox', 'slack', 'notion', 'figma',
  'github', 'gitlab', 'atlassian', 'openai', 'anthropic', 'digitalocean', 'heroku', 'vercel', 'cloudflare',
  // "total" and "bp" are deliberately absent: they collide with amount labels and initials.
  'godaddy', 'namecheap', 'totalenergies', 'shell', 'esso', 'ikea', 'decathlon', 'fnac', 'zara',
  'booking com', 'airbnb', 'ryanair', 'easyjet', 'lufthansa', 'air france', 'tunisair', 'sncf',
  'steam', 'paypal', 'stripe', 'twilio', 'linkedin', 'meta', 'canva',
];

/** Brand aliases: the abbreviations card networks use, mapped to the real name. */
const BRAND_ALIASES: Record<string, string> = {
  amzn: 'amazon',
  'amzn mktp': 'amazon marketplace',
  mktp: 'marketplace',
  'amazon eu': 'amazon',
  'amazon digital': 'amazon',
  'amzn digital': 'amazon',
  mcd: 'mcdonalds',
  mcdonald: 'mcdonalds',
  "mcdonald's": 'mcdonalds',
  sbux: 'starbucks',
  'wm supercenter': 'walmart',
  wmt: 'walmart',
  'uber trip': 'uber',
  'uber eats': 'ubereats',
  ubereats: 'ubereats',
  'lyft ride': 'lyft',
  googl: 'google',
  'google cloud': 'google',
  msft: 'microsoft',
  'microsoft 365': 'microsoft',
  aws: 'amazon web services',
  'amazon web svcs': 'amazon web services',
  dnh: 'godaddy',
  'apple com bill': 'apple',
  'itunes com bill': 'apple',
  nflx: 'netflix',
  spfy: 'spotify',
  'spotify ab': 'spotify',
  carrefour: 'carrefour',
  'monoprix sa': 'monoprix',
};

function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Normalize a full bank transaction description.
 * Removes processor wrappers, references and terminal noise but keeps word order.
 */
export function normalizeDescription(raw: string): string {
  if (!raw) return '';
  let s = stripDiacritics(raw).toLowerCase();

  // "SQ *BLUE BOTTLE" / "PAYPAL *STEAM" -> keep what follows the star.
  const starMatch = s.match(/^([a-z]{2,8})\s*\*+\s*(.+)$/);
  if (starMatch && STAR_AGGREGATORS.includes(starMatch[1].trim())) {
    s = starMatch[2];
  }
  // Any remaining "*" acts as a separator, not a character.
  s = s.replace(/\*+/g, ' ');

  // Card tails, long digit references, dates, times, currency codes with amounts.
  s = s.replace(/\bx{2,}\d{2,}\b/g, ' '); // xxxx1234
  s = s.replace(/\b\d{1,2}[\/.-]\d{1,2}([\/.-]\d{2,4})?\b/g, ' '); // 28/09/2026
  s = s.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' '); // 20:14
  s = s.replace(/#\s*\d+/g, ' '); // #2391
  s = s.replace(/\b(ref|reference|auth|authcode|trn|trace|id|inv|invoice|order|ord|txn|tx)[:. ]*[a-z0-9-]{3,}\b/g, ' ');
  s = s.replace(/\b[a-z0-9]*\d[a-z0-9]*\b/g, (m) => (m.length >= 4 ? ' ' : m)); // alphanumeric refs
  s = s.replace(/\b[a-z]{3}\s?[\d.,]+\b/g, ' '); // "eur 47,85"

  // Punctuation to spaces, collapse.
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();

  // Leading processor prefixes, possibly stacked ("pos visa carrefour").
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of PROCESSOR_PREFIXES) {
      if (s === p) return '';
      if (s.startsWith(p + ' ')) {
        s = s.slice(p.length + 1);
        changed = true;
      }
    }
  }

  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Produce the merchant comparison key: the description with generic tokens dropped
 * and known brand abbreviations expanded.
 */
export function normalizeMerchant(raw: string): string {
  const base = normalizeDescription(raw);
  if (!base) return '';

  // Whole-string alias first (handles multi-word aliases like "amzn mktp").
  if (BRAND_ALIASES[base]) return BRAND_ALIASES[base];
  for (const [alias, real] of Object.entries(BRAND_ALIASES)) {
    if (alias.includes(' ') && base.startsWith(alias + ' ')) {
      return real;
    }
  }

  const expanded = base
    .split(' ')
    .map((t) => BRAND_ALIASES[t] ?? t)
    .flatMap((t) => t.split(' '));

  // A recognised brand anywhere in the string settles the merchant; the rest is decoration
  // ("carrefour tunis", "carrefour market", "carrefour 2391" all key on "carrefour").
  // Longest brands are tested first so "amazon web services" beats "amazon".
  const joined = expanded.join(' ');
  for (const brand of KNOWN_BRANDS) {
    if (joined === brand || joined.startsWith(brand + ' ') || joined.endsWith(' ' + brand) || joined.includes(' ' + brand + ' ')) {
      return brand;
    }
  }

  const tokens = expanded.filter((t) => t.length > 1 && !NOISE_TOKENS.has(t));

  // Everything was noise — fall back to the un-filtered form rather than an empty key.
  if (tokens.length === 0) return base;
  return tokens.join(' ');
}

/** Pull a payment reference out of a description, for display and audit. */
export function extractReference(raw: string): string | null {
  const m = raw.match(/\b(?:ref|reference|inv|invoice|order|ord)[:.# ]*([a-z0-9][a-z0-9-]{2,})\b/i);
  return m ? m[1].toUpperCase() : null;
}

/** Infer a payment method from a bank description, when the wording gives it away. */
export function inferPaymentMethod(raw: string): string | null {
  const s = raw.toLowerCase();
  if (/\b(visa|mastercard|maestro|amex|card|pos|contactless|chip)\b/.test(s)) return 'card';
  if (/\b(atm|cash|withdrawal)\b/.test(s)) return 'cash';
  if (/\b(sepa|transfer|tfr|wire|ach|giro)\b/.test(s)) return 'transfer';
  if (/\b(direct debit|dd|standing order)\b/.test(s)) return 'direct_debit';
  return null;
}

/** Currency amounts are compared in minor units to avoid float drift. */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}
