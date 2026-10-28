/** Who is at the company on a day: the joiner and leaver rules. FR 06. */

import type { CalendarDate } from '../../calendar/time.js';
import type { Employee } from './employee.js';

/** Why somebody with a record is not at the company on a day. */
export const NOT_LISTED_REASONS = [
  /** Their exit date has passed. */
  'LEFT',
  /** Their start date has not come yet. */
  'NOT_STARTED',
  /** Still employed, and not somebody you can expect to reach. */
  'SUSPENDED',
] as const;

export type NotListedReason = (typeof NOT_LISTED_REASONS)[number];

/**
 * Why somebody is not at the company on this day, or null when they are.
 *
 * The one rule, asked by everything that needs it: the directory's list, the search over it,
 * a profile and the organisation chart, and the job that moves a leaver's reports on.
 *
 * **A joiner is here from their start date**, which is their first day, and not before.
 *
 * **A leaver is here through their exit date and gone the day after.** The exit date is
 * their last day worked, confirmed with HR — and the day the leaver figure of FR 37a is
 * settled on. A record HR has already marked TERMINATED ahead of an exit date still to come
 * is here until that date passes: `checkDatesAgree` allows the paperwork to be done early on
 * purpose, and doing it early does not make the person gone.
 *
 * **A SUSPENDED record is not here**, though still employed: it is nobody you can expect to
 * reach.
 *
 * Dates only, compared as `YYYY-MM-DD` strings against a day the caller supplies, so there is
 * nothing cached to expire: somebody is gone because the date changed, at midnight UTC, the
 * day every other "today" on the server is.
 */
export function whyNotListed(employee: Employee, day: CalendarDate): NotListedReason | null {
  if (hasLeftBy(employee, day)) {
    return 'LEFT';
  }
  if (employee.startDate > day) {
    return 'NOT_STARTED';
  }
  if (employee.employmentStatus === 'SUSPENDED') {
    return 'SUSPENDED';
  }

  return null;
}

/** Whether somebody is at the company on this day. See {@link whyNotListed}. */
export function isCurrentOn(employee: Employee, day: CalendarDate): boolean {
  return whyNotListed(employee, day) === null;
}

/** Whether somebody's last day is behind them on this day. */
export function hasLeftBy(employee: Employee, day: CalendarDate): boolean {
  /* A TERMINATED record always has an exit date (employee_terminated_has_exit_date). The
     null branch is for the type, and answers "gone" rather than "here". */
  return employee.exitDate === null
    ? employee.employmentStatus === 'TERMINATED'
    : employee.exitDate < day;
}
