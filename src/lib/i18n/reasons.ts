import type { MessageKey } from './messages';
import type { Params } from './config';

/**
 * The matching engine writes its reasons in English and stores them with each match, so
 * matches made before a language existed carry English text. Rather than change what is
 * stored, the reason is translated when it is shown: each known sentence is recognised and
 * rendered from a template. A sentence nobody recognises is shown as written, never dropped.
 */
type T = (key: MessageKey, params?: Params) => string;

interface Rule {
  re: RegExp;
  key: MessageKey;
  params?: (m: RegExpMatchArray, t: T) => Params;
}

const days = (n: string, t: T) => t(Number(n) === 1 ? 'rs.day' : 'rs.days');

const RULES: Rule[] = [
  { re: /^Receipt total missing$/, key: 'rs.totalMissing' },
  { re: /^Exact amount$/, key: 'rs.exactAmount' },
  { re: /^Amounts differ by (.+)$/, key: 'rs.amountsDiffer', params: (m) => ({ delta: m[1] }) },
  { re: /^Receipt date missing$/, key: 'rs.dateMissing' },
  { re: /^Same date$/, key: 'rs.sameDate' },
  {
    re: /^(\d+) days (after|before) receipt, outside tolerance$/,
    key: 'rs.dateOutside',
    params: (m, t) => ({ n: m[1], dir: t(m[2] === 'after' ? 'rs.after' : 'rs.before') }),
  },
  {
    re: /^Transaction (\d+) days? (after|before) receipt$/,
    key: 'rs.dateNear',
    params: (m, t) => ({ n: m[1], days: days(m[1], t), dir: t(m[2] === 'after' ? 'rs.after' : 'rs.before') }),
  },
  { re: /^Merchant unavailable$/, key: 'rs.merchantMissing' },
  { re: /^Merchant similarity (\d+)%, too low$/, key: 'rs.merchantLow', params: (m) => ({ pct: m[1] }) },
  {
    re: /^Merchant similarity (\d+)%( \(semantic\))?$/,
    key: 'rs.merchantSim',
    params: (m, t) => ({ pct: m[1], semantic: m[2] ? ` (${t('rs.semantic')})` : '' }),
  },
  { re: /^Receipt currency missing$/, key: 'rs.currencyMissing' },
  { re: /^Same currency \((\w+)\)$/, key: 'rs.sameCurrency', params: (m) => ({ code: m[1] }) },
  { re: /^Currency mismatch: (\w+) vs (\w+)$/, key: 'rs.currencyMismatch', params: (m) => ({ a: m[1], b: m[2] }) },
  { re: /^Payment method unknown$/, key: 'rs.payUnknown' },
  { re: /^Both paid by (.+)$/, key: 'rs.payBoth', params: (m) => ({ method: m[1] }) },
  { re: /^Payment method differs: (.+) vs (.+)$/, key: 'rs.payDiffers', params: (m) => ({ a: m[1], b: m[2] }) },
  // hard vetoes
  { re: /^Amounts are too far apart$/, key: 'rs.vetoAmount' },
  { re: /^Currency mismatch: needs a human$/, key: 'rs.vetoCurrency' },
  { re: /^Dates are outside the tolerance window$/, key: 'rs.vetoDate' },
  // duplicate detection
  { re: /^The same file has already been uploaded$/, key: 'rs.dupFile' },
  { re: /^Invoice number (.+) already recorded$/, key: 'rs.dupInvoice', params: (m) => ({ invoice: m[1] }) },
  { re: /^Same merchant, amount and date as an existing receipt$/, key: 'rs.dupSame' },
  {
    re: /^Same merchant and amount as a receipt from (\d+) days? earlier$/,
    key: 'rs.dupEarlier',
    params: (m, t) => ({ n: m[1], days: days(m[1], t) }),
  },
];

export function translateReason(reason: string, t: T): string {
  for (const rule of RULES) {
    const m = reason.match(rule.re);
    if (m) return t(rule.key, rule.params?.(m, t));
  }
  return reason;
}
