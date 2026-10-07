/**
 * Remote providers.
 *
 * Two vendors are wired up behind the same interfaces. Neither is imported anywhere in
 * product code — the registry picks one from the environment, and if a call fails the
 * caller falls back to the local provider rather than failing the upload.
 *
 * Privacy note: both vendors are called with their no-training API surfaces. Documents are
 * sent only when a key is explicitly configured; the default configuration sends nothing.
 */
import type {
  ExtractionInput,
  ExtractionProvider,
  ExtractionResult,
  ExtractedFields,
  FieldConfidence,
  SemanticProvider,
  SemanticCandidate,
} from '../types';
import { computeOverall } from '../../extraction/parse-text';

const EXTRACTION_INSTRUCTION = `You extract structured data from a receipt or invoice image/PDF.
Return ONLY a JSON object, no prose, with exactly these keys:
{"merchant":string|null,"date":"YYYY-MM-DD"|null,"total":number|null,"subtotal":number|null,
"tax":number|null,"currency":"ISO-4217"|null,"invoiceNumber":string|null,
"paymentMethod":"card"|"cash"|"transfer"|null,
"items":[{"description":string,"quantity":number,"unitPrice":number}],
"confidence":{"merchant":0-1,"date":0-1,"total":0-1,"subtotal":0-1,"tax":0-1,"currency":0-1,"invoiceNumber":0-1,"paymentMethod":0-1}}
Rules: report the amount actually charged as "total". Use null, never a guess, for a field you cannot read.
Set a confidence below 0.7 for any field you are unsure about. Handle rotated, cropped and low-quality images.`;

const VISION_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function coerce(parsed: Record<string, unknown>): { fields: ExtractedFields; confidence: FieldConfidence } {
  const num = (v: unknown): number | null => {
    const n = typeof v === 'string' ? Number.parseFloat(v.replace(/[^\d.-]/g, '')) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  };
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

  const rawConf = (parsed.confidence ?? {}) as Record<string, unknown>;
  const confidence: FieldConfidence = {};
  for (const key of ['merchant', 'date', 'total', 'subtotal', 'tax', 'currency', 'invoiceNumber', 'paymentMethod'] as const) {
    const c = num(rawConf[key]);
    if (c != null) confidence[key] = Math.max(0, Math.min(1, c));
  }

  const items = Array.isArray(parsed.items)
    ? (parsed.items as Record<string, unknown>[])
        .map((i) => ({
          description: str(i.description) ?? '',
          quantity: num(i.quantity) ?? undefined,
          unitPrice: num(i.unitPrice) ?? undefined,
        }))
        .filter((i) => i.description)
        .slice(0, 100)
    : [];

  const date = str(parsed.date);
  const fields: ExtractedFields = {
    merchant: str(parsed.merchant),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    total: num(parsed.total),
    subtotal: num(parsed.subtotal),
    tax: num(parsed.tax),
    currency: str(parsed.currency)?.toUpperCase().slice(0, 3) ?? null,
    invoiceNumber: str(parsed.invoiceNumber),
    paymentMethod: str(parsed.paymentMethod),
    items,
  };
  return { fields, confidence };
}

function firstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs = 45_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Status only — response bodies can echo document content into logs.
      throw new Error(`provider responded ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export class AnthropicExtractionProvider implements ExtractionProvider {
  readonly name = 'anthropic';
  private readonly model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5';

  isAvailable(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY!;
    const isImage = VISION_MIMES.includes(input.mimeType);
    const isPdfDoc = input.mimeType === 'application/pdf';
    if (!isImage && !isPdfDoc) throw new Error('unsupported media type for vision extraction');

    const source = {
      type: 'base64' as const,
      media_type: input.mimeType,
      data: input.bytes.toString('base64'),
    };

    const json = (await postJson(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.model,
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              { type: isImage ? 'image' : 'document', source },
              { type: 'text', text: EXTRACTION_INSTRUCTION },
            ],
          },
        ],
      },
    )) as { content?: Array<{ type: string; text?: string }> };

    const text = (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
    const parsed = firstJsonObject(text);
    if (!parsed) throw new Error('provider returned no parseable JSON');

    const { fields, confidence } = coerce(parsed);
    return {
      fields,
      confidence,
      overallConfidence: computeOverall(fields, confidence),
      provider: this.name,
      raw: { model: this.model },
    };
  }
}

export class OpenAIExtractionProvider implements ExtractionProvider {
  readonly name = 'openai';
  private readonly model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  isAvailable(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    if (!VISION_MIMES.includes(input.mimeType)) throw new Error('unsupported media type for vision extraction');
    const dataUrl = `data:${input.mimeType};base64,${input.bytes.toString('base64')}`;

    const json = (await postJson(
      'https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${process.env.OPENAI_API_KEY!}` },
      {
        model: this.model,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: EXTRACTION_INSTRUCTION },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      },
    )) as { choices?: Array<{ message?: { content?: string } }> };

    const text = json.choices?.[0]?.message?.content ?? '';
    const parsed = firstJsonObject(text);
    if (!parsed) throw new Error('provider returned no parseable JSON');

    const { fields, confidence } = coerce(parsed);
    return {
      fields,
      confidence,
      overallConfidence: computeOverall(fields, confidence),
      provider: this.name,
      raw: { model: this.model },
    };
  }
}

/** LLM-backed merchant comparison, used only for pairs the deterministic scorer can't settle. */
export class AnthropicSemanticProvider implements SemanticProvider {
  readonly name = 'anthropic';
  private readonly model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5';

  isAvailable(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async compareMerchant(query: string, candidates: SemanticCandidate[]): Promise<Record<string, number>> {
    const prompt = `A receipt names the merchant: "${query}".
For each bank transaction description below, rate 0.0-1.0 how likely it is the same merchant.
Card networks abbreviate heavily ("AMZN Mktp" is Amazon Marketplace, "UBER *TRIP" is Uber).
Return ONLY JSON: {"<id>": <number>, ...}

${candidates.map((c) => `${c.id}: ${c.text}`).join('\n')}`;

    const json = (await postJson(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      { model: this.model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] },
      20_000,
    )) as { content?: Array<{ type: string; text?: string }> };

    const text = (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
    const parsed = firstJsonObject(text) ?? {};

    const out: Record<string, number> = {};
    for (const c of candidates) {
      const v = parsed[c.id];
      const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
      if (Number.isFinite(n)) out[c.id] = Math.max(0, Math.min(1, n));
    }
    return out;
  }
}
