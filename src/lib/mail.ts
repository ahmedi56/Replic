import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { makeT } from './i18n/translate';
import { DEFAULT_LOCALE, type Locale } from './i18n/config';

/**
 * Outgoing email over plain SMTP, so any provider works (Gmail, Resend, SendGrid, Mailgun,
 * SES, a company relay). Nothing here is vendor-specific.
 *
 * Configured entirely by environment variables; see `.env.example`.
 */

let transporter: Transporter | null = null;

export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

function getTransporter(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    const user = process.env.SMTP_USER;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // Port 465 is implicit TLS; 587 and 25 upgrade with STARTTLS.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: user ? { user, pass: process.env.SMTP_PASSWORD ?? '' } : undefined,
    });
  }
  return transporter;
}

/** Absolute base URL for links in emails. Never derived from the request, which can be spoofed. */
export function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}

export async function sendPasswordResetEmail(to: string, path: string, ttlMinutes: number, locale: Locale = DEFAULT_LOCALE): Promise<void> {
  const link = `${appUrl()}${path}`;
  const t = makeT(locale);
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject: t('mail.reset.subject'),
    text: [t('mail.reset.intro'), '', t('mail.reset.useLink', { n: ttlMinutes }), link, '', t('mail.reset.ignore')].join('\n'),
    html: `<p>${t('mail.reset.intro')}</p>
<p><a href="${link}">${t('mail.reset.link')}</a><br>${t('mail.reset.valid', { n: ttlMinutes })}</p>
<p style="color:#64748b">${t('mail.reset.ignore')}</p>`,
  });
}

export async function sendVerificationEmail(to: string, path: string, ttlHours: number, locale: Locale = DEFAULT_LOCALE): Promise<void> {
  const link = `${appUrl()}${path}`;
  const t = makeT(locale);
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject: t('mail.verify.subject'),
    text: [t('mail.verify.intro'), '', t('mail.verify.useLink', { n: ttlHours }), link, '', t('mail.verify.ignore')].join('\n'),
    html: `<p>${t('mail.verify.intro')}</p>
<p><a href="${link}">${t('mail.verify.link')}</a><br>${t('mail.verify.valid', { n: ttlHours })}</p>
<p style="color:#64748b">${t('mail.verify.ignore')}</p>`,
  });
}
