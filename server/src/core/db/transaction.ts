/** Running several repositories on one transaction. FR 08. */

import type { Kysely } from 'kysely';
import type { Database } from './index.js';
import { AttachmentRepository } from '../../apps/leave/leave-request/attachment.db.js';
import { BalanceRepository } from '../../apps/leave/balance/balance.db.js';
import { DepartmentRepository } from '../organisation/department/department.db.js';
import { EmployeeRepository } from '../organisation/employee/employee.db.js';
import { LeaveDecisionRepository } from '../../apps/leave/leave-request/leave-decision.db.js';
import { LeaveEventRepository } from '../../apps/leave/leave-event/leave-event.db.js';
import { LeaveReassignmentRepository } from '../../apps/leave/leave-request/reassignment.db.js';
import { LeaveRequestRepository } from '../../apps/leave/leave-request/leave-request.db.js';
import { HolidayRecalculationRepository } from '../../apps/leave/holiday/recalculation.db.js';
import { ReclassificationRepository } from '../../apps/leave/leave-request/reclassification.db.js';
import { LeaveRoutingRepository } from '../../apps/leave/leave-request/routing.db.js';
import { LeaveTypeRepository } from '../../apps/leave/leave-type/leave-type.db.js';
import { LeaveYearRepository } from '../../apps/leave/leave-year/leave-year.db.js';
import { LedgerRepository } from '../../apps/leave/balance/ledger.db.js';
import { WithdrawalRepository } from '../../apps/leave/leave-request/withdrawal.db.js';
import { ReversalRepository } from '../../apps/leave/leave-request/reversal.db.js';
import { WorkPatternRepository } from '../calendar/work-pattern/work-pattern.db.js';

/** The repositories a service is handed, all of them on the same connection. */
export interface Repositories {
  employees: EmployeeRepository;
  departments: DepartmentRepository;
  patterns: WorkPatternRepository;
  /**
   * The three a balance movement needs. FR 26, §8.2., FR 32a, FR 39.
   */
  balances: BalanceRepository;
  entries: LedgerRepository;
  types: LeaveTypeRepository;
  years: LeaveYearRepository;
  events: LeaveEventRepository;
  requests: LeaveRequestRepository;
  decisions: LeaveDecisionRepository;
  /** FR 48b. The stages a request's routing skipped. */
  routing: LeaveRoutingRepository;
  /** FR 07. The requests a moved reporting line carried. */
  reassignments: LeaveReassignmentRepository;
  /** FR 47. The asks to take agreed leave off the books, and HR's answers. */
  withdrawals: WithdrawalRepository;
  /** The Chief Executive's reversals of settled requests. */
  reversals: ReversalRepository;
  /** FR 32c. The days of agreed leave that became sick leave. */
  reclassifications: ReclassificationRepository;
  /** FR 25. The holidays credited back into agreed leave. */
  recalculations: HolidayRecalculationRepository;
  /** FR 13. The evidence a request has to arrive with, put on it here. */
  attachments: AttachmentRepository;
}

export class Transactions {
  constructor(private readonly db: Kysely<Database>) {}

  /** Runs `work` inside one transaction. */
  async allOrNothing<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) =>
      work({
        employees: new EmployeeRepository(trx),
        departments: new DepartmentRepository(trx),
        patterns: new WorkPatternRepository(trx),
        balances: new BalanceRepository(trx),
        entries: new LedgerRepository(trx),
        types: new LeaveTypeRepository(trx),
        years: new LeaveYearRepository(trx),
        events: new LeaveEventRepository(trx),
        requests: new LeaveRequestRepository(trx),
        decisions: new LeaveDecisionRepository(trx),
        routing: new LeaveRoutingRepository(trx),
        reassignments: new LeaveReassignmentRepository(trx),
        withdrawals: new WithdrawalRepository(trx),
        reversals: new ReversalRepository(trx),
        reclassifications: new ReclassificationRepository(trx),
        recalculations: new HolidayRecalculationRepository(trx),
        attachments: new AttachmentRepository(trx),
      }),
    );
  }
}
