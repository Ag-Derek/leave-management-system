/** Sending mail, as one thing a service can be handed. */

import type { Transporter } from 'nodemailer';
import { resendSends } from './resend-transport.js';
import { createTransport, type Mail, type SentMail, sendMail } from './transport.js';

export interface Mailer {
  send(mail: Mail): Promise<SentMail>;
  /** Releases whatever is held open. */
  close(): void;
}

/**
 * The real one, over whichever transport the environment offers.
 *
 * `RESEND_API_KEY` sends over HTTPS, which is what production uses: a host that blocks
 * outbound SMTP leaves the connection hanging, and a sign in code that never arrives locks
 * out everybody who needs one. Without it, SMTP — which is Mailpit in development and every
 * existing test.
 *
 * Chosen here rather than asked about anywhere else, as the storage and scanner drivers are.
 * Outside production it refuses any arrangement that could reach a real mailbox; see
 * {@link checkMailStaysHere}.
 */
export function createMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  checkMailStaysHere(env);

  const apiKey = env.RESEND_API_KEY;

  if (apiKey) {
    const send = resendSends(apiKey);

    return {
      send,
      /* Nothing is held open: each message is one request. */
      close(): void {},
    };
  }

  let transport: Transporter | undefined;

  return {
    async send(mail: Mail): Promise<SentMail> {
      transport ??= createTransport();
      return sendMail(transport, mail);
    },
    close(): void {
      transport?.close();
      transport = undefined;
    },
  };
}

/** The hosts a development SMTP server may be on: this machine, or the Mailpit container. */
const LOCAL_MAIL_HOSTS = ['localhost', '127.0.0.1', '::1', 'mailpit'];

/**
 * Refuses to start where mail could reach a real person from anywhere but production.
 *
 * Outside production one of two things must be true: every message goes to
 * `MAIL_OVERRIDE_RECIPIENT`, or it goes to an SMTP server on this machine, which is Mailpit.
 * Resend with no override, or SMTP to a real server, is a development copy of the directory
 * mailing real staff, so the process stops rather than sends. `NODE_ENV` unset is development.
 */
export function checkMailStaysHere(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' || env.MAIL_OVERRIDE_RECIPIENT) {
    return;
  }

  if (env.RESEND_API_KEY) {
    throw new Error(
      'RESEND_API_KEY is set outside production with no MAIL_OVERRIDE_RECIPIENT, so mail ' +
        'would go to real people. Set MAIL_OVERRIDE_RECIPIENT to a safe inbox, or clear ' +
        'RESEND_API_KEY to use Mailpit. See docs/development.md.',
    );
  }

  const host = (env.SMTP_HOST ?? '').trim().toLowerCase();

  if (host !== '' && !LOCAL_MAIL_HOSTS.includes(host)) {
    throw new Error(
      `SMTP_HOST is ${host} outside production with no MAIL_OVERRIDE_RECIPIENT, so mail ` +
        'would go to real people. Point SMTP_HOST at Mailpit (npm run mail), or set ' +
        'MAIL_OVERRIDE_RECIPIENT to a safe inbox. See docs/development.md.',
    );
  }
}
