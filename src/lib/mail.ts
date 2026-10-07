import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';

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

export async function sendPasswordResetEmail(to: string, path: string, ttlMinutes: number): Promise<void> {
  const link = `${appUrl()}${path}`;
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject: 'Reset your Reclip password',
    text: [
      'Someone asked to reset the password for your Reclip account.',
      '',
      `Use this link within ${ttlMinutes} minutes:`,
      link,
      '',
      'If you did not ask for this, you can ignore this email. Your password has not changed.',
    ].join('\n'),
    html: `<p>Someone asked to reset the password for your Reclip account.</p>
<p><a href="${link}">Choose a new password</a><br>This link works for ${ttlMinutes} minutes.</p>
<p style="color:#64748b">If you did not ask for this, you can ignore this email. Your password has not changed.</p>`,
  });
}
