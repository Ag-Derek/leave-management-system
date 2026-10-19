/**
 * Leave somebody is planning to take, shared for planning.
 *
 * Holds no days and goes to no approver. The department, the manager and HR see its dates on
 * the team calendar; the kind of leave and the note stay with the person.
 */

import { type CalendarDate, isCalendarDate } from '../../shared/time.js';

export interface LeavePlan {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  from: CalendarDate;
  to: CalendarDate;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A plan as a form sent it. */
export interface PlanAsSent {
  leaveTypeId?: unknown;
  from?: unknown;
  to?: unknown;
  note?: unknown;
}

export interface ValidatedPlan {
  leaveTypeId: string;
  from: CalendarDate;
  to: CalendarDate;
  note: string | null;
}

/** The longest note accepted. */
export const LONGEST_PLAN_NOTE = 500;

/** A plan that could not be saved, naming the field. */
export class InvalidPlan extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'InvalidPlan';
    this.field = field;
  }
}

/** A plan that is not this person's, or not there. Said the same way either way. */
export class PlanNotFound extends Error {
  constructor(id: string) {
    super(`There is no plan ${id} of yours.`);
    this.name = 'PlanNotFound';
  }
}

/** Two of one person's plans over the same days. */
export class PlansOverlap extends Error {
  constructor() {
    super(
      'You already have a plan over some of these days. Change that one, or pick dates ' +
        'around it.',
    );
    this.name = 'PlansOverlap';
  }
}

/** Checks a plan as sent. `today` decides what is still to come. */
export function validatePlan(sent: PlanAsSent, today: CalendarDate): ValidatedPlan {
  const leaveTypeId = typeof sent.leaveTypeId === 'string' ? sent.leaveTypeId.trim() : '';

  if (leaveTypeId === '') {
    throw new InvalidPlan('leaveTypeId', 'Choose the kind of leave you are planning.');
  }

  if (!isCalendarDate(sent.from)) {
    throw new InvalidPlan('from', 'Choose the first day of the plan.');
  }

  if (!isCalendarDate(sent.to)) {
    throw new InvalidPlan('to', 'Choose the last day of the plan.');
  }

  if (sent.to < sent.from) {
    throw new InvalidPlan('to', 'The last day is before the first.');
  }

  if (sent.to < today) {
    throw new InvalidPlan('to', 'A plan is for leave still to come, and these dates have passed.');
  }

  const note = typeof sent.note === 'string' ? sent.note.trim() : '';

  if (note.length > LONGEST_PLAN_NOTE) {
    throw new InvalidPlan(
      'note',
      `The note is ${String(note.length)} characters, and the longest accepted is ` +
        `${String(LONGEST_PLAN_NOTE)}.`,
    );
  }

  return { leaveTypeId, from: sent.from, to: sent.to, note: note === '' ? null : note };
}
