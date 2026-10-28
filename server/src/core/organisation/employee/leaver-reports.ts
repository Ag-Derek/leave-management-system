/** A leaver's reports, moved on the day after their last day. FR 06, FR 07, §8.4. */

import type { CalendarDate } from '../../calendar/time.js';
import { hasLeftBy } from './current.js';
import type { Employee } from './employee.js';

/** One report to move, from the leaver to the nearest manager above them still here. */
export interface ReportToMove {
  employeeId: string;
  leaverId: string;
  toId: string;
}

/** One report with nobody to move to, left where they are for HR to place. */
export interface ReportLeftWhereItIs {
  employeeId: string;
  leaverId: string;
  because: string;
}

export interface LeaverReportsPlan {
  moves: ReportToMove[];
  stranded: ReportLeftWhereItIs[];
}

/**
 * Whose manager has left, and who they report to instead.
 *
 * **The leaver's own manager**, which is the decision HR made: somebody whose manager has gone
 * keeps a line upward rather than hanging off nobody, and the person above the leaver already
 * answers for the whole branch. Where that person has gone too, or is not ACTIVE, the walk
 * carries on upward to the nearest one who is — the same thing `EmployeeService.checkManager`
 * would refuse otherwise.
 *
 * **On the day after the exit date and not before.** The exit date is the leaver's last day
 * worked, and until it passes they are still the manager: approving leave in their notice
 * period is part of handing over.
 *
 * **Only people who are themselves still here move.** A report who has left too keeps the
 * manager they had, which is their history.
 *
 * Nobody to move to is said rather than guessed: a leaver who headed the organisation has
 * nobody above them, and choosing who takes their reports is HR's decision.
 */
export function planLeaverReports(
  employees: readonly Employee[],
  today: CalendarDate,
): LeaverReportsPlan {
  const byId = new Map(employees.map((employee) => [employee.id, employee]));
  const moves: ReportToMove[] = [];
  const stranded: ReportLeftWhereItIs[] = [];

  for (const employee of employees) {
    const leaver = employee.managerId === null ? undefined : byId.get(employee.managerId);

    if (leaver === undefined || !hasLeftBy(leaver, today) || hasLeftBy(employee, today)) {
      continue;
    }

    const to = nearestStillHereAbove(leaver, byId, today);

    if (to === null || to.id === employee.id) {
      stranded.push({
        employeeId: employee.id,
        leaverId: leaver.id,
        because:
          leaver.managerId === null
            ? `${fullName(leaver)} headed the organisation, so nobody is above them to take ` +
              `${fullName(employee)}. HR has to choose who does.`
            : `Nobody above ${fullName(leaver)} is still here to take ${fullName(employee)}. ` +
              `HR has to choose who does.`,
      });
    } else {
      moves.push({ employeeId: employee.id, leaverId: leaver.id, toId: to.id });
    }
  }

  return { moves, stranded };
}

/**
 * The first manager above a leaver who is ACTIVE and has not left, or null.
 *
 * Walked upward, remembering where it has been, for the reason every walk of the reporting
 * line here is: a loop the database should never hold is infinitely deep to a walk that does
 * not.
 */
function nearestStillHereAbove(
  leaver: Employee,
  byId: ReadonlyMap<string, Employee>,
  today: CalendarDate,
): Employee | null {
  const walked = new Set<string>([leaver.id]);
  let at = leaver;

  for (;;) {
    const above = at.managerId === null ? undefined : byId.get(at.managerId);

    if (above === undefined || walked.has(above.id)) {
      return null;
    }
    if (above.employmentStatus === 'ACTIVE' && !hasLeftBy(above, today)) {
      return above;
    }

    walked.add(above.id);
    at = above;
  }
}

function fullName(employee: Employee): string {
  return `${employee.firstName} ${employee.lastName}`;
}
