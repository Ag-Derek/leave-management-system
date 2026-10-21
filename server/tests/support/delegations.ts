/** The delegation service the leave doors take, built the one way. FR 49. */

import type { Kysely } from 'kysely';
import type { Database } from '../../src/core/db/index.js';
import type { Guard } from '../../src/core/auth/policy.js';
import { ApprovalDelegationRepository } from '../../src/apps/leave/leave-request/delegation.db.js';
import { ApprovalDelegationService } from '../../src/apps/leave/leave-request/delegation.service.js';
import { EmployeeRepository } from '../../src/core/organisation/employee/employee.db.js';
import { RoleRepository } from '../../src/core/identity/role/role.db.js';

export function delegationService(db: Kysely<Database>, guard: Guard): ApprovalDelegationService {
  return new ApprovalDelegationService(
    new ApprovalDelegationRepository(db),
    guard,
    new EmployeeRepository(db),
    new RoleRepository(db),
  );
}
