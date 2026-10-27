/** The staff directory: everybody at the company today, and whether they are in. */

import type { CalendarDate } from '../../core/calendar/time.js';
import type { Department } from '../../core/organisation/department/department.js';
import type { Employee } from '../../core/organisation/employee/employee.js';

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
  today: CalendarDate;
}

/**
 * Whether somebody is at the company on this day.
 *
 * ACTIVE, started, and not yet gone. The exit date is their last day, so they are still
 * listed on it. A SUSPENDED record is still employed but is not listed: the directory is
 * who you can expect to reach.
 */
export function isCurrentOn(employee: Employee, day: CalendarDate): boolean {
  return (
    employee.employmentStatus === 'ACTIVE' &&
    employee.startDate <= day &&
    (employee.exitDate === null || employee.exitDate >= day)
  );
}

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

/** The directory, from the facts. */
export function directoryFor(facts: DirectoryFacts): Directory {
  const departments = new Map(facts.departments.map((one) => [one.id, one]));
  const backOn = new Map(facts.away.map((one) => [one.employeeId, one.backOn]));

  const people = facts.employees
    .filter((employee) => isCurrentOn(employee, facts.today))
    .map((employee): DirectoryEntry => ({
      employeeId: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      jobTitle: employee.jobTitle,
      department: {
        id: employee.departmentId,
        /* `department_id` is a NOT NULL foreign key, so the lookup always finds one. The
             fallback is for the type, not for a case that occurs. */
        name: departments.get(employee.departmentId)?.name ?? 'Unknown department',
      },
      workEmail: employee.workEmail,
      backOn: backOn.get(employee.id) ?? null,
    }))
    .sort(bySurname);

  const listed = new Map(people.map((person) => [person.department.id, person.department]));

  return {
    today: facts.today,
    people,
    departments: [...listed.values()].sort((a, b) => names.compare(a.name, b.name)),
  };
}
