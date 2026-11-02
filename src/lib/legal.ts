/**
 * Who is behind the service, for the Terms and the Privacy Policy.
 *
 * These come from environment variables so the legal pages state real facts and the repository
 * holds none. Anything not set stays as a visible [bracketed placeholder], and while any
 * placeholder remains (or LEGAL_REVIEWED is not "true") the pages show a "draft" notice, so
 * unreviewed text cannot pass itself off as final.
 */

export interface LegalConfig {
  company: string;
  address: string;
  contactEmail: string;
  /** e.g. "the laws of France". */
  governingLaw: string;
  /** Where the court that hears a dispute sits, e.g. "Paris, France". */
  courts: string;
  /** Where customer data is hosted, e.g. "the European Union (Frankfurt)". */
  dataRegion: string;
  /** Name of the company that sends our emails and of the file-storage provider. */
  emailProvider: string;
  storageProvider: string;
  /** The data protection authority that oversees you, e.g. "the CNIL (France)". Named in the Addendum. */
  supervisoryAuthority: string;
  /** The label shown as the "last updated" date. */
  effectiveDate: string;
  /** True only once a lawyer has reviewed the text and every placeholder is filled. */
  reviewed: boolean;
}

/** Recorded with each sign-up, so a dispute can show which text the customer agreed to. */
export const TERMS_VERSION = '2026-11-draft-1';

const placeholder = (what: string) => `[${what}]`;

export function legalConfig(env: Record<string, string | undefined> = process.env): LegalConfig {
  const pick = (name: string, label: string) => env[name]?.trim() || placeholder(label);
  return {
    company: pick('LEGAL_COMPANY_NAME', 'company legal name'),
    address: pick('LEGAL_ADDRESS', 'company address'),
    contactEmail: env.LEGAL_CONTACT_EMAIL?.trim() || env.SUPPORT_EMAIL?.trim() || placeholder('contact email'),
    governingLaw: pick('LEGAL_GOVERNING_LAW', 'governing law, e.g. the laws of France'),
    courts: pick('LEGAL_COURTS', 'city and country of the courts'),
    dataRegion: pick('LEGAL_DATA_REGION', 'hosting region'),
    emailProvider: pick('LEGAL_EMAIL_PROVIDER', 'email provider'),
    storageProvider: pick('LEGAL_STORAGE_PROVIDER', 'file storage provider'),
    supervisoryAuthority: pick('LEGAL_SUPERVISORY_AUTHORITY', 'data protection authority'),
    effectiveDate: pick('LEGAL_EFFECTIVE_DATE', 'effective date'),
    reviewed: env.LEGAL_REVIEWED === 'true',
  };
}

/** The environment variable that fills in each setting. */
export const LEGAL_ENV_NAMES: Record<keyof LegalConfig, string> = {
  company: 'LEGAL_COMPANY_NAME',
  address: 'LEGAL_ADDRESS',
  contactEmail: 'LEGAL_CONTACT_EMAIL',
  governingLaw: 'LEGAL_GOVERNING_LAW',
  courts: 'LEGAL_COURTS',
  dataRegion: 'LEGAL_DATA_REGION',
  emailProvider: 'LEGAL_EMAIL_PROVIDER',
  storageProvider: 'LEGAL_STORAGE_PROVIDER',
  supervisoryAuthority: 'LEGAL_SUPERVISORY_AUTHORITY',
  effectiveDate: 'LEGAL_EFFECTIVE_DATE',
  reviewed: 'LEGAL_REVIEWED',
};

/** The settings still showing a placeholder. Empty means the facts are all filled in. */
export function unresolvedPlaceholders(config: LegalConfig): string[] {
  return Object.entries(config)
    .filter(([, value]) => typeof value === 'string' && value.startsWith('[') && value.endsWith(']'))
    .map(([key]) => key);
}

/** The pages show the draft notice unless a reviewer has signed off AND nothing is left blank. */
export function showDraftNotice(config: LegalConfig): boolean {
  return !config.reviewed || unresolvedPlaceholders(config).length > 0;
}
