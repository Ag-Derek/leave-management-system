/** Database access for leave plans. */

import type { Kysely, Selectable } from 'kysely';
import type { Database } from '../../db/index.js';
import type { LeavePlanTable } from '../../db/schema.js';
import type { CalendarDate } from '../../shared/time.js';
import { InvalidPlan, type LeavePlan, PlansOverlap, type ValidatedPlan } from './plan.js';

/** Postgres `exclusion_violation` and `foreign_key_violation`. */
const EXCLUSION_VIOLATION = '23P01';
const FOREIGN_KEY_VIOLATION = '23503';

type LeavePlanRow = Selectable<LeavePlanTable>;

export class LeavePlanRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async add(employeeId: string, plan: ValidatedPlan): Promise<LeavePlan> {
    return this.catchRefusals(async () => {
      const row = await this.db
        .insertInto('leave_plan')
        .values({
          employee_id: employeeId,
          leave_type_id: plan.leaveTypeId,
          start_date: plan.from,
          end_date: plan.to,
          note: plan.note,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return toPlan(row);
    });
  }

  /** Replaces one of this person's plans. Undefined where it is not theirs. */
  async replace(
    employeeId: string,
    id: string,
    plan: ValidatedPlan,
  ): Promise<LeavePlan | undefined> {
    return this.catchRefusals(async () => {
      const row = await this.db
        .updateTable('leave_plan')
        .set({
          leave_type_id: plan.leaveTypeId,
          start_date: plan.from,
          end_date: plan.to,
          note: plan.note,
        })
        .where('id', '=', id)
        .where('employee_id', '=', employeeId)
        .returningAll()
        .executeTakeFirst();

      return row === undefined ? undefined : toPlan(row);
    });
  }

  /** Removes one of this person's plans. Whether there was one to remove. */
  async remove(employeeId: string, id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('leave_plan')
      .where('id', '=', id)
      .where('employee_id', '=', employeeId)
      .executeTakeFirst();

    return (result.numDeletedRows ?? 0n) > 0n;
  }

  /** One person's plans over a span, soonest first. */
  async forEmployee(
    employeeId: string,
    span: { from: CalendarDate; to: CalendarDate },
  ): Promise<LeavePlan[]> {
    return this.overlapping([employeeId], span);
  }

  /** Everybody's plans among these people over a span, soonest first. For the calendar. */
  async overlapping(
    employeeIds: readonly string[],
    span: { from: CalendarDate; to: CalendarDate },
  ): Promise<LeavePlan[]> {
    if (employeeIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .selectFrom('leave_plan')
      .selectAll()
      .where('employee_id', 'in', [...employeeIds])
      .where('end_date', '>=', span.from)
      .where('start_date', '<=', span.to)
      .orderBy('start_date')
      .orderBy('id')
      .execute();

    return rows.map(toPlan);
  }

  private async catchRefusals<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      const failure = error as { code?: string; constraint?: string };

      if (
        failure.code === EXCLUSION_VIOLATION &&
        failure.constraint === 'leave_plan_never_overlaps'
      ) {
        throw new PlansOverlap();
      }

      if (
        failure.code === FOREIGN_KEY_VIOLATION &&
        failure.constraint === 'leave_plan_leave_type_id_fkey'
      ) {
        throw new InvalidPlan('leaveTypeId', 'That is not a kind of leave that exists.');
      }

      throw error;
    }
  }
}

/** A row as the domain sees it. The dates stay ten characters. NFR DAT 03. */
function toPlan(row: LeavePlanRow): LeavePlan {
  return {
    id: row.id,
    employeeId: row.employee_id,
    leaveTypeId: row.leave_type_id,
    from: row.start_date,
    to: row.end_date,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
