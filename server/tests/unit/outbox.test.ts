import { describe, expect, it } from 'vitest';
import {
  ATTEMPTS_ALLOWED,
  backoffAfter,
  type DrainRun,
  InvalidOutboxEmail,
  type NewOutboxEmail,
  nextAttemptAfter,
  summaryOf,
  validateOutboxEmail,
} from '../../src/core/notification/outbox.js';
import { problemFor } from '../../src/core/http/problems.js';
import { EmailIsMandatory } from '../../src/apps/directory/email.js';

/** The rules the email outbox retries by. The sending itself is ../integration/email.test.ts. */

const EMAIL: NewOutboxEmail = {
  kind: 'WELCOME',
  recipientEmployeeId: '1',
  to: 'esi.appiah@rematholdings.com',
  subject: 'Welcome to Remat, Esi',
  text: 'Hello Esi,',
  html: '<p>Hello Esi,</p>',
};

describe('trying again', () => {
  it('waits a minute, then five times longer each time', () => {
    expect([1, 2, 3, 4, 5].map(backoffAfter)).toEqual([60, 300, 1500, 7500, 37500]);
  });

  it('gives a message six sends, so the last is a little over thirteen hours after the first', () => {
    expect(ATTEMPTS_ALLOWED).toBe(6);

    const total = [1, 2, 3, 4, 5].map(backoffAfter).reduce((sum, wait) => sum + wait, 0);

    expect(total / 3600).toBeGreaterThan(13);
    expect(total / 3600).toBeLessThan(14);
  });

  it('schedules the next send from when this one failed, and none after the sixth', () => {
    const at = new Date('2026-11-02T09:00:00Z');

    expect(nextAttemptAfter(1, at)).toEqual(new Date('2026-11-02T09:01:00Z'));
    expect(nextAttemptAfter(2, at)).toEqual(new Date('2026-11-02T09:05:00Z'));
    expect(nextAttemptAfter(6, at)).toBeNull();
  });
});

describe('what may be queued', () => {
  it('is a named email to an address, with something to say in both parts', () => {
    expect(validateOutboxEmail(EMAIL)).toBe(EMAIL);
  });

  it.each([
    ['kind', { kind: 'welcome' }],
    ['to', { to: 'not an address' }],
    ['subject', { subject: '   ' }],
    ['text', { text: '' }],
    ['text', { html: '' }],
  ])('refuses a bad %s, naming it', (field, change) => {
    expect(() => validateOutboxEmail({ ...EMAIL, ...change })).toThrow(InvalidOutboxEmail);

    try {
      validateOutboxEmail({ ...EMAIL, ...change });
    } catch (error) {
      expect((error as InvalidOutboxEmail).field).toBe(field);
    }
  });
});

describe('what a run says', () => {
  const run = (attempted: DrainRun['attempted']): DrainRun => ({
    ranAt: new Date(),
    attempted,
    claimedElsewhere: 0,
    stillDue: 1,
  });

  it('says nothing when there was nothing to send', () => {
    expect(summaryOf(run([]))).toBeUndefined();
  });

  it('counts what was sent, what will be tried again and what was given up on', () => {
    expect(
      summaryOf(
        run([
          { id: '1', kind: 'WELCOME', attempt: 1, sent: true, tryingAgainAt: null, gaveUp: false },
          {
            id: '2',
            kind: 'WELCOME',
            attempt: 1,
            sent: false,
            tryingAgainAt: new Date(),
            gaveUp: false,
          },
          { id: '3', kind: 'WELCOME', attempt: 6, sent: false, tryingAgainAt: null, gaveUp: true },
        ]),
      ),
    ).toBe('Email outbox: 3 tried, 1 sent, 1 to retry, 1 given up after 6 attempts. 1 still due.');
  });
});

describe('turning off an email that is always sent', () => {
  it('is a 409 that says why, naming the box', () => {
    const { status, body } = problemFor(new EmailIsMandatory('RECORD_CHANGED'));

    expect(status).toBe(409);
    expect(body.error).toBe('EmailIsMandatory');
    expect(body.message).toContain('always sent');
    expect((body as { field?: string }).field).toBe('receives');
  });
});
