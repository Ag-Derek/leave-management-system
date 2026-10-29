/** The directory's daily emails: welcomes on a start date, warnings as an exit date nears. */

import type { Actor } from '../../core/auth/actor.js';
import type { DailyEmailsRun, DirectoryEmailService } from './email.service.js';

export class DailyDirectoryEmails {
  constructor(private readonly emails: DirectoryEmailService) {}

  /**
   * Queues what today brings. Hourly from main.ts, after the working day starts; every message
   * has a dedupe key, so running it again queues nothing it already has.
   */
  async run(actor: Actor): Promise<DailyEmailsRun> {
    return this.emails.sendDailyEmails(actor);
  }
}

/** What one run did, for the log. Undefined where it queued nothing. */
export function summaryOfDailyEmails(run: DailyEmailsRun): string | undefined {
  const parts = Object.entries(run.queued).map(([email, count]) => `${String(count)} ${email}`);

  if (parts.length === 0 && run.failed === 0) {
    return undefined;
  }

  return (
    `Directory emails as at ${run.asAt}: queued ${parts.length === 0 ? 'nothing' : parts.join(', ')}. ` +
    `${String(run.turnedOff)} left out by choice, ${String(run.failed)} could not be queued.`
  );
}
