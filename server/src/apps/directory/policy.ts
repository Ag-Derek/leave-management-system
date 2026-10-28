/** Who may read the staff directory. NFR SEC 02, §10.. */

import { type Actor, isSelf } from '../../core/auth/actor.js';
import { type Decision, policyFor } from '../../core/auth/policy.js';

const about = policyFor('directory');

export const directoryPolicy = {
  resource: about.resource,

  /**
   * Reading it, which is every employee's.
   *
   * `employeePolicy.list` is HR's, and this is not a way round it: the directory is a
   * projection that carries a name, a job title, a department, a work address and a return
   * date, and can assemble nothing else. No employee number, no dates of employment, no kind
   * of leave. A colleague's profile adds their manager and reports, which the chart below
   * already shows everybody.
   *
   * Refused for an actor with no employee behind it. The directory is for the people in it,
   * and nothing that runs unattended has a reason to read it.
   */
  read(actor: Actor): Decision {
    return actor.employeeId !== null
      ? about.allow(actor, 'read')
      : about.refuse(actor, 'read', null, 'has no employee record behind it');
  },

  /**
   * Reading the organisation chart, which is every employee's too.
   *
   * It says who reports to whom, which the directory's list does not, and that is the point
   * of it: somebody who can see their own line can see when it is wrong, and the same field
   * decides where their leave requests go. It carries what the list does of each person and
   * less — a name and a job title — and only the people who are current.
   *
   * HR's chart, `employeePolicy.chart`, is a different read: every record, leavers and
   * employee numbers included, and it stays HR's.
   */
  chart(actor: Actor): Decision {
    return actor.employeeId !== null
      ? about.allow(actor, 'chart')
      : about.refuse(actor, 'chart', null, 'has no employee record behind it');
  },

  /**
   * Changing the photo, work mobile and description on a record, which is its owner's alone.
   *
   * Not HR's either: HR keeps everything else on the record, and these three are the
   * person's own words about themselves. Decided on the id asked for, before anybody is
   * looked up, so the answer is the same whether or not that id is anybody.
   *
   * Refused openly, with a 403, because whose profile it is is no secret. The guard writes
   * every refusal to the denial log. NFR SEC 03.
   */
  editProfile(actor: Actor, employeeId: string): Decision {
    return isSelf(actor, employeeId)
      ? about.allow(actor, 'editProfile', employeeId)
      : about.refuseOpenly(
          actor,
          'editProfile',
          employeeId,
          'not their own record',
          'You can only change your own profile. Anything else on a record is kept by HR.',
        );
  },
};
