/** Who may send what is queued, and who may read the log of it. NFR SEC 02. */

import { type Actor, holdsAny } from '../auth/actor.js';
import { type Decision, policyFor } from '../auth/policy.js';
import { READS_THE_EMAIL_LOG, SENDS_QUEUED_EMAIL } from '../identity/role/roles.js';

const about = policyFor('email');

export const outboxPolicy = {
  resource: about.resource,

  /** Sending what is due, which is the job's. It runs as the system, which holds every role. */
  drain(actor: Actor): Decision {
    return holdsAny(actor, ...SENDS_QUEUED_EMAIL)
      ? about.allow(actor, 'drain')
      : about.refuse(actor, 'drain', null, 'holds no role that sends queued email');
  },

  /**
   * Reading the log: who was sent which email, when, and what became of it. An HR
   * Administrator's and a System Administrator's, as the audit log is, because it names
   * everybody's changes of job and manager.
   */
  readLog(actor: Actor): Decision {
    return holdsAny(actor, ...READS_THE_EMAIL_LOG)
      ? about.allow(actor, 'readLog')
      : about.refuseOpenly(
          actor,
          'readLog',
          null,
          'holds no role that reads the email log',
          'Only an HR Administrator or a System Administrator can read the email log.',
        );
  },
};
