import type { MessageKey } from './messages';
import type { Params } from './config';

/**
 * The server answers in English and its messages are part of its contract, so they are
 * translated where they are shown, the same way match reasons are: each known sentence is
 * recognised and rendered from a template, and an unknown one is shown as written.
 */
type T = (key: MessageKey, params?: Params) => string;

const EXACT: Array<[string, MessageKey]> = [
  ['Sign in required', 'er.signIn'],
  ['Verify your email address to continue', 'er.verifyEmail'],
  ['Email or password is incorrect, or the account is temporarily locked', 'er.badLogin'],
  ['This reset link is invalid or has expired', 'er.resetExpired'],
  ['An account with this email already exists', 'er.emailTaken'],
  ['This link is invalid or has expired', 'er.linkExpired'],
  ['If an account exists for that address, a reset link is on its way.', 'er.resetSent'],
  ['Please accept the Terms of Service and Privacy Policy', 'er.acceptTerms'],
  ['Upload the file as multipart form data', 'er.multipart'],
  ['No file was received', 'er.noFile'],
  ['CSV files are limited to 10MB', 'er.csvTooBig'],
  ['That file is empty', 'er.fileEmpty'],
  ['File is empty', 'er.fileEmptyUpload'],
  ['Receipt not found', 'er.receiptMissing'],
  ['That does not look like a CSV file', 'er.notCsv'],
  ['No columns could be read from that file', 'er.noColumns'],
  ['Ask for at most 100 receipts at a time', 'er.max100'],
  ['Unknown category', 'er.unknownCategory'],
  ['This receipt has no extraction to edit yet', 'er.noExtraction'],
  ['Thresholds must satisfy: automatic >= review >= possible', 'er.thresholds'],
  ['At least one matching weight must be above zero', 'er.weights'],
  ['Too many requests. Please wait a moment and try again.', 'er.rateLimited'],
  ['Account not found', 'er.noAccount'],
  ['Your current password is incorrect', 'er.wrongCurrent'],
  ['Choose a password you are not already using', 'er.samePassword'],
  ['Password is incorrect', 'er.wrongPassword'],
  ['Unknown bank account', 'er.unknownBank'],
  ['No transactions could be read from this file', 'er.noRows'],
  ['Only JPG, PNG, WEBP and PDF files can be uploaded', 'er.fileType'],
  ['Document not found', 'er.docMissing'],
  ['Not allowed', 'er.notAllowed'],
  ['Not found', 'er.notFound'],
  ['Request body must be valid JSON', 'er.badJson'],
  ['Something went wrong. Please try again.', 'common.tryAgain'],
  // import rows
  ['File contains no data rows', 'er.noDataRows'],
  ['No column mapped to Date', 'er.noDateColumn'],
  ['No column mapped to Amount (or Debit/Credit)', 'er.noAmountColumn'],
  ['Unreadable amount', 'er.badAmount'],
  ['Zero-amount row skipped', 'er.zeroAmount'],
  ['Duplicate of an earlier row in this file', 'er.dupRow'],
];

interface Rule {
  re: RegExp;
  key: MessageKey;
  params: (m: RegExpMatchArray, t: T) => Params;
}

const planName = (id: string, t: T) => {
  const key = `land.plan.${id.toLowerCase()}.name` as MessageKey;
  const name = t(key);
  return name === key ? id : name;
};

const RULES: Rule[] = [
  { re: /^File is larger than (\d+)MB$/, key: 'er.fileTooBig', params: (m) => ({ mb: m[1] }) },
  { re: /^Unreadable date: "(.*)"$/, key: 'er.badDate', params: (m) => ({ value: m[1] }) },
  { re: /^acceptTerms: (.*)$/, key: 'er.acceptTerms', params: () => ({}) },
  {
    re: /^This exact file was already imported on (.+)\. Import it again anyway\?$/,
    key: 'er.alreadyImported',
    params: (m) => ({ date: m[1] }),
  },
  {
    re: /^Your (\w+) plan ended on (\d{4}-\d{2}-\d{2}), so the Free limit of (\d+) receipts a month applies\. Renew to add more\.$/,
    key: 'er.quotaExpired',
    params: (m, t) => ({ plan: planName(m[1], t), date: m[2], n: m[3] }),
  },
  {
    re: /^You have used all (\d+) receipts on the (\w+) plan this month\. Upgrade to add more\.$/,
    key: 'er.quotaUsed',
    params: (m, t) => ({ n: m[1], plan: planName(m[2], t) }),
  },
];

/** The message in the reader's language, as written when not recognised, or undefined when there is none. */
export function translateError(message: unknown, t: T): string | undefined {
  if (typeof message !== 'string' || !message) return undefined;
  for (const [english, key] of EXACT) if (message === english) return t(key);
  for (const rule of RULES) {
    const m = message.match(rule.re);
    if (m) return t(rule.key, rule.params(m, t));
  }
  return message;
}
