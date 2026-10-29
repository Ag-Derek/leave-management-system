/** Database access for which optional emails people have turned off. */

import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/index.js';
import type { DirectoryEmail } from './email.js';

export class EmailPreferenceRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /** The emails one person has turned off. */
  async turnedOffBy(employeeId: string): Promise<DirectoryEmail[]> {
    const rows = await this.db
      .selectFrom('email_opt_out')
      .select('email')
      .where('employee_id', '=', employeeId)
      .execute();

    /* `email_opt_out_only_optional_emails` is what makes the cast safe. */
    return rows.map((row) => row.email as DirectoryEmail);
  }

  /** Which of these people have turned this email off. */
  async whoTurnedOff(employeeIds: readonly string[], email: DirectoryEmail): Promise<Set<string>> {
    if (employeeIds.length === 0) {
      return new Set();
    }

    const rows = await this.db
      .selectFrom('email_opt_out')
      .select('employee_id')
      .where('email', '=', email)
      .where('employee_id', 'in', [...employeeIds])
      .execute();

    return new Set(rows.map((row) => row.employee_id));
  }

  /** Turns one off. Turning off what is already off changes nothing. */
  async turnOff(employeeId: string, email: DirectoryEmail): Promise<void> {
    await this.db
      .insertInto('email_opt_out')
      .values({ employee_id: employeeId, email })
      .onConflict((conflict) => conflict.columns(['employee_id', 'email']).doNothing())
      .execute();
  }

  /** Turns one back on. */
  async turnOn(employeeId: string, email: DirectoryEmail): Promise<void> {
    await this.db
      .deleteFrom('email_opt_out')
      .where('employee_id', '=', employeeId)
      .where('email', '=', email)
      .execute();
  }
}
