/** Database access for the email outbox: the queue, and the log of what was sent. */

import { type Kysely, type Selectable, sql } from 'kysely';
import type { Database } from '../db/index.js';
import type { EmailOutboxTable } from '../db/schema.js';
import type { NewOutboxEmail, OutboxEmail, OutboxStatus } from './outbox.js';

type OutboxRow = Selectable<EmailOutboxTable>;

/** What a reader narrows the log by. */
export interface OutboxLogOptions {
  status?: OutboxStatus;
  kind?: string;
  recipientEmployeeId?: string;
  /** How many, newest first. */
  limit?: number;
}

export class EmailOutboxRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Queues one message, due at once. Undefined where its dedupe key is already taken, which is
   * a job running twice rather than anything wrong.
   */
  async queue(email: NewOutboxEmail): Promise<OutboxEmail | undefined> {
    const row = await this.db
      .insertInto('email_outbox')
      .values({
        kind: email.kind,
        recipient_employee_id: email.recipientEmployeeId,
        to_address: email.to,
        from_name: email.fromName ?? null,
        reply_to: email.replyTo ?? null,
        sender_employee_id: email.senderEmployeeId ?? null,
        subject: email.subject,
        text_body: email.text,
        html_body: email.html,
        dedupe_key: email.dedupeKey ?? null,
      })
      .onConflict((conflict) => conflict.column('dedupe_key').doNothing())
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : toEmail(row);
  }

  /**
   * Messages due a send, oldest due first. Read only: {@link claim} is what takes one.
   *
   * Null is the database's own now, which is what a row was stamped with when it was queued:
   * the application's clock has only milliseconds and may be behind the server's, and either
   * would leave a message queued a moment ago waiting a minute for the next run.
   */
  async due(asAt: Date | null, limit: number): Promise<OutboxEmail[]> {
    const rows = await this.db
      .selectFrom('email_outbox')
      .selectAll()
      .where('status', '=', 'QUEUED')
      .where('next_attempt_at', '<=', asAt ?? sql<Date>`now()`)
      .orderBy('next_attempt_at')
      .limit(limit)
      .execute();

    return rows.map(toEmail);
  }

  /**
   * Takes one due message, counting the attempt and scheduling the one after it.
   *
   * Claimed before the send rather than after, so a process that dies mid-send leaves a message
   * that comes due again rather than one nobody looks at. `seenAttempts` is what makes two runs
   * safe: the second finds the count already moved and gets nothing.
   */
  async claim(
    id: string,
    seenAttempts: number,
    dueAgainAt: Date,
  ): Promise<OutboxEmail | undefined> {
    const row = await this.db
      .updateTable('email_outbox')
      .set({ attempts: seenAttempts + 1, next_attempt_at: dueAgainAt })
      .where('id', '=', id)
      .where('status', '=', 'QUEUED')
      .where('attempts', '=', seenAttempts)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : toEmail(row);
  }

  /** Stamps a delivery. */
  async recordSent(id: string, sent: { at: Date; deliveredTo: string }): Promise<void> {
    await this.db
      .updateTable('email_outbox')
      .set({
        status: 'SENT',
        sent_at: sent.at,
        delivered_to: sent.deliveredTo,
        next_attempt_at: null,
      })
      .where('id', '=', id)
      .execute();
  }

  /** Stamps a failed attempt: due again at `tryAgainAt`, or given up on where that is null. */
  async recordFailure(
    id: string,
    failure: { at: Date; because: string; tryAgainAt: Date | null },
  ): Promise<void> {
    await this.db
      .updateTable('email_outbox')
      .set(
        failure.tryAgainAt === null
          ? {
              status: 'FAILED',
              last_error: failure.because,
              gave_up_at: failure.at,
              next_attempt_at: null,
            }
          : { last_error: failure.because, next_attempt_at: failure.tryAgainAt },
      )
      .where('id', '=', id)
      .execute();
  }

  /** How many are due a send. Null is the database's now, as for {@link due}. */
  async countDue(asAt: Date | null): Promise<number> {
    const row = await this.db
      .selectFrom('email_outbox')
      .select(({ fn }) => fn.countAll<string>().as('due'))
      .where('status', '=', 'QUEUED')
      .where('next_attempt_at', '<=', asAt ?? sql<Date>`now()`)
      .executeTakeFirstOrThrow();

    return Number(row.due);
  }

  /** How many of one kind this person has caused since then. */
  async countSentBy(senderEmployeeId: string, kind: string, since: Date): Promise<number> {
    const row = await this.db
      .selectFrom('email_outbox')
      .select(({ fn }) => fn.countAll<string>().as('sent'))
      .where('sender_employee_id', '=', senderEmployeeId)
      .where('kind', '=', kind)
      .where('queued_at', '>=', since)
      .executeTakeFirstOrThrow();

    return Number(row.sent);
  }

  /** The log, newest first. */
  async log(options: OutboxLogOptions = {}): Promise<OutboxEmail[]> {
    let query = this.db.selectFrom('email_outbox').selectAll();

    if (options.status !== undefined) {
      query = query.where('status', '=', options.status);
    }
    if (options.kind !== undefined) {
      query = query.where('kind', '=', options.kind);
    }
    if (options.recipientEmployeeId !== undefined) {
      query = query.where('recipient_employee_id', '=', options.recipientEmployeeId);
    }

    const rows = await query
      .orderBy('queued_at', 'desc')
      .orderBy('id', 'desc')
      .limit(options.limit ?? 100)
      .execute();

    return rows.map(toEmail);
  }

  async findById(id: string): Promise<OutboxEmail | undefined> {
    const row = await this.db
      .selectFrom('email_outbox')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? undefined : toEmail(row);
  }
}

function toEmail(row: OutboxRow): OutboxEmail {
  return {
    id: row.id,
    kind: row.kind,
    recipientEmployeeId: row.recipient_employee_id,
    to: row.to_address,
    fromName: row.from_name,
    replyTo: row.reply_to,
    senderEmployeeId: row.sender_employee_id,
    subject: row.subject,
    text: row.text_body,
    html: row.html_body,
    dedupeKey: row.dedupe_key,
    /* `email_outbox_status_known` is what makes the cast safe. */
    status: row.status as OutboxStatus,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    deliveredTo: row.delivered_to,
    sentAt: row.sent_at,
    gaveUpAt: row.gave_up_at,
    queuedAt: row.queued_at,
  };
}
