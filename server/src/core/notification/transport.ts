import nodemailer, { type Transporter } from 'nodemailer';

/** Outbound mail. */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /**
   * The name shown as the sender, as "Ama Mensah via Remat Portal", where a person caused the
   * message. The address is always `MAIL_FROM_ADDRESS`: nothing is sent as a colleague's mailbox.
   */
  fromName?: string;
  /** Where a reply goes, which is that person's own address. */
  replyTo?: string;
}

export interface SentMail {
  messageId: string;
  /** Where it actually went, which is not `to` when the override is set. */
  deliveredTo: string;
  redirected: boolean;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export function createTransport(): Transporter {
  return nodemailer.createTransport({
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    secure: process.env.SMTP_SECURE === 'true',
    // Mailpit wants no credentials at all. Sending an empty user makes it
    // negotiate authentication that is not configured.
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' }
      : undefined,
  });
}

export function fromAddress(fromName?: string): string {
  const name = displayName(fromName ?? process.env.MAIL_FROM_NAME ?? '');
  const address = required('MAIL_FROM_ADDRESS');
  return name ? `"${name}" <${address}>` : address;
}

/** A sender's name made safe to quote in a header: one line, no quotes or brackets. */
function displayName(name: string): string {
  return name
    .replace(/[\r\n"\\<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The safety net from .env.example. When MAIL_OVERRIDE_RECIPIENT is set every
 * message goes there instead of the real recipient, so pointing a non
 * production environment at a copy of real staff data cannot mail real staff.
 *
 * The intended recipient is preserved in a header rather than discarded, so it
 * is still visible in Mailpit when working out who would have received what.
 */
export async function sendMail(transport: Transporter, mail: Mail): Promise<SentMail> {
  const override = process.env.MAIL_OVERRIDE_RECIPIENT;
  const deliveredTo = override || mail.to;

  const info = await transport.sendMail({
    from: fromAddress(mail.fromName),
    to: deliveredTo,
    replyTo: mail.replyTo,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    headers: override ? { 'X-Intended-Recipient': mail.to } : undefined,
  });

  return {
    messageId: info.messageId,
    deliveredTo,
    redirected: Boolean(override),
  };
}
