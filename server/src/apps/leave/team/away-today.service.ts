/** Who is on agreed leave today, and when each of them is back. */

import { type CalendarDate, isoWeekdayOf } from '../../../core/calendar/time.js';
import { worksOn } from '../../../core/calendar/work-pattern/work-pattern.js';
import type { WorkPatternRepository } from '../../../core/calendar/work-pattern/work-pattern.db.js';
import type { EmployeeRepository } from '../../../core/organisation/employee/employee.db.js';
import type { HolidayRepository } from '../holiday/holiday.db.js';
import type { LeaveRequestRepository } from '../leave-request/leave-request.db.js';
import { firstDayBack } from './away-today.js';

/** Somebody away, and the day they are back. Dates only. */
export interface AwayOnADay {
  employeeId: string;
  backOn: CalendarDate;
}

/**
 * What the directory's `WhoIsAway` port is filled with.
 *
 * Not imported by the directory and not importing it: the two shapes match, and the
 * composition root hands this to it. Agreed leave only, because a request still being
 * decided is not an absence anybody should plan a phone call around.
 *
 * **No leave type repository here, and that is the privacy rule**, as on the team calendar: a
 * type name cannot be sent by a service that never reads the table.
 */
export class AwayTodayService {
  constructor(
    private readonly requests: LeaveRequestRepository,
    /** Whose week each person works. */
    private readonly employees: EmployeeRepository,
    /** FR 23. */
    private readonly patterns: WorkPatternRepository,
    /** FR 22. Nobody is back on a day the office is closed. */
    private readonly holidays: HolidayRepository,
  ) {}

  async awayOn(day: CalendarDate): Promise<AwayOnADay[]> {
    const covering = await this.requests.agreedLeaveCovering(day);
    const awayIds = [...new Set(covering.map((one) => one.employeeId))];

    if (awayIds.length === 0) {
      return [];
    }

    const [agreed, people, patterns, holidays] = await Promise.all([
      this.requests.agreedLeaveFrom(awayIds, day),
      this.employees.findAllById(awayIds),
      this.patterns.list(),
      this.holidays.list({ from: day }),
    ]);

    const patternById = new Map(patterns.map((one) => [one.id, one]));
    const closed = new Set(holidays.map((one) => one.date));

    return people.flatMap((person) => {
      const pattern = patternById.get(person.workPatternId);

      const backOn = firstDayBack(
        agreed.filter((one) => one.employeeId === person.id),
        (on) => !closed.has(on) && (pattern === undefined || worksOn(pattern, isoWeekdayOf(on))),
        day,
      );

      return backOn === undefined ? [] : [{ employeeId: person.id, backOn }];
    });
  }
}
