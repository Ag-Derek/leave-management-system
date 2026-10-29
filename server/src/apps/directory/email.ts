/**
 * The emails the directory sends, and what each one says.
 *
 * Pure: each composer takes the facts and gives back a message ready to queue, in the company
 * layout, with its plain text part, its sender and its dedupe key. Nothing here reads a table
 * or sends anything.
 */

import { type CalendarDate, calendarDaysBetween, formatDay } from '../../core/calendar/time.js';
import {
  BRAND_NAME,
  type EmailContent,
  type EmailFact,
  oneLine,
  renderEmail,
} from '../../core/notification/layout.js';
import type { NewOutboxEmail } from '../../core/notification/outbox.js';

/** Every email the directory sends. */
export const DIRECTORY_EMAILS = [
  /** To a joiner, on their start date. */
  'WELCOME',
  /** To a joiner's manager, on the joiner's start date. */
  'NEW_REPORT',
  /** To the joiner's team, everybody else under the same manager, on the start date. */
  'NEW_COLLEAGUE',
  /** To HR, as an exit date comes close and the leaver still has people reporting to them. */
  'LEAVER_HAS_REPORTS',
  /** To somebody whose job title, department or manager has just been changed. */
  'RECORD_CHANGED',
  /** To somebody a colleague has named as their cover while they are on leave. */
  'COVER_NAMED',
  /** A message a colleague wrote from their profile, and the writer's own copy of it. */
  'DIRECT_MESSAGE',
] as const;

export type DirectoryEmail = (typeof DIRECTORY_EMAILS)[number];

/**
 * The emails a person may turn off. Every other one is always sent.
 *
 * The same list is `email_opt_out_only_optional_emails` in the database, so a mandatory email
 * cannot be turned off by any route, and the suite reads that constraint back against this.
 */
export const OPTIONAL_EMAILS: readonly DirectoryEmail[] = ['NEW_COLLEAGUE', 'COVER_NAMED'];

export function isOptional(email: DirectoryEmail): boolean {
  return OPTIONAL_EMAILS.includes(email);
}

/** What each email is, for the screen where people choose. */
export const ABOUT_EACH_EMAIL: Record<DirectoryEmail, { label: string; description: string }> = {
  WELCOME: {
    label: 'Welcome on your first day',
    description: 'Sent once, on your start date, with a link to finish your profile.',
  },
  NEW_REPORT: {
    label: 'Someone joins as your report',
    description: 'On their first day, when a new joiner reports to you.',
  },
  NEW_COLLEAGUE: {
    label: 'Someone joins your team',
    description: 'On their first day, when a new joiner has the same manager as you.',
  },
  LEAVER_HAS_REPORTS: {
    label: 'A leaver still has reports',
    description: 'For HR, when someone leaving soon still has people reporting to them.',
  },
  RECORD_CHANGED: {
    label: 'Changes to your record',
    description: 'When your job title, department or manager is changed.',
  },
  COVER_NAMED: {
    label: 'You are named as cover',
    description: 'When a colleague names you as their contact while they are on leave.',
  },
  DIRECT_MESSAGE: {
    label: 'Messages from colleagues',
    description: 'When a colleague writes to you from your profile, and a copy of what you send.',
  },
};

/** The longest subject a message may have. */
export const LONGEST_MESSAGE_SUBJECT = 150;

/** The longest message. */
export const LONGEST_MESSAGE = 5000;

/** How many messages one person may send in an hour. */
export const MESSAGES_PER_HOUR = 10;

/** A message a colleague wrote, checked. */
export interface Message {
  subject: string;
  message: string;
}

/** A message that could not be sent as written, and the box that caused it. */
export class InvalidMessage extends Error {
  readonly field: string;

  constructor(field: 'subject' | 'message', message: string) {
    super(message);
    this.name = 'InvalidMessage';
    this.field = field;
  }
}

/** Somebody who has sent as many messages as an hour allows. */
export class TooManyMessages extends Error {
  constructor() {
    super(
      `You have sent ${String(MESSAGES_PER_HOUR)} messages in the last hour, which is the most ` +
        'the directory sends for one person. Try again later, or write from your own email.',
    );
    this.name = 'TooManyMessages';
  }
}

/**
 * A message that could not be written to the queue. Unlike every other email, the person is
 * standing there waiting to hear it went, so they are told rather than it being only logged.
 */
export class MessageNotQueued extends Error {
  constructor() {
    super('Your message could not be sent just now. Nothing was sent; try again in a moment.');
    this.name = 'MessageNotQueued';
  }
}

/** Checks and tidies a message from the form. */
export function validateMessage(body: unknown): Message {
  const given = (body ?? {}) as { subject?: unknown; message?: unknown };
  const subject = typeof given.subject === 'string' ? oneLine(given.subject) : '';
  const message =
    typeof given.message === 'string' ? given.message.replace(/\r\n?/g, '\n').trim() : '';

  if (subject === '') {
    throw new InvalidMessage('subject', 'Give the message a subject.');
  }
  if (subject.length > LONGEST_MESSAGE_SUBJECT) {
    throw new InvalidMessage(
      'subject',
      `The subject is ${String(subject.length)} characters, and the longest is ${String(LONGEST_MESSAGE_SUBJECT)}.`,
    );
  }
  if (message === '') {
    throw new InvalidMessage('message', 'Write a message to send.');
  }
  if (message.length > LONGEST_MESSAGE) {
    throw new InvalidMessage(
      'message',
      `The message is ${String(message.length)} characters, and the longest is ${String(LONGEST_MESSAGE)}.`,
    );
  }

  return { subject, message };
}

/** A reader that is not one of the emails. */
export class DirectoryEmailNotFound extends Error {
  constructor(name: string) {
    super(`The directory sends no email called ${name}.`);
    this.name = 'DirectoryEmailNotFound';
  }
}

/** An attempt to turn off an email that is always sent. */
export class EmailIsMandatory extends Error {
  readonly field = 'receives';

  constructor(email: DirectoryEmail) {
    super(
      `"${ABOUT_EACH_EMAIL[email].label}" is about your employment and is always sent, so it ` +
        'cannot be turned off.',
    );
    this.name = 'EmailIsMandatory';
  }
}

/** The email a caller named, or a refusal. */
export function readDirectoryEmail(value: unknown): DirectoryEmail {
  if (typeof value !== 'string' || !(DIRECTORY_EMAILS as readonly string[]).includes(value)) {
    throw new DirectoryEmailNotFound(String(value));
  }

  return value as DirectoryEmail;
}

/** A choice that is not one. */
export class InvalidEmailChoice extends Error {
  readonly field = 'receives';

  constructor() {
    super('Say whether this email should come to you: { "receives": true } or false.');
    this.name = 'InvalidEmailChoice';
  }
}

/** Whether a choice turns an email on or off, or a refusal. */
export function readReceives(body: unknown): boolean {
  const receives = (body as { receives?: unknown } | null | undefined)?.receives;

  if (typeof receives !== 'boolean') {
    throw new InvalidEmailChoice();
  }

  return receives;
}

/** Somebody an email is to or about. */
export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  jobTitle: string | null;
}

/** Where the emails link to. Built from `APP_URL`. */
export interface PortalLinks {
  /** Somebody's profile, which for the reader is also where they choose their emails. */
  profile(employeeId: string): string;
}

/** Links into the portal at this address. */
export function portalLinks(appUrl: string): PortalLinks {
  const base = appUrl.replace(/\/+$/, '');

  return {
    profile: (employeeId) => `${base}/#/directory/${encodeURIComponent(employeeId)}`,
  };
}

const SIGN_OFF = BRAND_NAME;

const ALWAYS_SENT = 'This email is about your employment, so it is always sent.';

/** Small print on an email that can be turned off, and where to do it. */
function canTurnOff(why: string, recipient: Person, links: PortalLinks): string[] {
  return [why, `You can turn these emails off on your profile: ${links.profile(recipient.id)}`];
}

/** Into a message ready to queue. */
function message(
  kind: DirectoryEmail,
  to: Person,
  subject: string,
  content: EmailContent,
  extra: {
    dedupeKey?: string | null;
    /** Who caused it: their name on it, replies to them, and counted against them. */
    sender?: Person | null;
    /** Where a reply goes, where that is not the sender. */
    replyTo?: string | null;
    /** The name it is from, where that is not the sender's. */
    fromName?: string;
  } = {},
): NewOutboxEmail {
  const { text, html } = renderEmail(content);
  const sender = extra.sender ?? null;
  const named = extra.fromName ?? (sender === null ? null : `${nameOf(sender)} via ${BRAND_NAME}`);

  return {
    kind,
    recipientEmployeeId: to.id,
    to: to.workEmail,
    /* Somebody's name, from the system address, with replies to them. Never their mailbox. */
    /* The portal's own name otherwise, rather than the leave app's MAIL_FROM_NAME. */
    fromName: named ?? BRAND_NAME,
    replyTo: extra.replyTo ?? (sender === null ? null : sender.workEmail),
    senderEmployeeId: sender === null ? null : sender.id,
    subject: oneLine(subject),
    text,
    html,
    dedupeKey: extra.dedupeKey ?? null,
  };
}

/** A joiner, on their first day. */
export function welcomeEmail(facts: {
  joiner: Person;
  manager: Person | null;
  department: string;
  startDate: CalendarDate;
  links: PortalLinks;
}): NewOutboxEmail {
  const { joiner, manager } = facts;

  return message(
    'WELCOME',
    joiner,
    `Welcome to Remat, ${joiner.firstName}`,
    {
      preview:
        'Today is your first day. Here is where to find everyone, and how to tell them about you.',
      greeting: `Hello ${joiner.firstName},`,
      paragraphs: [
        'Today is your first day at Remat. Welcome, and we are glad you are here.',
        manager === null
          ? 'Your profile is already in the company directory.'
          : `You report to ${nameAndTitle(manager)}, who has been told you start today.`,
        'The Remat Portal is where colleagues look each other up. Your profile already shows ' +
          'your name, job title and department. Take a couple of minutes to add a photo, a ' +
          'work mobile and a line on what people should come to you about, so they know who you are.',
      ],
      facts: [
        { label: 'Job title', value: joiner.jobTitle ?? 'Not set yet' },
        { label: 'Department', value: facts.department },
        { label: 'Manager', value: manager === null ? 'Nobody' : nameOf(manager) },
      ],
      action: { label: 'Complete your profile', href: facts.links.profile(joiner.id) },
      afterAction: [
        'You sign in with this email address. If you have not been given a password yet, HR will set one up for you.',
      ],
      signOff: SIGN_OFF,
      footer: [ALWAYS_SENT],
    },
    { dedupeKey: `WELCOME:${joiner.id}:${facts.startDate}` },
  );
}

/** A joiner's manager, on the joiner's first day. */
export function newReportEmail(facts: {
  manager: Person;
  joiner: Person;
  department: string;
  startDate: CalendarDate;
  links: PortalLinks;
}): NewOutboxEmail {
  const { manager, joiner } = facts;

  return message(
    'NEW_REPORT',
    manager,
    `${nameOf(joiner)} joins your team today`,
    {
      preview: `${joiner.firstName} starts today and reports to you.`,
      greeting: `Hello ${manager.firstName},`,
      paragraphs: [
        `${nameOf(joiner)} starts today${roleIn(joiner, facts.department)}, reporting to you.`,
        'A word from you on their first day goes a long way. Their profile is in the directory, ' +
          'and they have been asked to add a photo and a few lines about themselves.',
        'Their leave requests come to you for approval from today.',
      ],
      action: { label: `View ${joiner.firstName}'s profile`, href: facts.links.profile(joiner.id) },
      signOff: SIGN_OFF,
      footer: ['You are told because they report to you. ' + ALWAYS_SENT],
    },
    { dedupeKey: `NEW_REPORT:${joiner.id}:${facts.startDate}:${manager.id}` },
  );
}

/** Somebody on the joiner's team, on the joiner's first day. */
export function newColleagueEmail(facts: {
  colleague: Person;
  joiner: Person;
  manager: Person;
  department: string;
  startDate: CalendarDate;
  links: PortalLinks;
}): NewOutboxEmail {
  const { colleague, joiner, manager } = facts;

  return message(
    'NEW_COLLEAGUE',
    colleague,
    `Say hello to ${nameOf(joiner)}`,
    {
      preview: `${joiner.firstName} joins ${manager.firstName}'s team today.`,
      greeting: `Hello ${colleague.firstName},`,
      paragraphs: [
        `${nameOf(joiner)} joins the team today${roleIn(joiner, facts.department)}, ` +
          `reporting to ${nameOf(manager)} as you do.`,
        'Say hello when you get a moment. Their profile is in the directory.',
      ],
      action: { label: `View ${joiner.firstName}'s profile`, href: facts.links.profile(joiner.id) },
      signOff: SIGN_OFF,
      footer: canTurnOff(
        `You get this because you report to ${nameOf(manager)}.`,
        colleague,
        facts.links,
      ),
    },
    { dedupeKey: `NEW_COLLEAGUE:${joiner.id}:${facts.startDate}:${colleague.id}` },
  );
}

/** HR, as somebody's exit date comes close and people still report to them. */
export function leaverHasReportsEmail(facts: {
  hr: Person;
  leaver: Person;
  reports: readonly Person[];
  exitDate: CalendarDate;
  today: CalendarDate;
  /** The first warning, or the last one a few days out. Each is sent once. */
  stage: LeaverWarning;
  links: PortalLinks;
}): NewOutboxEmail {
  const { hr, leaver, reports } = facts;
  const count =
    reports.length === 1 ? 'one direct report' : `${String(reports.length)} direct reports`;

  return message(
    'LEAVER_HAS_REPORTS',
    hr,
    `${nameOf(leaver)} leaves on ${formatDay(facts.exitDate)} and still has ${count}`,
    {
      preview: `Move ${leaver.firstName}'s reports to their new manager before ${formatDay(facts.exitDate)}.`,
      greeting: `Hello ${hr.firstName},`,
      paragraphs: [
        `${nameOf(leaver)}'s last day is ${formatDay(facts.exitDate)}, ${whenFrom(facts.today, facts.exitDate)}. ` +
          `${reports.length === 1 ? 'One person still reports' : `${String(reports.length)} people still report`} to them:`,
      ],
      facts: reports.map((report): EmailFact => ({
        label: nameOf(report),
        value: report.jobTitle ?? 'No job title',
      })),
      afterFacts: [
        'Move them to their new manager before then, so their leave requests go to the right person from the first day.',
        `If nobody does, the day after ${leaver.firstName}'s last day the portal moves them to the nearest manager above ` +
          `${leaver.firstName} who is still here. Where there is nobody, they stay where they are until HR places them.`,
      ],
      action: { label: `View ${leaver.firstName}'s profile`, href: facts.links.profile(leaver.id) },
      signOff: SIGN_OFF,
      footer: ['You are told because you hold an HR role. This email is always sent.'],
    },
    { dedupeKey: `LEAVER_HAS_REPORTS:${leaver.id}:${facts.exitDate}:${facts.stage}:${hr.id}` },
  );
}

/** How far ahead of an exit date HR is first told, in days. */
export const FIRST_WARNING_DAYS = 14;

/** How far ahead they are told again, if the reports are still there. */
export const LAST_WARNING_DAYS = 3;

export type LeaverWarning = 'FIRST' | 'LAST';

/**
 * Which warning an exit date this far off is due, or null where none is yet.
 *
 * A first run inside the last few days sends the last warning only, so nobody is told twice
 * in one morning.
 */
export function warningDue(today: CalendarDate, exitDate: CalendarDate): LeaverWarning | null {
  if (exitDate < today) {
    return null;
  }

  const daysLeft = calendarDaysBetween(today, exitDate) - 1;

  return daysLeft <= LAST_WARNING_DAYS ? 'LAST' : daysLeft <= FIRST_WARNING_DAYS ? 'FIRST' : null;
}

/** One field of a record that moved, in words. */
export interface ChangedField {
  label: string;
  from: string;
  to: string;
}

/** Somebody whose job title, department or manager has just changed. */
export function recordChangedEmail(facts: {
  employee: Person;
  changes: readonly ChangedField[];
  /** Who made the change, or null where the system did, as when a leaver's reports move. */
  changedBy: Person | null;
  /** Whether the manager was one of the changes, which moves where their leave goes. */
  managerChanged: boolean;
  links: PortalLinks;
}): NewOutboxEmail {
  const { employee, changes, changedBy } = facts;
  const only = changes.length === 1 ? changes[0] : undefined;

  return message(
    'RECORD_CHANGED',
    employee,
    only === undefined
      ? 'Your employee record has changed'
      : `Your ${only.label.toLowerCase()} has changed`,
    {
      preview: changes.map((change) => `${change.label}: ${change.to}`).join(', '),
      greeting: `Hello ${employee.firstName},`,
      paragraphs: [
        `${changedBy === null ? 'Your employee record has been updated' : `${nameOf(changedBy)} has updated your employee record`}. Here is what changed:`,
      ],
      facts: changes.map((change) => ({
        label: change.label,
        value: `${change.to} (was ${change.from})`,
      })),
      afterFacts: [
        ...(facts.managerChanged
          ? [
              'Your leave requests now go to your new manager for approval, and any still waiting on your old one have moved with you.',
            ]
          : []),
        changedBy === null
          ? 'If something here is wrong, speak to HR.'
          : 'If something here is wrong, reply to this email or speak to HR.',
      ],
      action: { label: 'View your profile', href: facts.links.profile(employee.id) },
      signOff: SIGN_OFF,
      footer: [
        'This email is about your employment record, so it is always sent and cannot be turned off.',
      ],
    },
    { sender: changedBy },
  );
}

/** Somebody a colleague has named as their cover while they are away. */
export function coverNamedEmail(facts: {
  cover: Person;
  /** Whose leave it is. */
  absentee: Person;
  /** Who named the cover: the absentee, their manager, or HR. */
  namedBy: Person;
  from: CalendarDate;
  to: CalendarDate;
  /** Whatever identifies this naming, so naming the same cover twice sends once. */
  reference: string;
  links: PortalLinks;
}): NewOutboxEmail {
  const { cover, absentee, namedBy } = facts;
  const period =
    facts.from === facts.to
      ? `on ${formatDay(facts.from)}`
      : `from ${formatDay(facts.from)} to ${formatDay(facts.to)}`;

  return message(
    'COVER_NAMED',
    cover,
    `${nameOf(absentee)} has named you as cover ${period}`,
    {
      preview: `Colleagues will be pointed to you while ${absentee.firstName} is away.`,
      greeting: `Hello ${cover.firstName},`,
      paragraphs: [
        `${nameOf(absentee)} is on leave ${period} and has named you as the person to contact instead.`,
        ...(namedBy.id === absentee.id
          ? []
          : [`${nameOf(namedBy)} named you on ${absentee.firstName}'s behalf.`]),
        `While ${absentee.firstName} is away, their profile in the directory will point colleagues to you.`,
        'If you cannot cover those dates, reply to this email to let them know.',
      ],
      action: {
        label: `View ${absentee.firstName}'s profile`,
        href: facts.links.profile(absentee.id),
      },
      signOff: SIGN_OFF,
      footer: canTurnOff(
        'You get this because a colleague named you as their cover.',
        cover,
        facts.links,
      ),
    },
    { dedupeKey: `COVER_NAMED:${facts.reference}:${cover.id}`, sender: namedBy },
  );
}

/**
 * A message one colleague wrote to another from their profile, and the writer's copy.
 *
 * The message is theirs, word for word, under their name and with replies to them; the
 * portal only carries it. The copy stands in for the Sent folder a message from the portal
 * never reaches, and a reply to the copy writes to the person it was sent to.
 */
export function directMessageEmails(facts: {
  from: Person;
  to: Person;
  message: Message;
  links: PortalLinks;
}): { message: NewOutboxEmail; copy: NewOutboxEmail } {
  const { from, to } = facts;
  const written = facts.message.message.split(/\n[ \t]*\n+/).filter((one) => one.trim() !== '');

  const toThem = message(
    'DIRECT_MESSAGE',
    to,
    facts.message.subject,
    {
      preview: written[0] ?? facts.message.subject,
      greeting: `${nameOf(from)} sent you a message from the Remat Portal:`,
      paragraphs: [],
      quote: { title: facts.message.subject, paragraphs: written },
      afterFacts: [`Reply to this email to answer ${from.firstName} directly.`],
      action: {
        label: `View ${from.firstName}'s profile`,
        href: facts.links.profile(from.id),
        quiet: true,
      },
      signOff: SIGN_OFF,
      footer: ['Messages from colleagues are always sent. If one is not appropriate, tell HR.'],
    },
    { sender: from },
  );

  const copy = message(
    'DIRECT_MESSAGE',
    from,
    `Copy: ${facts.message.subject}`,
    {
      preview: `Your message to ${nameOf(to)}.`,
      greeting: `Hello ${from.firstName},`,
      paragraphs: [`This is a copy of the message you sent to ${nameOf(to)}:`],
      quote: { title: facts.message.subject, paragraphs: written },
      afterFacts: [
        `Their reply will come to your inbox. Replying to this copy writes to ${to.firstName}.`,
      ],
      action: {
        label: `View ${to.firstName}'s profile`,
        href: facts.links.profile(to.id),
        quiet: true,
      },
      signOff: SIGN_OFF,
      footer: ['You get a copy of every message you send from the directory.'],
    },
    { sender: from, replyTo: to.workEmail, fromName: BRAND_NAME },
  );

  return { message: toThem, copy };
}

function nameOf(person: Person): string {
  return `${person.firstName} ${person.lastName}`;
}

function nameAndTitle(person: Person): string {
  return person.jobTitle === null ? nameOf(person) : `${nameOf(person)}, ${person.jobTitle}`;
}

/** " as Analyst in Finance", or " in Finance" where there is no title yet. */
function roleIn(person: Person, department: string): string {
  return person.jobTitle === null ? ` in ${department}` : ` as ${person.jobTitle} in ${department}`;
}

/** "today", "tomorrow", "in 9 days". */
function whenFrom(today: CalendarDate, day: CalendarDate): string {
  const days = calendarDaysBetween(today, day) - 1;

  return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${String(days)} days`;
}
