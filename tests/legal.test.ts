import { describe, it, expect } from 'vitest';
import { legalConfig, unresolvedPlaceholders, showDraftNotice, TERMS_VERSION } from '@/lib/legal';
import fs from 'node:fs';
import { privacySections, termsSections, subprocessorTable, type LegalSection } from '@/lib/legal-content';
import { dpaSections } from '@/lib/legal-dpa';
import {
  BREACH_NOTICE_HOURS,
  DEFAULT_BACKUP_KEEP,
  EMAIL_VERIFICATION_HOURS,
  JOB_RETENTION_DAYS,
  PASSWORD_RESET_MINUTES,
  POST_TERMINATION_EXPORT_DAYS,
  SESSION_DAYS,
  SUBPROCESSOR_NOTICE_DAYS,
} from '@/lib/retention';
import { SESSION_COOKIE } from '@/lib/auth/session';

const FILLED = {
  LEGAL_COMPANY_NAME: 'Example SAS',
  LEGAL_ADDRESS: '1 Rue Exemple, 75001 Paris, France',
  LEGAL_CONTACT_EMAIL: 'legal@example.com',
  LEGAL_GOVERNING_LAW: 'the laws of France',
  LEGAL_COURTS: 'Paris, France',
  LEGAL_DATA_REGION: 'the European Union (Frankfurt)',
  LEGAL_EMAIL_PROVIDER: 'Postmark',
  LEGAL_STORAGE_PROVIDER: 'Cloudflare R2',
  LEGAL_SUPERVISORY_AUTHORITY: 'the CNIL (France)',
  LEGAL_EFFECTIVE_DATE: '3 November 2026',
};

/** All visible text of a set of sections, as one string. */
function textOf(sections: LegalSection[]): string {
  return sections
    .flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.bullets ?? []), ...(s.after ?? []), ...(s.table ? [...s.table.head, ...s.table.rows.flat()] : [])])
    .join('\n');
}

describe('legal settings', () => {
  it('shows a visible placeholder for every fact that has not been set', () => {
    const config = legalConfig({});
    expect(unresolvedPlaceholders(config).sort()).toEqual(
      ['address', 'company', 'contactEmail', 'courts', 'dataRegion', 'effectiveDate', 'emailProvider', 'governingLaw', 'storageProvider', 'supervisoryAuthority'].sort(),
    );
    expect(config.company).toBe('[company legal name]');
  });

  it('uses the values it is given', () => {
    const config = legalConfig({ ...FILLED });
    expect(unresolvedPlaceholders(config)).toEqual([]);
    expect(config.company).toBe('Example SAS');
    expect(config.contactEmail).toBe('legal@example.com');
  });

  it('falls back to SUPPORT_EMAIL for the contact address', () => {
    const { LEGAL_CONTACT_EMAIL: _omit, ...rest } = FILLED;
    expect(legalConfig({ ...rest, SUPPORT_EMAIL: 'help@example.com' }).contactEmail).toBe('help@example.com');
  });

  it('treats blank values as not set', () => {
    expect(legalConfig({ ...FILLED, LEGAL_COMPANY_NAME: '   ' }).company).toBe('[company legal name]');
  });

  it('keeps the draft notice up unless a reviewer signed off AND nothing is left blank', () => {
    expect(showDraftNotice(legalConfig({}))).toBe(true);
    expect(showDraftNotice(legalConfig({ ...FILLED }))).toBe(true); // filled in, but nobody has reviewed it
    expect(showDraftNotice(legalConfig({ LEGAL_REVIEWED: 'true' }))).toBe(true); // "reviewed" but details missing
    expect(showDraftNotice(legalConfig({ ...FILLED, LEGAL_REVIEWED: 'yes' }))).toBe(true); // only the exact word counts
    expect(showDraftNotice(legalConfig({ ...FILLED, LEGAL_REVIEWED: 'true' }))).toBe(false);
  });

  it('has a version to record with each sign-up', () => {
    expect(TERMS_VERSION).toMatch(/\S/);
  });
});

describe.each([
  ['Privacy Policy', privacySections],
  ['Terms of Service', termsSections],
  ['Data Processing Addendum', dpaSections],
])('%s: structure', (_name, build) => {
  const sections = build(legalConfig({ ...FILLED }));

  it('has uniquely identified, numbered sections that each say something', () => {
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    sections.forEach((s, i) => {
      expect(s.heading.startsWith(`${i + 1}. `) || s.heading.startsWith('Annex ')).toBe(true);
      const content = (s.paragraphs?.length ?? 0) + (s.bullets?.length ?? 0) + (s.table?.rows.length ?? 0);
      expect(content).toBeGreaterThan(0);
    });
  });

  it('puts the company details in, with no placeholder or unfilled template left over', () => {
    const text = textOf(sections);
    expect(text).toContain('Example SAS');
    expect(text).toContain('legal@example.com');
    expect(text).not.toMatch(/\[[a-z ,.]+\]/);
    expect(text).not.toMatch(/undefined|\{\{|\$\{/);
  });

  it('avoids the long dash', () => {
    expect(textOf(sections)).not.toContain('—');
  });

  it('shows placeholders when the facts are missing, so nothing can look finished by accident', () => {
    expect(textOf(build(legalConfig({})))).toContain('[company legal name]');
  });
});

describe('the Privacy Policy matches what the software does', () => {
  const text = textOf(privacySections(legalConfig({ ...FILLED })));

  it('states the retention periods the code enforces', () => {
    expect(text).toContain(`${SESSION_DAYS} days`);
    expect(text).toContain(`${PASSWORD_RESET_MINUTES} minutes`);
    expect(text).toContain(`${EMAIL_VERIFICATION_HOURS} hours`);
    expect(text).toContain(`${JOB_RETENTION_DAYS} days after they finish`);
    expect(text).toContain(`last ${DEFAULT_BACKUP_KEEP} daily encrypted backups`);
    expect(text).toContain(`up to ${DEFAULT_BACKUP_KEEP} days`);
  });

  it('names the real session cookie', () => {
    expect(text).toContain(`"${SESSION_COOKIE}"`);
  });

  it('does not promise that deleted data is gone instantly from backups', () => {
    expect(text).not.toMatch(/no shadow copy/i);
    expect(text).not.toMatch(/immediate and permanent/i);
  });

  it('covers the data that is actually kept', () => {
    for (const needle of ['IP address', 'password', 'Activity records', 'bank statement', 'sub-processors', 'Railway', 'Sentry', 'Anthropic', 'controller', 'processor']) {
      expect(text.toLowerCase()).toContain(needle.toLowerCase());
    }
  });

  it('tells people how to use their rights', () => {
    expect(text).toContain('Download my data');
    expect(text).toContain('Delete my account');
    expect(text).toContain('data protection authority');
  });

  it('promises only what the product delivers on sale of data and training', () => {
    expect(text).toContain('do not sell your data');
    expect(text).toContain('train any AI model');
  });
});

describe('the Terms match how billing works', () => {
  const text = textOf(termsSections(legalConfig({ ...FILLED })));

  it('describes payment by bank transfer, not cards', () => {
    expect(text).toContain('bank transfer');
    expect(text).not.toMatch(/credit card|debit card|auto-?renew(s|al)? automatically/i);
    expect(text).toContain('does not renew automatically');
  });

  it('says a lapsed plan falls back to Free without deleting data', () => {
    expect(text).toContain('returns to the Free plan limits');
    expect(text).toContain('do not delete your data because a payment is late');
  });

  it('is clear the software is not professional advice', () => {
    expect(text).toMatch(/not an accountant, tax adviser or lawyer/);
  });

  it('names the governing law and courts from the settings', () => {
    expect(text).toContain('the laws of France');
    expect(text).toContain('Paris, France');
  });
});

describe('the Data Processing Addendum', () => {
  const sections = dpaSections(legalConfig({ ...FILLED }));
  const text = textOf(sections);
  const src = (file: string) => fs.readFileSync(file, 'utf8');

  it('contains every element Article 28(3) of the GDPR requires', () => {
    const required: Array<[string, RegExp]> = [
      ['subject matter, duration, nature and purpose', /Subject matter[\s\S]*Duration[\s\S]*Nature of the processing[\s\S]*Purpose/],
      ['types of personal data and categories of people', /Types of personal data[\s\S]*People the data is about/],
      ['documented instructions, and warning about unlawful ones', /documented instructions[\s\S]*breaks? Data Protection Law/],
      ['confidentiality of the people with access', /duty of confidentiality/],
      ['security measures (Article 32)', /technical and organisational measures/],
      ['sub-processor conditions', /general authorisation[\s\S]*written contract with each sub-processor/],
      ['help with data subject requests', /exercise rights under Data Protection Law/],
      ['help with security, breach notice, impact assessment, prior consultation', /impact assessments and prior consultation/],
      ['deletion or return at the end', /Return and deletion/],
      ['information and audits', /audit our compliance/],
      ['international transfers', /standard contractual clauses/],
    ];
    for (const [name, pattern] of required) expect(text, name).toMatch(pattern);
  });

  it('uses the same numbers as the code and the Terms', () => {
    expect(text).toContain(`within ${BREACH_NOTICE_HOURS} hours`);
    expect(text).toContain(`${POST_TERMINATION_EXPORT_DAYS} days`);
    expect(text).toContain(`up to ${DEFAULT_BACKUP_KEEP} days`);
    expect(text).toContain(`${SUBPROCESSOR_NOTICE_DAYS} days before we add or replace a sub-processor`);
    expect(textOf(termsSections(legalConfig({ ...FILLED })))).toContain(`at least ${POST_TERMINATION_EXPORT_DAYS} days after we tell you`);
  });

  it('lists exactly the same sub-processors as the Privacy Policy', () => {
    const config = legalConfig({ ...FILLED });
    const annex = dpaSections(config).find((s) => s.id === 'annex-3')!;
    const privacy = privacySections(config).find((s) => s.id === 'share')!;
    expect(annex.table).toEqual(privacy.table);
    expect(annex.table).toEqual(subprocessorTable(config));
  });

  it('is announced from the Terms and the Privacy Policy', () => {
    expect(textOf(termsSections(legalConfig({ ...FILLED })))).toContain('Data Processing Addendum');
    expect(textOf(privacySections(legalConfig({ ...FILLED })))).toContain('Data Processing Addendum');
  });

  it('states the data protection authority and the customer roles', () => {
    expect(text).toContain('the CNIL (France)');
    expect(text).toContain('you are the controller and we are the processor');
  });

  it('claims only security measures the software really has', () => {
    // each claim in Annex II, paired with the place in the code that makes it true
    expect(text).toContain('HTTPS');
    expect(src('next.config.mjs')).toContain('Strict-Transport-Security');
    expect(src('next.config.mjs')).toContain('Content-Security-Policy');
    expect(text).toContain('salted hashes');
    expect(src('src/lib/auth/session.ts')).toContain('bcrypt');
    expect(src('src/lib/auth/session.ts')).toContain('sha256(token)');
    expect(text).toContain('AES-256-GCM');
    expect(src('src/lib/backup.ts')).toContain('aes-256-gcm');
    expect(text).toContain('temporary account lockout');
    expect(src('src/app/api/auth/login/route.ts')).toContain('MAX_FAILED_LOGINS');
    expect(text).toContain('shared across all servers');
    expect(src('src/lib/api.ts')).toContain('rateLimits'); // the shared counters live in the database
    expect(text).toContain('Tests check that one customer cannot reach another');
    expect(fs.existsSync('tests/tenancy.test.ts')).toBe(true);
    expect(text).toContain('personal data, cookies, request bodies and query values are removed');
    expect(src('src/lib/monitoring.ts')).toContain('scrubEvent');
    expect(text).toContain('checked by their real content');
    expect(src('src/lib/storage.ts')).toContain('SIGNATURES');
  });

  it('does not claim certifications or controls the product does not have', () => {
    expect(text).not.toMatch(/two-factor|2fa|multi-factor|penetration test|ISO ?27001|SOC ?2|certified|guarantee/i);
  });

  it('does not describe the customer as having rights it cannot actually use in the product', () => {
    // the Addendum promises self-service export and deletion; check the product offers them
    expect(text).toContain('export or delete Customer Data yourself');
    expect(fs.existsSync('src/app/api/account/export/route.ts')).toBe(true);
    expect(fs.existsSync('src/app/api/account/route.ts')).toBe(true);
  });
});
