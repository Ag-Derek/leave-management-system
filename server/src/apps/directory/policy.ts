/** Who may read the staff directory. NFR SEC 02, §10.. */

import type { Actor } from '../../core/auth/actor.js';
import { type Decision, policyFor } from '../../core/auth/policy.js';

const about = policyFor('directory');

export const directoryPolicy = {
  resource: about.resource,

  /**
   * Reading it, which is every employee's.
   *
   * `employeePolicy.list` is HR's, and this is not a way round it: the directory is a
   * projection that carries a name, a job title, a department, a work address and a return
   * date, and can assemble nothing else. No manager, no employee number, no dates of
   * employment, no kind of leave.
   *
   * Refused for an actor with no employee behind it. The directory is for the people in it,
   * and nothing that runs unattended has a reason to read it.
   */
  read(actor: Actor): Decision {
    return actor.employeeId !== null
      ? about.allow(actor, 'read')
      : about.refuse(actor, 'read', null, 'has no employee record behind it');
  },
};
