/** The log of every email sent, over HTTP. Read only. */

import { type Request, type Response, Router } from 'express';
import { actorOf } from '../http/identify.js';
import { OUTBOX_STATUSES, type OutboxEmail, type OutboxStatus } from './outbox.js';
import type { EmailOutbox } from './outbox.service.js';

export interface EmailLogRoutes {
  outbox: EmailOutbox;
}

/** The most a reader is shown at once. */
const LONGEST_PAGE = 500;

export function emailLogRoutes({ outbox }: EmailLogRoutes): Router {
  const routes = Router();

  /**
   * Who was sent which email, when, and what became of it, newest first. `?status=FAILED` for
   * the ones that never arrived, `?kind=WELCOME`, `?employeeId=` for one person's, `?limit=`.
   * The message itself stays on the row: the log is about delivery, not what was said.
   */
  routes.get('/email-log', (request: Request, response: Response, next) => {
    void outbox
      .sent(actorOf(response), {
        status: statusIn(request),
        kind: stringIn(request, 'kind'),
        recipientEmployeeId: employeeIdIn(request),
        limit: limitIn(request),
      })
      .then((emails) => {
        response.json({ emails: emails.map(logEntryAsJson) });
      })
      .catch(next);
  });

  return routes;
}

function logEntryAsJson(email: OutboxEmail): unknown {
  return {
    id: email.id,
    kind: email.kind,
    recipientEmployeeId: email.recipientEmployeeId,
    senderEmployeeId: email.senderEmployeeId,
    to: email.to,
    deliveredTo: email.deliveredTo,
    subject: email.subject,
    status: email.status,
    attempts: email.attempts,
    lastError: email.lastError,
    queuedAt: email.queuedAt.toISOString(),
    sentAt: email.sentAt?.toISOString() ?? null,
    nextAttemptAt: email.nextAttemptAt?.toISOString() ?? null,
    gaveUpAt: email.gaveUpAt?.toISOString() ?? null,
  };
}

function stringIn(request: Request, name: string): string | undefined {
  const value = request.query[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * An employee id, where one was asked for. One that is not digits is nobody, which `0` is,
 * rather than a query that fails or a filter quietly dropped.
 */
function employeeIdIn(request: Request): string | undefined {
  const value = stringIn(request, 'employeeId');
  return value === undefined ? undefined : /^\d{1,18}$/.test(value) ? value : '0';
}

/** A status that is one, or none. Anything else reads as no filter rather than a refusal. */
function statusIn(request: Request): OutboxStatus | undefined {
  const value = stringIn(request, 'status')?.toUpperCase();
  return (OUTBOX_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as OutboxStatus)
    : undefined;
}

function limitIn(request: Request): number {
  const asked = Number(stringIn(request, 'limit') ?? '100');
  return Number.isInteger(asked) && asked > 0 ? Math.min(asked, LONGEST_PAGE) : 100;
}
