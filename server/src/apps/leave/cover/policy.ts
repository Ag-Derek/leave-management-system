/** Who may see and name cover for somebody's leave. #226, NFR SEC 02. */

import { type Actor, holdsAny, isSelf } from '../../../core/auth/actor.js';
import { type Decision, policyFor } from '../../../core/auth/policy.js';
import {
  MAINTAINS_EMPLOYEE_RECORDS,
  READS_EVERY_RECORD,
} from '../../../core/identity/role/roles.js';
import type { BalanceOwner } from '../balance/policy.js';

const about = policyFor('leave cover');

/** The person on leave, their manager, or HR: the three `directoryPolicy.tellCover` admits. */
function namesTheirCover(actor: Actor, owner: BalanceOwner): boolean {
  return (
    isSelf(actor, owner.employeeId) ||
    isSelf(actor, owner.managerId) ||
    holdsAny(actor, ...MAINTAINS_EMPLOYEE_RECORDS)
  );
}

export const coverPolicy = {
  resource: about.resource,

  /**
   * Reading the cover on somebody's leave: anybody who may name it, and a role that reads
   * every record. Refused silently, as reading the leave itself is, so a request id cannot be
   * used to learn whose leave it is.
   */
  read(actor: Actor, owner: BalanceOwner): Decision {
    return namesTheirCover(actor, owner) || holdsAny(actor, ...READS_EVERY_RECORD)
      ? about.allow(actor, 'read', owner.employeeId)
      : about.refuse(
          actor,
          'read',
          owner.employeeId,
          'is not the person, their manager, or a role that reads every record',
        );
  },

  /**
   * Naming or changing cover, and asking who could be named. The person on leave, their
   * manager, or HR.
   *
   * Somebody who may read the leave is told openly why they may not change it; anybody else
   * is refused silently, as {@link read} is.
   */
  name(actor: Actor, owner: BalanceOwner): Decision {
    if (namesTheirCover(actor, owner)) {
      return about.allow(actor, 'name', owner.employeeId);
    }

    return holdsAny(actor, ...READS_EVERY_RECORD)
      ? about.refuseOpenly(
          actor,
          'name',
          owner.employeeId,
          'is not the person, their manager or HR',
          'Only the person on leave, their manager or HR can name their cover.',
        )
      : about.refuse(actor, 'name', owner.employeeId, 'is not the person, their manager or HR');
  },
};
