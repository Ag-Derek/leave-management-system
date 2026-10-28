/** The staff directory, assembled. */

import type { Actor } from '../../core/auth/actor.js';
import type { Guard } from '../../core/auth/policy.js';
import { type CalendarDate, calendarDateIn } from '../../core/calendar/time.js';
import type { DepartmentRepository } from '../../core/organisation/department/department.db.js';
import { EmployeeNotFound } from '../../core/organisation/employee/employee.js';
import type { EmployeeRepository } from '../../core/organisation/employee/employee.db.js';
import {
  type Directory,
  directoryFor,
  entryFor,
  type MyProfile,
  type StaffChart,
  staffChartFor,
  type WhoIsAway,
} from './directory.js';
import { directoryPolicy } from './policy.js';
import { validateProfileEdit } from './profile.js';

export class DirectoryService {
  constructor(
    /** NFR SEC 02. */
    private readonly guard: Guard,
    private readonly employees: EmployeeRepository,
    /** The name each person's department goes by. */
    private readonly departments: DepartmentRepository,
    /** Who is on agreed leave. Absent, nobody is marked away. */
    private readonly away?: WhoIsAway,
    /** Today, in UTC, which is the day the database's `current_date` is having. NFR DAT 03. */
    private readonly today: () => CalendarDate = () => calendarDateIn(new Date(), 'UTC'),
  ) {}

  /**
   * Everybody at the company today, with whoever is away marked.
   *
   * The whole list in one answer, and the searching is the screen's: a company this size is a
   * few hundred rows, and a search that asked the server on every keystroke would be slower
   * to answer the question it was asked than reading the list once.
   */
  async read(actor: Actor): Promise<Directory> {
    this.guard.enforce(directoryPolicy.read(actor));

    const today = this.today();

    const [employees, departments, away] = await Promise.all([
      this.employees.list({ activeOnly: true }),
      this.departments.list(),
      this.away === undefined ? [] : this.away.awayOn(today),
    ]);

    const profiles = await this.employees.profilesOf(employees.map((one) => one.id));

    return directoryFor({ employees, departments, away, profiles, today });
  }

  /**
   * Who reports to whom, among the people at the company today.
   *
   * Built afresh on every read from the manager on each record, which is the field leave
   * requests are routed by, so the chart cannot disagree with where a request goes.
   */
  async chart(actor: Actor): Promise<StaffChart> {
    this.guard.enforce(directoryPolicy.chart(actor));

    return staffChartFor(await this.employees.list({ activeOnly: true }), this.today());
  }

  /**
   * The reader's own profile, with what only they are shown of it: when they started and who
   * they report to.
   */
  async mine(actor: Actor): Promise<MyProfile> {
    this.guard.enforce(directoryPolicy.read(actor));

    /* Not null: the policy above refuses an actor with nobody behind it. */
    const employeeId = actor.employeeId ?? '';
    const employee = await this.employees.findById(employeeId);

    if (employee === undefined) {
      throw new EmployeeNotFound(employeeId);
    }

    const today = this.today();

    const [department, away, profiles, manager] = await Promise.all([
      this.departments.findById(employee.departmentId),
      this.away === undefined ? [] : this.away.awayOn(today),
      this.employees.profilesOf([employee.id]),
      employee.managerId === null ? undefined : this.employees.findById(employee.managerId),
    ]);

    return {
      ...entryFor(
        employee,
        department,
        away.find((one) => one.employeeId === employee.id)?.backOn,
        profiles[0],
      ),
      startDate: employee.startDate,
      manager:
        manager === undefined
          ? null
          : {
              employeeId: manager.id,
              firstName: manager.firstName,
              lastName: manager.lastName,
              jobTitle: manager.jobTitle,
            },
    };
  }

  /**
   * Changes the reader's own work mobile and description. Live at once, with nobody to ask.
   *
   * Whose record it is is decided first, on the id alone, and a refusal is logged by the
   * guard before anything is read. Then the body is checked, and only then is anything
   * written. The audit trigger on `employee` records the change: before, after, who and when.
   */
  async editProfile(actor: Actor, employeeId: string, body: unknown): Promise<MyProfile> {
    this.guard.enforce(directoryPolicy.editProfile(actor, employeeId));

    const edit = validateProfileEdit(body);

    if ((await this.employees.updateProfile(actor, employeeId, edit)) === undefined) {
      throw new EmployeeNotFound(employeeId);
    }

    return this.mine(actor);
  }
}
