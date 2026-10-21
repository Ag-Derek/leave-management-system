/** The recalculation door `buildApp` takes, built the one way. FR 25, §8.8. */

import type { Kysely } from 'kysely';
import type { Database } from '../../src/core/db/index.js';
import type { Guard } from '../../src/core/auth/policy.js';
import type { BalanceService } from '../../src/apps/leave/balance/balance.service.js';
import { EmployeeRepository } from '../../src/core/organisation/employee/employee.db.js';
import { HolidayRepository } from '../../src/apps/leave/holiday/holiday.db.js';
import { HolidayRecalculationRepository } from '../../src/apps/leave/holiday/recalculation.db.js';
import { HolidayRecalculationService } from '../../src/apps/leave/holiday/recalculation.service.js';
import { LeaveRequestRepository } from '../../src/apps/leave/leave-request/leave-request.db.js';
import { LeaveTypeRepository } from '../../src/apps/leave/leave-type/leave-type.db.js';
import { LeaveYearRepository } from '../../src/apps/leave/leave-year/leave-year.db.js';
import { earliestOpenDayFrom } from '../../src/apps/leave/leave-year/leave-year.service.js';
import { NotificationRepository } from '../../src/apps/leave/notification/notification.db.js';
import { NotificationService } from '../../src/apps/leave/notification/notification.service.js';
import { WorkPatternRepository } from '../../src/core/calendar/work-pattern/work-pattern.db.js';
import { recordingMailer } from './recording-mailer.js';

export function holidayRecalculationService(
  db: Kysely<Database>,
  guard: Guard,
  /** The one door a balance moves through, so a test asserts against the same cache. */
  balances: BalanceService,
): HolidayRecalculationService {
  return new HolidayRecalculationService(
    new HolidayRepository(db),
    new HolidayRecalculationRepository(db),
    new LeaveRequestRepository(db),
    new EmployeeRepository(db),
    new LeaveTypeRepository(db),
    new WorkPatternRepository(db),
    balances,
    new NotificationService(new NotificationRepository(db), recordingMailer(), guard),
    guard,
    earliestOpenDayFrom(new LeaveYearRepository(db)),
  );
}
