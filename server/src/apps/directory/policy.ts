/** Who may read the staff directory. NFR SEC 02, §10.. */

import { type Actor, holdsAny, isSelf } from '../../core/auth/actor.js';
import { type Decision, policyFor } from '../../core/auth/policy.js';
import {
  MAINTAINS_EMPLOYEE_RECORDS,
  PROVIDES_LOGINS,
  READS_EVERY_RECORD,
} from '../../core/identity/role/roles.js';

const about = policyFor('directory');

const ADMINISTRATION_IS_HRS =
  'Employee records are added and changed by HR. Ask them to make the change.';

const LOGINS_ARE_ADMINISTRATIVE =
  'Logins are created by a system administrator or HR. Ask one of them.';

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
   * Reading one person's profile.
   *
   * Anybody current is every employee's, as they are in the list. Anybody else — a leaver, a
   * joiner who has not started, somebody suspended — is HR's alone, the roles that read every
   * record and keep the leaver's history.
   *
   * Refused silently, so the address of a leaver answers exactly as an id that is nobody does
   * and cannot be used to learn who has left. The guard still writes it down. NFR SEC 03.
   */
  readProfile(actor: Actor, employeeId: string, listed: boolean): Decision {
    if (actor.employeeId === null) {
      return about.refuse(actor, 'readProfile', employeeId, 'has no employee record behind it');
    }

    return listed || holdsAny(actor, ...READS_EVERY_RECORD)
      ? about.allow(actor, 'readProfile', employeeId)
      : about.refuse(
          actor,
          'readProfile',
          employeeId,
          'not in the directory today, and holds no role that reads everybody',
        );
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

  /**
   * Everything on the Administration tab: every record, leavers included, and adding,
   * changing and moving people. HR's alone.
   *
   * Asked first by every administration route, before anybody is looked up, and refused
   * openly with a 403: that the tab is HR's is no secret, and answering before any lookup
   * means an id that is nobody is refused exactly as one that is somebody. NFR SEC 03.
   */
  administer(actor: Actor, employeeId: string | null = null): Decision {
    return holdsAny(actor, ...MAINTAINS_EMPLOYEE_RECORDS)
      ? about.allow(actor, 'administer', employeeId)
      : about.refuseOpenly(
          actor,
          'administer',
          employeeId,
          'holds no role that maintains employee records',
          ADMINISTRATION_IS_HRS,
        );
  },

  /**
   * The people waiting for a login, which is where HR hands a new record over to whoever
   * creates logins. Theirs and HR's; refused openly to anybody else.
   */
  loginsToCreate(actor: Actor): Decision {
    return holdsAny(actor, ...PROVIDES_LOGINS)
      ? about.allow(actor, 'loginsToCreate')
      : about.refuseOpenly(
          actor,
          'loginsToCreate',
          null,
          'holds no role that provides logins',
          LOGINS_ARE_ADMINISTRATIVE,
        );
  },

  /**
   * Reading and choosing which optional emails come to you, which is everybody's and only for
   * themselves: the routes name no person, so there is nobody else's to ask for.
   */
  chooseEmails(actor: Actor): Decision {
    return actor.employeeId !== null
      ? about.allow(actor, 'chooseEmails')
      : about.refuse(actor, 'chooseEmails', null, 'has no employee record behind it');
  },

  /**
   * Sending the emails a day brings: welcomes on a start date, warnings as an exit date nears.
   * The scheduled job's, which runs as the system and holds every role.
   */
  sendDailyEmails(actor: Actor): Decision {
    return holdsAny(actor, 'SYS_ADMIN')
      ? about.allow(actor, 'sendDailyEmails')
      : about.refuse(actor, 'sendDailyEmails', null, 'holds no role that sends scheduled email');
  },

  /**
   * Writing to a colleague from their profile: anybody to anybody current, as the profile
   * itself is, and never to yourself.
   *
   * Somebody who is not listed is refused silently, so the form cannot be used to learn who
   * has left, exactly as their profile cannot. Writing to yourself is refused openly.
   */
  sendMessage(actor: Actor, recipientId: string, listed: boolean): Decision {
    if (actor.employeeId === null) {
      return about.refuse(actor, 'sendMessage', recipientId, 'has no employee record behind it');
    }
    if (isSelf(actor, recipientId)) {
      return about.refuseOpenly(
        actor,
        'sendMessage',
        recipientId,
        'writing to themselves',
        'You cannot send a message to yourself.',
      );
    }

    return listed
      ? about.allow(actor, 'sendMessage', recipientId)
      : about.refuse(actor, 'sendMessage', recipientId, 'not in the directory today');
  },

  /**
   * Telling somebody they have been named as cover: by the person going on leave, their
   * manager, or HR, the three who may name cover at all.
   */
  tellCover(actor: Actor, absentee: { id: string; managerId: string | null }): Decision {
    return isSelf(actor, absentee.id) ||
      isSelf(actor, absentee.managerId) ||
      holdsAny(actor, ...MAINTAINS_EMPLOYEE_RECORDS)
      ? about.allow(actor, 'tellCover', absentee.id)
      : about.refuseOpenly(
          actor,
          'tellCover',
          absentee.id,
          'not the person, their manager or HR',
          'Only the person on leave, their manager or HR can name their cover.',
        );
  },
};
