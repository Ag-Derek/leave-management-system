/** Who covers for somebody while they are on leave, and for which of its days. #226. */

import { type CalendarDate, formatDay, isCalendarDate } from '../../../core/calendar/time.js';
import type { LeavePeriod } from '../leave-calculator/leave-calculator.js';

/** The most parts one piece of leave may be split into. */
export const MOST_PARTS = 10;

/** One colleague covering one stretch of the leave, as it is asked for. */
export interface CoverPart {
  coverId: string;
  /** Inclusive at both ends, as every period here. */
  from: CalendarDate;
  to: CalendarDate;
}

/** One stretch, as it is stored. */
export interface NamedCover extends CoverPart {
  id: string;
  leaveRequestId: string;
  namedBy: string;
  namedAt: Date;
}

/** Days somebody named as cover is away themselves. A warning, never a refusal. */
export interface CoverClash {
  coverId: string;
  from: CalendarDate;
  to: CalendarDate;
}

/** Somebody on agreed leave today, and who to contact instead. What the directory is told. */
export interface CoverInForce {
  /** Whose leave it is. */
  employeeId: string;
  coverId: string;
}

/** Leave somebody is covering, cut to what is left of it. */
export interface CoverDuty {
  /** Whose leave it is. */
  absenteeId: string;
  from: CalendarDate;
  to: CalendarDate;
  /** Whether the leave has been agreed, or is still being decided. */
  agreed: boolean;
}

/** Cover the record cannot hold. Answered 400, beside the field it names. */
export class InvalidCover extends Error {
  readonly code = 'INVALID_COVER';
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'InvalidCover';
    this.field = field;
  }
}

/** Cover naming the person whose leave it is. */
export class CoverIsTheAbsentee extends Error {
  readonly code = 'COVER_IS_THE_ABSENTEE';
  readonly field = 'coverId';

  constructor() {
    super(
      'Cover is the colleague people contact while you are away, so it cannot be you. ' +
        'Choose somebody else.',
    );
    this.name = 'CoverIsTheAbsentee';
  }
}

/** A colleague who will not be at the company for the days they would cover. */
export class CoverNotAtTheCompany extends Error {
  readonly code = 'COVER_NOT_AT_THE_COMPANY';
  readonly field = 'coverId';

  constructor(name: string, why: string) {
    super(`${name} ${why}, so they cannot cover. Choose somebody who will be here.`);
    this.name = 'CoverNotAtTheCompany';
  }
}

/** Leave whose cover can no longer be named or changed. */
export class CoverCannotBeChanged extends Error {
  readonly code = 'COVER_CANNOT_BE_CHANGED';

  constructor(why: 'ENDED' | 'OVER') {
    super(
      why === 'ENDED'
        ? 'This leave has been withdrawn, cancelled or turned down, so nobody covers it.'
        : 'This leave is over, so there is nobody left to cover it.',
    );
    this.name = 'CoverCannotBeChanged';
  }
}

/**
 * Checks the cover asked for one piece of leave, soonest first.
 *
 * Every part inside the leave, by somebody other than the person away, and no day covered
 * twice. An empty list is no cover at all, which is how cover is cleared.
 */
export function validateCoverParts(
  body: unknown,
  leave: LeavePeriod & { employeeId: string },
): CoverPart[] {
  const sent = (body as { parts?: unknown } | null)?.parts;

  if (!Array.isArray(sent)) {
    throw new InvalidCover(
      'parts',
      'Send the cover as a list of parts, each saying who covers and from when to when.',
    );
  }

  if (sent.length > MOST_PARTS) {
    throw new InvalidCover(
      'parts',
      `Cover can be split into at most ${String(MOST_PARTS)} parts. Join some of them up.`,
    );
  }

  const parts = sent
    .map((one) => partFrom(one, leave))
    .sort((a, b) => a.from.localeCompare(b.from));

  for (let at = 1; at < parts.length; at += 1) {
    if (parts[at].from <= parts[at - 1].to) {
      throw new InvalidCover(
        'parts',
        `Two parts of the cover both include ${formatDay(parts[at].from)}. Name one person ` +
          'for each day.',
      );
    }
  }

  return parts;
}

/**
 * What naming this cover changes: the parts already standing exactly as asked are kept, so
 * nobody is told twice, the rest end, and whatever is new is written.
 */
export function changesTo(
  standing: readonly NamedCover[],
  wanted: readonly CoverPart[],
): { keep: NamedCover[]; end: NamedCover[]; add: CoverPart[] } {
  const same = (a: CoverPart, b: CoverPart) =>
    a.coverId === b.coverId && a.from === b.from && a.to === b.to;

  return {
    keep: standing.filter((one) => wanted.some((part) => same(one, part))),
    end: standing.filter((one) => !wanted.some((part) => same(one, part))),
    add: wanted.filter((part) => !standing.some((one) => same(one, part))),
  };
}

/** The part of some cover inside the leave, or null where none of it is. */
export function insideTheLeave<T extends CoverPart>(cover: T, leave: LeavePeriod): T | null {
  const from = cover.from > leave.from ? cover.from : leave.from;
  const to = cover.to < leave.to ? cover.to : leave.to;

  return from > to ? null : { ...cover, from, to };
}

/**
 * The days each part's cover is away themselves, from their own live leave.
 *
 * Live rather than agreed: a colleague who has asked for the same week is as likely to be
 * gone as one who has been granted it.
 */
export function clashesBetween(
  parts: readonly CoverPart[],
  theirLeave: readonly (LeavePeriod & { employeeId: string })[],
): CoverClash[] {
  return parts
    .flatMap((part) =>
      theirLeave
        .filter((leave) => leave.employeeId === part.coverId)
        .map((leave) => insideTheLeave(part, leave))
        .filter((clash): clash is CoverPart => clash !== null)
        .map(({ coverId, from, to }) => ({ coverId, from, to })),
    )
    .sort((a, b) => a.from.localeCompare(b.from) || a.coverId.localeCompare(b.coverId));
}

function partFrom(value: unknown, leave: LeavePeriod & { employeeId: string }): CoverPart {
  if (typeof value !== 'object' || value === null) {
    throw new InvalidCover(
      'parts',
      'Each part of the cover says who covers and from when to when.',
    );
  }

  const { coverId, from, to } = value as Record<string, unknown>;

  if (typeof coverId !== 'string' || coverId.trim() === '') {
    throw new InvalidCover('coverId', 'Choose who covers.');
  }

  if (!isCalendarDate(from)) {
    throw new InvalidCover('from', 'The first day of cover is a date in the form YYYY-MM-DD.');
  }

  if (!isCalendarDate(to)) {
    throw new InvalidCover('to', 'The last day of cover is a date in the form YYYY-MM-DD.');
  }

  if (to < from) {
    throw new InvalidCover('to', `Cover cannot end on ${formatDay(to)}, before it starts.`);
  }

  if (from < leave.from || to > leave.to) {
    throw new InvalidCover(
      from < leave.from ? 'from' : 'to',
      `Cover is for days of the leave, which runs from ${formatDay(leave.from)} to ` +
        `${formatDay(leave.to)}.`,
    );
  }

  if (coverId.trim() === leave.employeeId) {
    throw new CoverIsTheAbsentee();
  }

  return { coverId: coverId.trim(), from, to };
}
