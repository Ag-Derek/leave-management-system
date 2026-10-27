/** The staff directory, assembled. */

import type { Actor } from '../../core/auth/actor.js';
import type { Guard } from '../../core/auth/policy.js';
import { type CalendarDate, calendarDateIn } from '../../core/calendar/time.js';
import type { DepartmentRepository } from '../../core/organisation/department/department.db.js';
import type { EmployeeRepository } from '../../core/organisation/employee/employee.db.js';
import { type Directory, directoryFor, type WhoIsAway } from './directory.js';
import { directoryPolicy } from './policy.js';

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

    return directoryFor({ employees, departments, away, today });
  }
}
