/** The staff directory: everybody at the company today, and whether they are in. */

import type { CalendarDate } from '../../core/calendar/time.js';
import type { Department } from '../../core/organisation/department/department.js';
import { isCurrentOn, type NotListedReason } from '../../core/organisation/employee/current.js';
import type { Employee, EmployeeProfile } from '../../core/organisation/employee/employee.js';
import {
  buildOrgChart,
  type OrgChartNode,
  type RootStanding,
} from '../../core/organisation/employee/org-chart.js';

/** Somebody on agreed leave today, and the first day they are expected back. */
export interface AwayToday {
  employeeId: string;
  backOn: CalendarDate;
}

/**
 * Who is away on a day. The port the leave app fills.
 *
 * Declared here rather than imported, so the directory knows nothing of leave and leave
 * nothing of the directory: the composition root hands one to the other, as it does
 * `LeaveThatFollows`. A return date and nothing else crosses it, so a leave type or a
 * reason cannot reach the directory however its screen is drawn.
 */
export interface WhoIsAway {
  awayOn(day: CalendarDate): Promise<AwayToday[]>;
}

/** A department, as the directory names one. */
export interface DepartmentInTheDirectory {
  id: string;
  name: string;
}

/** One person, as everybody at the company may see them. */
export interface DirectoryEntry {
  employeeId: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  department: DepartmentInTheDirectory;
  workEmail: string;
  /** The first day they are expected back, where they are on agreed leave today. */
  backOn: CalendarDate | null;
  /** What they keep themselves, rather than HR. */
  workMobile: string | null;
  description: string | null;
}

/**
 * Somebody's own profile, as they see it to edit it.
 *
 * What everybody sees of them, when they started, which only they are shown, and who they
 * report to.
 */
export interface MyProfile extends DirectoryEntry {
  startDate: CalendarDate;
  manager: {
    employeeId: string;
    firstName: string;
    lastName: string;
    jobTitle: string | null;
  } | null;
}

/** Somebody named on a profile: their manager, or one of their reports. */
export interface PersonInBrief {
  employeeId: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
}

/** Who somebody reports to and who reports to them, among the people current on a day. */
export interface ReportingLine {
  /** Null for the head of the organisation, or where their manager is no longer current. */
  manager: PersonInBrief | null;
  /** By surname. */
  reports: PersonInBrief[];
}

/**
 * One person's profile, as `#/directory/<id>` asks for it.
 *
 * Anybody current, to anybody. Somebody who is not current only to HR, with why and the two
 * dates that decide it; to anybody else they are a 404, the same answer as an id that is
 * nobody.
 *
 * Their reporting line is on it too, which the chart already shows every employee. When they
 * started is not, for anybody current; that stays on their own profile.
 */
export interface DirectoryProfile extends DirectoryEntry, ReportingLine {
  notListed: {
    reason: NotListedReason;
    startDate: CalendarDate;
    exitDate: CalendarDate | null;
  } | null;
}

export interface Directory {
  /** The day "current" and "away" were judged on. */
  today: CalendarDate;
  /** By surname, then first name. */
  people: DirectoryEntry[];
  /** The departments somebody listed is in, by name. A department with nobody in it is not. */
  departments: DepartmentInTheDirectory[];
}

export interface DirectoryFacts {
  /** Everybody it might list; this decides who is current. */
  employees: readonly Employee[];
  departments: readonly Department[];
  away: readonly AwayToday[];
  /** What each person keeps themselves. Somebody with no row here has said nothing. */
  profiles: readonly EmployeeProfile[];
  today: CalendarDate;
}

/* Who the directory lists is the organisation's rule, not the directory's: the job that moves
   a leaver's reports asks the same question. Kept in core and passed on from here. */
export {
  isCurrentOn,
  NOT_LISTED_REASONS,
  type NotListedReason,
  whyNotListed,
} from '../../core/organisation/employee/current.js';

/** Compares names the way a person reads a list: ignoring case and accents. */
const names = new Intl.Collator('en', { sensitivity: 'base' });

/** Surname, then first name, then id, so two people with one name keep one order. */
export function bySurname(
  a: Pick<DirectoryEntry, 'employeeId' | 'firstName' | 'lastName'>,
  b: Pick<DirectoryEntry, 'employeeId' | 'firstName' | 'lastName'>,
): number {
  return (
    names.compare(a.lastName, b.lastName) ||
    names.compare(a.firstName, b.firstName) ||
    a.employeeId.localeCompare(b.employeeId)
  );
}

/** One person, as the directory shows them. */
export function entryFor(
  employee: Employee,
  department: Department | undefined,
  backOn: CalendarDate | undefined,
  profile: EmployeeProfile | undefined,
): DirectoryEntry {
  return {
    employeeId: employee.id,
    firstName: employee.firstName,
    lastName: employee.lastName,
    jobTitle: employee.jobTitle,
    department: {
      id: employee.departmentId,
      /* `department_id` is a NOT NULL foreign key, so the lookup always finds one. The
         fallback is for the type, not for a case that occurs. */
      name: department?.name ?? 'Unknown department',
    },
    workEmail: employee.workEmail,
    backOn: backOn ?? null,
    workMobile: profile?.workMobile ?? null,
    description: profile?.description ?? null,
  };
}

/** The directory, from the facts. */
export function directoryFor(facts: DirectoryFacts): Directory {
  const departments = new Map(facts.departments.map((one) => [one.id, one]));
  const backOn = new Map(facts.away.map((one) => [one.employeeId, one.backOn]));
  const profiles = new Map(facts.profiles.map((one) => [one.employeeId, one]));

  const people = facts.employees
    .filter((employee) => isCurrentOn(employee, facts.today))
    .map((employee) =>
      entryFor(
        employee,
        departments.get(employee.departmentId),
        backOn.get(employee.id),
        profiles.get(employee.id),
      ),
    )
    .sort(bySurname);

  const listed = new Map(people.map((person) => [person.department.id, person.department]));

  return {
    today: facts.today,
    people,
    departments: [...listed.values()].sort((a, b) => names.compare(a.name, b.name)),
  };
}

/**
 * Where somebody sits: their manager and their reports, drawn only from the people current on
 * the day, as the chart is. Somebody who is not current themselves still gets a line, for HR.
 */
export function reportingLineOf(
  employee: Employee,
  everybody: readonly Employee[],
  today: CalendarDate,
): ReportingLine {
  const current = everybody.filter((one) => isCurrentOn(one, today));
  const manager = current.find((one) => one.id === employee.managerId);

  return {
    manager: manager === undefined ? null : inBrief(manager),
    reports: current
      .filter((one) => one.managerId === employee.id)
      .map(inBrief)
      .sort(bySurname),
  };
}

function inBrief(employee: Employee): PersonInBrief {
  return {
    employeeId: employee.id,
    firstName: employee.firstName,
    lastName: employee.lastName,
    jobTitle: employee.jobTitle,
  };
}

/* ------------------------------------------------------------------ the chart */

/** One person on the staff chart, and the people who report to them. */
export interface ChartPerson {
  employeeId: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  reports: ChartPerson[];
}

/** The top of one line on the chart, and why it starts there. */
export interface ChartLine {
  /**
   * `HEAD_OF_THE_ORGANISATION` for the one line that should exist. Any other is a reporting
   * line HR has to put right: a second person with no manager, a manager who is not current,
   * or a line that goes round in a circle.
   */
  standing: RootStanding;
  top: ChartPerson;
}

/**
 * The reporting structure, as every member of staff may see it.
 *
 * HR's chart, `EmployeeService.orgChart()`, keeps leavers on it so that a manager who has
 * left is a name to find. This one is drawn from the people who are current, as the
 * directory is, and the same fault shows up differently: the team of a manager who has left
 * becomes a line of its own, flagged.
 */
export interface StaffChart {
  /** The day "current" was judged on. */
  today: CalendarDate;
  /** The head of the organisation first, then any line that should not stand on its own. */
  lines: ChartLine[];
  /** Everybody on it, which is everybody current: the builder places every one of them. */
  total: number;
}

/** The chart, from the manager relationships of the people who are current. */
export function staffChartFor(employees: readonly Employee[], today: CalendarDate): StaffChart {
  const chart = buildOrgChart(employees.filter((employee) => isCurrentOn(employee, today)));

  return {
    today,
    lines: chart.roots.map((root) => ({ standing: root.standing, top: branchFrom(root.node) })),
    total: chart.total,
  };
}

/**
 * A branch of HR's chart, carrying only what the directory shows of each person.
 *
 * An explicit stack rather than recursion, for the reason the builder has one.
 */
function branchFrom(top: OrgChartNode): ChartPerson {
  const root = personOnTheChart(top.employee);
  const pending: [OrgChartNode, ChartPerson][] = [[top, root]];

  while (pending.length > 0) {
    const [node, person] = pending.pop() as [OrgChartNode, ChartPerson];

    for (const report of node.reports) {
      const drawn = personOnTheChart(report.employee);

      person.reports.push(drawn);
      pending.push([report, drawn]);
    }
  }

  return root;
}

function personOnTheChart(employee: Employee): ChartPerson {
  return {
    employeeId: employee.id,
    firstName: employee.firstName,
    lastName: employee.lastName,
    jobTitle: employee.jobTitle,
    reports: [],
  };
}
