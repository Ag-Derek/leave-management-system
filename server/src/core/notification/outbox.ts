/**
 * Emails queued to be sent, and the rules for trying again.
 *
 * A message is written to the outbox and a job sends it, so a slow or absent mail server never
 * holds up whatever decided the message should go. The same row is the log: who it was to,
 * which email, when, and what became of it.
 */

export const OUTBOX_STATUSES = ['QUEUED', 'SENT', 'FAILED'] as const;

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** One message to queue. */
export interface NewOutboxEmail {
  /** Which email, as `WELCOME`. */
  kind: string;
  /** Who it is for, where that is somebody on the books. */
  recipientEmployeeId: string | null;
  to: string;
  /** "Ama Mensah via Remat Portal", where a person caused it. */
  fromName?: string | null;
  /** Their address, for replies. */
  replyTo?: string | null;
  /** Who caused it, where a person did. */
  senderEmployeeId?: string | null;
  subject: string;
  text: string;
  html: string;
  /**
   * What makes queueing it twice queue it once. A job that runs every hour gives each message it
   * sends a key, so a second run finds the key taken and sends nothing.
   */
  dedupeKey?: string | null;
}

/** One message as the outbox holds it. */
export interface OutboxEmail {
  id: string;
  kind: string;
  recipientEmployeeId: string | null;
  to: string;
  fromName: string | null;
  replyTo: string | null;
  senderEmployeeId: string | null;
  subject: string;
  text: string;
  html: string;
  dedupeKey: string | null;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  /** Where it actually went, which is the override when one is set. */
  deliveredTo: string | null;
  sentAt: Date | null;
  gaveUpAt: Date | null;
  queuedAt: Date;
}

/** A message that could not be queued, and the field that caused it. */
export class InvalidOutboxEmail extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'InvalidOutboxEmail';
    this.field = field;
  }
}

/** Checks a message on its way into the queue. The table refuses the same things. */
export function validateOutboxEmail(email: NewOutboxEmail): NewOutboxEmail {
  if (!/^[A-Z][A-Z_]*$/.test(email.kind)) {
    throw new InvalidOutboxEmail('kind', `${email.kind} is not the name of an email.`);
  }
  if (!/^[^@\s]+@[^@\s]+$/.test(email.to)) {
    throw new InvalidOutboxEmail('to', `${email.to} is not an email address.`);
  }
  if (email.subject.trim() === '') {
    throw new InvalidOutboxEmail('subject', 'An email with no subject line says nothing.');
  }
  if (email.text.trim() === '' || email.html.trim() === '') {
    throw new InvalidOutboxEmail('text', 'An email needs both its plain text and its HTML.');
  }

  return email;
}

/** How long after the first failed send the second is due. */
export const FIRST_RETRY_AFTER_SECONDS = 60;

/** What each wait is multiplied by for the one after it. */
export const BACKOFF_FACTOR = 5;

/**
 * How many sends one message gets, the first included.
 *
 * Six, which is 1m + 5m + 25m + 2h05 + 10h25: a little over thirteen hours, the same as a leave
 * notice, so a mail server that goes down in the evening still delivers before the next morning.
 */
export const ATTEMPTS_ALLOWED = 6;

/**
 * How long a claimed last attempt is held before another run may take it.
 *
 * The last attempt has no next one to schedule, and a process that dies while sending it must
 * not leave the row queued with nothing due.
 */
export const LAST_ATTEMPT_LEASE_SECONDS = 15 * 60;

/** How many messages one run sends, so a backlog cannot hold the mailer all morning. */
export const DRAIN_LIMIT = 200;

/** How long to wait after the nth failed attempt, in seconds. */
export function backoffAfter(attempt: number): number {
  return FIRST_RETRY_AFTER_SECONDS * BACKOFF_FACTOR ** (attempt - 1);
}

/** When the send after this one is due, or null where this was the last. */
export function nextAttemptAfter(attempt: number, at: Date): Date | null {
  if (attempt >= ATTEMPTS_ALLOWED) {
    return null;
  }

  return new Date(at.getTime() + backoffAfter(attempt) * 1000);
}

/** One message one run tried. */
export interface OutboxAttempt {
  id: string;
  kind: string;
  attempt: number;
  sent: boolean;
  /** When it will be tried again, null where it will not be. */
  tryingAgainAt: Date | null;
  /** True where that was the last attempt and it failed. */
  gaveUp: boolean;
}

/** What one run did. */
export interface DrainRun {
  ranAt: Date;
  attempted: readonly OutboxAttempt[];
  /** Taken by another run between being read and being claimed. */
  claimedElsewhere: number;
  /** Still due once the run finished. */
  stillDue: number;
}

/** What one run did, in a sentence, for the log. Undefined where there was nothing to do. */
export function summaryOf(run: DrainRun): string | undefined {
  if (run.attempted.length === 0) {
    return undefined;
  }

  const sent = run.attempted.filter((one) => one.sent).length;
  const retrying = run.attempted.filter((one) => !one.sent && !one.gaveUp).length;
  const gaveUp = run.attempted.filter((one) => one.gaveUp).length;

  return (
    `Email outbox: ${String(run.attempted.length)} tried, ${String(sent)} sent, ` +
    `${String(retrying)} to retry, ${String(gaveUp)} given up after ` +
    `${String(ATTEMPTS_ALLOWED)} attempts. ${String(run.stillDue)} still due.`
  );
}
