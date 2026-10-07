/**
 * Provider contracts.
 *
 * Reclip never talks to a vendor SDK directly. Extraction and semantic matching are
 * defined here as interfaces; implementations register themselves and are chosen by
 * environment variable, so a provider can be swapped without touching product code.
 *
 * Privacy: implementations must not send documents to any service that trains on them.
 * The local providers send nothing anywhere.
 */

export interface ExtractedLineItem {
  description: string;
  quantity?: number;
  unitPrice?: number;
}

export interface ExtractedFields {
  merchant: string | null;
  date: string | null; // ISO yyyy-mm-dd
  total: number | null;
  subtotal: number | null;
  tax: number | null;
  currency: string | null;
  invoiceNumber: string | null;
  paymentMethod: string | null;
  items: ExtractedLineItem[];
}

/** 0-1 per field. Missing key means "not attempted". */
export type FieldConfidence = Partial<Record<keyof ExtractedFields, number>>;

export interface ExtractionResult {
  fields: ExtractedFields;
  confidence: FieldConfidence;
  overallConfidence: number;
  provider: string;
  /** Kept for audit; never shown raw to the user. */
  raw?: unknown;
}

export interface ExtractionInput {
  bytes: Buffer;
  mimeType: string;
  originalName: string;
}

export interface ExtractionProvider {
  readonly name: string;
  isAvailable(): boolean;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

export interface SemanticCandidate {
  id: string;
  text: string;
}

/**
 * Asked only for merchant pairs the deterministic scorer finds genuinely ambiguous.
 * Returns similarity 0-1 keyed by candidate id.
 */
export interface SemanticProvider {
  readonly name: string;
  isAvailable(): boolean;
  compareMerchant(query: string, candidates: SemanticCandidate[]): Promise<Record<string, number>>;
}
