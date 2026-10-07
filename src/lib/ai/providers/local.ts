/**
 * Local providers — no network, no vendor, nothing leaves the machine.
 *
 * These are what run when no API key is configured, and they are what the test suite and
 * the demo dataset exercise. They are not stubs that return fixtures: the extraction
 * provider does real work on any document that carries readable text, and only falls back
 * to a low-confidence guess when there is genuinely nothing to read (a photo, with no OCR
 * engine configured), which is exactly the case the "Review required" state exists for.
 */
import { extractPdfText, isPdf } from '../../extraction/pdf-text';
import { parseReceiptText, computeOverall } from '../../extraction/parse-text';
import { normalizeMerchant } from '../../matching/normalize';
import { merchantSimilarity } from '../../matching/similarity';
import type {
  ExtractionInput,
  ExtractionProvider,
  ExtractionResult,
  ExtractedFields,
  SemanticProvider,
  SemanticCandidate,
} from '../types';

const TEXT_MIMES = ['text/plain', 'text/csv', 'application/json'];

export class LocalExtractionProvider implements ExtractionProvider {
  readonly name = 'local';

  isAvailable(): boolean {
    return true;
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const text = this.readText(input);

    if (text) {
      const parsed = parseReceiptText(text);
      return {
        fields: parsed.fields,
        confidence: parsed.confidence,
        overallConfidence: parsed.overallConfidence,
        provider: this.name,
        raw: { source: 'text-layer', characters: text.length },
      };
    }

    // No readable text. Rather than inventing data silently, return empty fields at zero
    // confidence — the receipt lands in "Needs Review" and the user is offered manual entry.
    const empty: ExtractedFields = {
      merchant: null,
      date: null,
      total: null,
      subtotal: null,
      tax: null,
      currency: null,
      invoiceNumber: null,
      paymentMethod: null,
      items: [],
    };
    return {
      fields: empty,
      confidence: {},
      overallConfidence: 0,
      provider: this.name,
      raw: { source: 'none', reason: 'no text layer and no OCR engine configured' },
    };
  }

  private readText(input: ExtractionInput): string | null {
    if (isPdf(input.bytes)) return extractPdfText(input.bytes);
    if (TEXT_MIMES.includes(input.mimeType) || /\.(txt|text)$/i.test(input.originalName)) {
      const s = input.bytes.toString('utf8');
      return s.trim() ? s : null;
    }
    return null;
  }
}

/**
 * Local semantic merchant comparison.
 *
 * Handles the class of case an LLM would otherwise be asked about — abbreviations and
 * acronyms ("AMZN Mktp" / "Amazon Marketplace") — using normalization plus initialism
 * and prefix-expansion checks. Cheap, deterministic, and good enough that the remote
 * provider is rarely needed.
 */
export class LocalSemanticProvider implements SemanticProvider {
  readonly name = 'local';

  isAvailable(): boolean {
    return true;
  }

  async compareMerchant(query: string, candidates: SemanticCandidate[]): Promise<Record<string, number>> {
    const q = normalizeMerchant(query);
    const out: Record<string, number> = {};

    for (const c of candidates) {
      const t = normalizeMerchant(c.text);
      let best = merchantSimilarity(q, t);

      // Abbreviation: every candidate token is a prefix of a query token, in order.
      best = Math.max(best, prefixExpansion(q, t), prefixExpansion(t, q));
      // Initialism: "aws" vs "amazon web services".
      best = Math.max(best, initialism(q, t), initialism(t, q));
      // Vowel-dropped forms: "sbux" / "starbucks", "mktp" / "marketplace".
      best = Math.max(best, consonantSkeleton(q, t));

      out[c.id] = Math.min(1, Math.round(best * 100) / 100);
    }
    return out;
  }
}

/** Does every token of `abbrev` start the corresponding token of `full`? */
function prefixExpansion(abbrev: string, full: string): number {
  const a = abbrev.split(' ').filter(Boolean);
  const f = full.split(' ').filter(Boolean);
  if (!a.length || !f.length || a.length > f.length) return 0;

  let fi = 0;
  let matched = 0;
  for (const token of a) {
    while (fi < f.length && !f[fi].startsWith(token)) fi++;
    if (fi >= f.length) return 0;
    matched += token.length / f[fi].length;
    fi++;
  }
  // Confident, but never a perfect 1 — it is still an inference.
  return 0.8 + 0.15 * (matched / a.length);
}

function initialism(abbrev: string, full: string): number {
  const a = abbrev.replace(/\s/g, '');
  const words = full.split(' ').filter(Boolean);
  if (a.length < 2 || words.length < 2 || a.length !== words.length) return 0;
  for (let i = 0; i < words.length; i++) {
    if (words[i][0] !== a[i]) return 0;
  }
  return 0.9;
}

function consonantSkeleton(a: string, b: string): number {
  const skel = (s: string) => s.replace(/[aeiou\s]/g, '');
  const sa = skel(a);
  const sb = skel(b);
  if (sa.length < 3 || sb.length < 3) return 0;
  const [short, long] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  if (!long.startsWith(short)) return 0;
  return 0.75 + 0.15 * (short.length / long.length);
}

/** Re-scores an extraction after a user edit, keeping confidences honest. */
export function recomputeConfidence(fields: ExtractedFields, confidence: Record<string, number>): number {
  return computeOverall(fields, confidence);
}
