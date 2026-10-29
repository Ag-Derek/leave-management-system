/** Database access for cover while somebody is on leave. #226. */

import type { Kysely, Selectable } from 'kysely';
import type { Attribution } from '../../../core/audit/audit.js';
import type { CalendarDate } from '../../../core/calendar/time.js';
import type { Database } from '../../../core/db/index.js';
import type { LeaveCoverTable } from '../../../core/db/schema.js';
import { recording } from '../../../core/db/recording.js';
import { LIVE_STATUSES } from '../leave-request/leave-request.js';
import {
  CoverCannotBeChanged,
  type CoverInForce,
  CoverIsTheAbsentee,
  type CoverPart,
  InvalidCover,
  type NamedCover,
} from './cover.js';

/** Postgres `exclusion_violation`. */
const EXCLUSION_VIOLATION = '23P01';

/** Postgres `restrict_violation`, which every refusal in this schema raises. */
const RESTRICT_VIOLATION = '23001';

type CoverRow = Selectable<LeaveCoverTable>;

/** Cover standing on a piece of live leave, with that leave's dates and whether it is agreed. */
export interface CoverOnLeave extends NamedCover {
  absenteeId: string;
  leave: { from: CalendarDate; to: CalendarDate };
  agreed: boolean;
}

export class CoverRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /** The cover standing on one request, soonest first. */
  async standingFor(leaveRequestId: string): Promise<NamedCover[]> {
    const rows = await this.db
      .selectFrom('leave_cover')
      .selectAll()
      .where('leave_request_id', '=', leaveRequestId)
      .where('ended_at', 'is', null)
      .orderBy('starts_on')
      .orderBy('id')
      .execute();

    return rows.map(toCover);
  }

  /**
   * Ends some of a request's cover and writes new parts, in one transaction, with the request
   * held still so it cannot end between the two. Answers what was written.
   */
  async rename(
    by: Attribution,
    leaveRequestId: string,
    change: { end: readonly string[]; add: readonly CoverPart[] },
  ): Promise<NamedCover[]> {
    try {
      return await recording(this.db, by, async (on) => {
        await on
          .selectFrom('leave_request')
          .select('id')
          .where('id', '=', leaveRequestId)
          .forUpdate()
          .executeTakeFirst();

        if (change.end.length > 0) {
          await on
            .updateTable('leave_cover')
            .set({ ended_because: 'REPLACED' })
            .where('id', 'in', [...change.end])
            .where('ended_at', 'is', null)
            .execute();
        }

        if (change.add.length === 0) {
          return [];
        }

        const rows = await on
          .insertInto('leave_cover')
          .values(
            change.add.map((part) => ({
              leave_request_id: leaveRequestId,
              cover_employee_id: part.coverId,
              starts_on: part.from,
              ends_on: part.to,
            })),
          )
          .returningAll()
          .execute();

        return rows.map(toCover);
      });
    } catch (error) {
      throw refusalFor(error) ?? error;
    }
  }

  /**
   * Who covers for whom on a day: agreed leave under way, cut to the days of it still
   * standing. The one place "in force" is decided.
   */
  async inForceOn(day: CalendarDate): Promise<CoverInForce[]> {
    const rows = await this.db
      .selectFrom('leave_cover as cover')
      .innerJoin('leave_request as leave', 'leave.id', 'cover.leave_request_id')
      .select(['leave.employee_id as employeeId', 'cover.cover_employee_id as coverId'])
      .where('cover.ended_at', 'is', null)
      .where('leave.status', '=', 'APPROVED')
      .where('cover.starts_on', '<=', day)
      .where('cover.ends_on', '>=', day)
      .where('leave.start_date', '<=', day)
      .where('leave.end_date', '>=', day)
      .orderBy('leave.employee_id')
      .orderBy('cover.starts_on')
      .execute();

    return rows;
  }

  /** What one person has been named to cover on live leave that has not ended by this day. */
  async namedFor(coverId: string, day: CalendarDate): Promise<CoverOnLeave[]> {
    const rows = await this.db
      .selectFrom('leave_cover as cover')
      .innerJoin('leave_request as leave', 'leave.id', 'cover.leave_request_id')
      .selectAll('cover')
      .select([
        'leave.employee_id as absentee_id',
        'leave.start_date as leave_from',
        'leave.end_date as leave_to',
        'leave.status as leave_status',
      ])
      .where('cover.cover_employee_id', '=', coverId)
      .where('cover.ended_at', 'is', null)
      .where('leave.status', 'in', [...LIVE_STATUSES])
      .where('cover.ends_on', '>=', day)
      .where('leave.end_date', '>=', day)
      .orderBy('cover.starts_on')
      .orderBy('cover.id')
      .execute();

    return rows.map((row) => ({
      ...toCover(row),
      absenteeId: row.absentee_id,
      leave: { from: row.leave_from, to: row.leave_to },
      agreed: row.leave_status === 'APPROVED',
    }));
  }
}

/** The database's refusals, in the words the service would have used. */
function refusalFor(error: unknown): Error | undefined {
  const failure = error as { code?: string; constraint?: string };

  if (
    failure.code === EXCLUSION_VIOLATION &&
    failure.constraint === 'leave_cover_one_person_a_day'
  ) {
    return new InvalidCover(
      'parts',
      'Somebody else was named to cover some of these days at the same moment. Look again ' +
        'and name one person for each day.',
    );
  }

  if (failure.code !== RESTRICT_VIOLATION) {
    return undefined;
  }

  switch (failure.constraint) {
    case 'leave_cover_is_somebody_else':
      return new CoverIsTheAbsentee();
    case 'leave_cover_inside_the_leave':
      return new InvalidCover('to', 'Cover is for days of the leave, and these are not.');
    case 'leave_cover_on_live_leave':
      return new CoverCannotBeChanged('ENDED');
    default:
      return undefined;
  }
}

function toCover(row: CoverRow): NamedCover {
  return {
    id: row.id,
    leaveRequestId: row.leave_request_id,
    coverId: row.cover_employee_id,
    from: row.starts_on,
    to: row.ends_on,
    namedBy: row.named_by,
    namedAt: row.named_at,
  };
}
