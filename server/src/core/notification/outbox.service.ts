/** Queueing an email, sending what is due, and reading back what was sent. */

import type { Actor } from '../auth/actor.js';
import type { Guard } from '../auth/policy.js';
import type { Mailer } from './mailer.js';
import type { EmailOutboxRepository, OutboxLogOptions } from './outbox.db.js';
import {
  DRAIN_LIMIT,
  type DrainRun,
  LAST_ATTEMPT_LEASE_SECONDS,
  type NewOutboxEmail,
  nextAttemptAfter,
  type OutboxAttempt,
  type OutboxEmail,
  validateOutboxEmail,
} from './outbox.js';
import { outboxPolicy } from './policy.js';

/** What became of asking for one message to be sent. */
export interface Queued {
  /** The row, or null where it was already queued or could not be written. */
  email: OutboxEmail | null;
  /** Its dedupe key was taken: a job running twice, and nothing to worry about. */
  alreadyQueued: boolean;
  /** Why it could not be queued, where it could not. */
  couldNotQueue: string | null;
}

/** A message that did not go, as the log wants it. */
export interface UndeliveredEmail {
  at: Date;
  /** Null where it was never queued. */
  emailId: string | null;
  kind: string;
  recipientEmployeeId: string | null;
  stage: 'queue' | 'send';
  because: string;
  /** Which send this was, and zero where it was never queued. */
  attempt: number;
  tryingAgainAt: Date | null;
}

/** Where a message that did not go is recorded. */
export interface OutboxLog {
  record(failure: UndeliveredEmail): void;
}

/** The default: one line of JSON on stderr, as every other failure is. */
export function undeliveredEmailToStderr(): OutboxLog {
  return {
    record(failure) {
      console.error(
        JSON.stringify({
          event: 'email.undelivered',
          at: failure.at.toISOString(),
          emailId: failure.emailId,
          kind: failure.kind,
          recipientEmployeeId: failure.recipientEmployeeId,
          stage: failure.stage,
          because: failure.because,
          attempt: failure.attempt,
          tryingAgainAt: failure.tryingAgainAt?.toISOString() ?? null,
        }),
      );
    },
  };
}

export class EmailOutbox {
  constructor(
    private readonly outbox: EmailOutboxRepository,
    private readonly mailer: Mailer,
    /** NFR SEC 02. */
    private readonly guard: Guard,
    private readonly log: OutboxLog = undeliveredEmailToStderr(),
    /**
     * Told each time something is queued, so the composition root can send it within seconds
     * rather than at the next tick. Never awaited: queueing is done once the row is written.
     */
    private readonly onQueued: () => void = () => {},
  ) {}

  /**
   * Queues one message. Writes a row and returns; nothing here waits on a mail server.
   *
   * Never throws, because by the time anything is queued the change it is about has been
   * saved, and a save must not be reported as failed because an email could not be written.
   * A message that could not be queued is logged and said so.
   */
  async queue(email: NewOutboxEmail): Promise<Queued> {
    try {
      const queued = await this.outbox.queue(validateOutboxEmail(email));

      if (queued === undefined) {
        return { email: null, alreadyQueued: true, couldNotQueue: null };
      }

      this.onQueued();

      return { email: queued, alreadyQueued: false, couldNotQueue: null };
    } catch (error) {
      const because = becauseOf(error);

      this.log.record({
        at: new Date(),
        emailId: null,
        kind: email.kind,
        recipientEmployeeId: email.recipientEmployeeId,
        stage: 'queue',
        because,
        attempt: 0,
        tryingAgainAt: null,
      });

      return { email: null, alreadyQueued: false, couldNotQueue: because };
    }
  }

  /**
   * Sends everything that is due, oldest first. Safe to run again at any time, and two runs
   * at once do not send one message twice: each is claimed before it is sent.
   *
   * Without `asAt`, what is due is decided by the database's clock, the one each row was
   * stamped by; a test passes one to step through the backoff.
   */
  async drain(actor: Actor, asAt?: Date, limit: number = DRAIN_LIMIT): Promise<DrainRun> {
    this.guard.enforce(outboxPolicy.drain(actor));

    const ranAt = new Date();
    const attempted: OutboxAttempt[] = [];
    let claimedElsewhere = 0;

    for (const waiting of await this.outbox.due(asAt ?? null, limit)) {
      const tried = await this.send(waiting, asAt ?? new Date());

      if (tried === null) {
        claimedElsewhere += 1;
      } else {
        attempted.push(tried);
      }
    }

    return {
      ranAt,
      attempted,
      claimedElsewhere,
      stillDue: await this.outbox.countDue(asAt ?? null),
    };
  }

  /**
   * How many of one kind somebody has caused since then, for a limit on how often they may.
   * Unguarded: it is a count about the asker, asked by a service that has already decided they
   * may act.
   */
  async countSentBy(senderEmployeeId: string, kind: string, since: Date): Promise<number> {
    return this.outbox.countSentBy(senderEmployeeId, kind, since);
  }

  /** The log of what was sent, newest first. */
  async sent(actor: Actor, options: OutboxLogOptions = {}): Promise<OutboxEmail[]> {
    this.guard.enforce(outboxPolicy.readLog(actor));

    return this.outbox.log(options);
  }

  /** One send: claim it, make it, stamp what became of it. Null where another run had it. */
  private async send(waiting: OutboxEmail, at: Date): Promise<OutboxAttempt | null> {
    const attempt = waiting.attempts + 1;
    const tryAgainAt = nextAttemptAfter(attempt, at);

    const claimed = await this.outbox.claim(
      waiting.id,
      waiting.attempts,
      tryAgainAt ?? new Date(at.getTime() + LAST_ATTEMPT_LEASE_SECONDS * 1000),
    );

    if (claimed === undefined) {
      return null;
    }

    try {
      const sent = await this.mailer.send({
        to: claimed.to,
        subject: claimed.subject,
        text: claimed.text,
        html: claimed.html,
        ...(claimed.fromName === null ? {} : { fromName: claimed.fromName }),
        ...(claimed.replyTo === null ? {} : { replyTo: claimed.replyTo }),
      });

      await this.stamp(() =>
        this.outbox.recordSent(claimed.id, { at: new Date(), deliveredTo: sent.deliveredTo }),
      );

      return {
        id: claimed.id,
        kind: claimed.kind,
        attempt,
        sent: true,
        tryingAgainAt: null,
        gaveUp: false,
      };
    } catch (error) {
      const because = becauseOf(error);

      this.log.record({
        at,
        emailId: claimed.id,
        kind: claimed.kind,
        recipientEmployeeId: claimed.recipientEmployeeId,
        stage: 'send',
        because,
        attempt,
        tryingAgainAt: tryAgainAt,
      });

      await this.stamp(() => this.outbox.recordFailure(claimed.id, { at, because, tryAgainAt }));

      return {
        id: claimed.id,
        kind: claimed.kind,
        attempt,
        sent: false,
        tryingAgainAt: tryAgainAt,
        gaveUp: tryAgainAt === null,
      };
    }
  }

  /**
   * Records an outcome, and survives not being able to. The claim already moved the next
   * attempt on, so an unrecorded failure is retried and an unrecorded success is, at worst,
   * sent once more when that attempt comes due.
   */
  private async stamp(write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch {
      /* See above. */
    }
  }
}

/** What went wrong, in words, from something that may not be an `Error`. */
function becauseOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
