/** When somebody on leave today is back. */

import { type CalendarDate, dayAfter } from '../../../core/calendar/time.js';
import type { LeavePeriod } from '../leave-calculator/leave-calculator.js';

/**
 * How far ahead the walk looks before giving up.
 *
 * A pattern always works at least one day a week, so the walk finds a working day within a
 * week of the last day of leave unless holidays fill that week. This is the guard against a
 * holiday calendar that somehow covered every day, not a limit anybody meets.
 */
const LOOK_AHEAD_DAYS = 400;

/**
 * The first day somebody on agreed leave today is expected back, or undefined if they are in.
 *
 * The day after the leave ends, moved on past anything that is not a working day for them
 * (their week, and the public holidays) and past any agreed leave that starts where this
 * ends. Leave that runs into more leave is one absence to a colleague, however many
 * requests it was asked for in.
 *
 * `agreed` is this person's agreed leave, in any order. Both ends of each period are
 * inclusive, as every period in this schema is.
 */
export function firstDayBack(
  agreed: readonly LeavePeriod[],
  isWorkingDay: (day: CalendarDate) => boolean,
  today: CalendarDate,
): CalendarDate | undefined {
  const covering = (day: CalendarDate) => agreed.find((one) => one.from <= day && day <= one.to);

  const now = covering(today);

  if (now === undefined) {
    return undefined;
  }

  let day = dayAfter(now.to);

  for (let looked = 0; looked < LOOK_AHEAD_DAYS; looked += 1) {
    const more = covering(day);

    if (more !== undefined) {
      day = dayAfter(more.to);
    } else if (isWorkingDay(day)) {
      return day;
    } else {
      day = dayAfter(day);
    }
  }

  return day;
}
