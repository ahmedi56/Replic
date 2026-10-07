/**
 * String similarity used by the merchant signal.
 *
 * No single metric handles both "Carrefour" vs "CARREFOUR MARKET TUNIS" (extra tokens)
 * and "Carefour" vs "Carrefour" (a typo), so the merchant score blends three views:
 * character-level (Jaro-Winkler), token-level (token-set ratio), and containment.
 */

/** Jaro-Winkler: forgiving of typos and transpositions, rewards a shared prefix. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aFlags = new Array<boolean>(a.length).fill(false);
  const bFlags = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bFlags[j] || a[i] !== b[j]) continue;
      aFlags[i] = true;
      bFlags[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aFlags[i]) continue;
    while (!bFlags[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const jaro = (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;

  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;

  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Levenshtein distance, iterative with a rolling row. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr.slice();
  }
  return prev[b.length];
}

export function levenshteinRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/**
 * Token-set ratio: compares the shared tokens against each side's full token set.
 * Handles "carrefour" vs "carrefour market tunis" and word reordering.
 */
export function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(a.split(/\s+/).filter(Boolean));
  const tb = new Set(b.split(/\s+/).filter(Boolean));
  if (!ta.size || !tb.size) return 0;

  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;

  // Tokens that don't match exactly still count partially if they're near-identical.
  let fuzzyBonus = 0;
  for (const t of ta) {
    if (tb.has(t)) continue;
    let best = 0;
    for (const u of tb) {
      if (tb.has(t)) break;
      best = Math.max(best, jaroWinkler(t, u));
    }
    if (best >= 0.9) fuzzyBonus += best;
  }

  const matched = intersection + fuzzyBonus;
  // Dice-style: rewards overlap without punishing one side for being longer.
  return (2 * matched) / (ta.size + tb.size);
}

/** 1 when one normalized string fully contains the other as a token run. */
export function containment(a: string, b: string): number {
  if (!a || !b) return 0;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long === short) return 1;
  const tokens = long.split(/\s+/);
  const shortTokens = short.split(/\s+/);
  for (let i = 0; i + shortTokens.length <= tokens.length; i++) {
    if (tokens.slice(i, i + shortTokens.length).join(' ') === short) return 1;
  }
  return 0;
}

/**
 * Blended merchant similarity, 0-1.
 * Containment is decisive when present; otherwise character- and token-level views
 * are averaged with a bias toward whichever is stronger.
 */
export function merchantSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  if (containment(a, b) === 1) {
    // "carrefour" inside "carrefour market tunis" — a real match, but the extra
    // tokens leave some doubt, so it isn't a perfect 1.
    const lengthPenalty = Math.min(a.split(' ').length, b.split(' ').length) / Math.max(a.split(' ').length, b.split(' ').length);
    return 0.9 + 0.1 * lengthPenalty;
  }

  const jw = jaroWinkler(a, b);
  const ts = tokenSetRatio(a, b);
  const lev = levenshteinRatio(a, b);

  const best = Math.max(jw, ts, lev);
  const avg = (jw + ts + lev) / 3;
  return 0.6 * best + 0.4 * avg;
}
