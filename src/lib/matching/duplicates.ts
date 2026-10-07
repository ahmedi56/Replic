/**
 * Duplicate detection.
 *
 * Two kinds, with different evidence:
 *
 *  - Exact: the same bytes uploaded twice. Caught by the file checksum, certain.
 *  - Near:  the same purchase captured twice — a photo and the emailed PDF, or the same
 *           invoice re-sent. Caught by merchant + amount + date proximity, or by a shared
 *           invoice number, which is the strongest single signal there is.
 */
import { MatchingConfig, DEFAULT_MATCHING_CONFIG } from './config';
import { merchantSimilarity } from './similarity';
import { toMinorUnits } from './normalize';
import { daysBetween } from './score';

export interface DuplicateCandidateInput {
  id: string;
  checksum: string;
  merchantNorm: string | null;
  date: Date | null;
  total: number | null;
  invoiceNumber: string | null;
  createdAt: Date;
}

export type DuplicateReasonKind = 'identical_file' | 'invoice_number' | 'merchant_amount_date';

export interface DuplicateFinding {
  receiptId: string;
  duplicateOfId: string;
  confidence: number;
  kind: DuplicateReasonKind;
  reason: string;
}

/**
 * Compare one receipt against existing ones. The older receipt (by createdAt) is treated
 * as the original; the newer is flagged, never deleted.
 */
export function findDuplicate(
  candidate: DuplicateCandidateInput,
  existing: DuplicateCandidateInput[],
  cfg: MatchingConfig = DEFAULT_MATCHING_CONFIG,
): DuplicateFinding | null {
  const others = existing.filter((e) => e.id !== candidate.id);

  // 1. Byte-identical file.
  const identical = others.find((e) => e.checksum === candidate.checksum);
  if (identical) {
    const [original, dup] = order(identical, candidate);
    return {
      receiptId: dup.id,
      duplicateOfId: original.id,
      confidence: 1,
      kind: 'identical_file',
      reason: 'The same file has already been uploaded',
    };
  }

  // 2. Same invoice number from the same merchant.
  if (candidate.invoiceNumber) {
    const sameInvoice = others.find(
      (e) =>
        e.invoiceNumber &&
        e.invoiceNumber.toUpperCase() === candidate.invoiceNumber!.toUpperCase() &&
        (!e.merchantNorm || !candidate.merchantNorm || merchantSimilarity(e.merchantNorm, candidate.merchantNorm) >= 0.6),
    );
    if (sameInvoice) {
      const [original, dup] = order(sameInvoice, candidate);
      return {
        receiptId: dup.id,
        duplicateOfId: original.id,
        confidence: 0.97,
        kind: 'invoice_number',
        reason: `Invoice number ${candidate.invoiceNumber} already recorded`,
      };
    }
  }

  // 3. Same merchant, same amount, dates within the window.
  if (candidate.total != null && candidate.merchantNorm) {
    const candidateMinor = toMinorUnits(candidate.total);
    for (const other of others) {
      if (other.total == null || !other.merchantNorm) continue;
      if (Math.abs(toMinorUnits(other.total) - candidateMinor) > toMinorUnits(cfg.duplicates.amountToleranceAbs)) continue;

      const sim = merchantSimilarity(candidate.merchantNorm, other.merchantNorm);
      if (sim < cfg.duplicates.merchantSimilarity) continue;

      let dayGap: number | null = null;
      if (candidate.date && other.date) {
        dayGap = Math.abs(daysBetween(candidate.date, other.date));
        if (dayGap > cfg.duplicates.dateWindowDays) continue;
      }

      const [original, dup] = order(other, candidate);
      // Same day is near-certain; a few days apart could legitimately be two visits.
      const confidence = dayGap === 0 ? 0.92 : dayGap == null ? 0.7 : 0.92 - dayGap * 0.12;
      return {
        receiptId: dup.id,
        duplicateOfId: original.id,
        confidence: Math.round(confidence * 100) / 100,
        kind: 'merchant_amount_date',
        reason:
          dayGap === 0
            ? 'Same merchant, amount and date as an existing receipt'
            : `Same merchant and amount as a receipt from ${dayGap} day${dayGap === 1 ? '' : 's'} earlier`,
      };
    }
  }

  return null;
}

function order(a: DuplicateCandidateInput, b: DuplicateCandidateInput): [DuplicateCandidateInput, DuplicateCandidateInput] {
  return a.createdAt.getTime() <= b.createdAt.getTime() ? [a, b] : [b, a];
}

/** Scan a whole set — used by the "re-check duplicates" action and by tests. */
export function findAllDuplicates(receipts: DuplicateCandidateInput[], cfg: MatchingConfig = DEFAULT_MATCHING_CONFIG): DuplicateFinding[] {
  const sorted = [...receipts].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const findings: DuplicateFinding[] = [];
  const flagged = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    const candidate = sorted[i];
    if (flagged.has(candidate.id)) continue;
    const earlier = sorted.slice(0, i).filter((e) => !flagged.has(e.id));
    const finding = findDuplicate(candidate, earlier, cfg);
    if (finding) {
      findings.push(finding);
      flagged.add(finding.receiptId);
    }
  }
  return findings;
}
