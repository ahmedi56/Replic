/**
 * Provider selection.
 *
 * `EXTRACTION_PROVIDER` / `SEMANTIC_PROVIDER` choose the implementation; anything
 * unavailable (no key configured) silently degrades to the local one. Product code calls
 * `extractReceipt()` and `getSemanticProvider()` and never learns which vendor answered.
 */
import type { ExtractionInput, ExtractionProvider, ExtractionResult, SemanticProvider } from './types';
import { LocalExtractionProvider, LocalSemanticProvider } from './providers/local';
import { AnthropicExtractionProvider, OpenAIExtractionProvider, AnthropicSemanticProvider } from './providers/remote';

const localExtraction = new LocalExtractionProvider();
const localSemantic = new LocalSemanticProvider();

const extractionProviders: Record<string, ExtractionProvider> = {
  local: localExtraction,
  mock: localExtraction, // alias kept so existing .env files keep working
  anthropic: new AnthropicExtractionProvider(),
  openai: new OpenAIExtractionProvider(),
};

const semanticProviders: Record<string, SemanticProvider> = {
  local: localSemantic,
  none: { name: 'none', isAvailable: () => false, async compareMerchant() { return {}; } },
  anthropic: new AnthropicSemanticProvider(),
};

export function getExtractionProvider(): ExtractionProvider {
  const chosen = extractionProviders[process.env.EXTRACTION_PROVIDER ?? 'local'];
  return chosen?.isAvailable() ? chosen : localExtraction;
}

export function getSemanticProvider(): SemanticProvider {
  const chosen = semanticProviders[process.env.SEMANTIC_PROVIDER ?? 'local'];
  return chosen?.isAvailable() ? chosen : localSemantic;
}

/**
 * Extract with the configured provider, falling back to local on any failure.
 * A provider outage must never lose a user's upload — the document is already stored.
 */
export async function extractReceipt(input: ExtractionInput): Promise<ExtractionResult> {
  const provider = getExtractionProvider();
  try {
    const result = await provider.extract(input);
    // A remote provider that reads nothing is worse than the local text parser; try both.
    if (result.overallConfidence === 0 && provider.name !== 'local') {
      const fallback = await localExtraction.extract(input);
      if (fallback.overallConfidence > 0) return fallback;
    }
    return result;
  } catch (error) {
    if (provider.name === 'local') throw error;
    // Log the provider and reason only — never the document or the response body.
    console.warn(`[extraction] provider "${provider.name}" failed, falling back to local`);
    return localExtraction.extract(input);
  }
}

export const availableProviders = {
  extraction: () => Object.entries(extractionProviders).filter(([, p]) => p.isAvailable()).map(([k]) => k),
  semantic: () => Object.entries(semanticProviders).filter(([, p]) => p.isAvailable()).map(([k]) => k),
};
