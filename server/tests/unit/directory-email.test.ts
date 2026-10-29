import { describe, expect, it } from 'vitest';
import {
  ABOUT_EACH_EMAIL,
  coverNamedEmail,
  directMessageEmails,
  DIRECTORY_EMAILS,
  InvalidMessage,
  LONGEST_MESSAGE,
  validateMessage,
  DirectoryEmailNotFound,
  InvalidEmailChoice,
  isOptional,
  leaverHasReportsEmail,
  newColleagueEmail,
  newReportEmail,
  OPTIONAL_EMAILS,
  type Person,
  portalLinks,
  readDirectoryEmail,
  readReceives,
  recordChangedEmail,
  warningDue,
  welcomeEmail,
} from '../../src/apps/directory/email.js';
import type { NewOutboxEmail } from '../../src/core/notification/outbox.js';

/**
 * What each of the directory's emails says, to whom, and from whom.
 *
 * Pure, so every email is composed here against people written out by hand. Who is sent which
 * on which day is ../integration/email.test.ts.
 */

const links = portalLinks('https://portal.rematholdings.com/');

const esi: Person = {
  id: '20',
  firstName: 'Esi',
  lastName: 'Appiah',
  workEmail: 'esi.appiah@rematholdings.com',
  jobTitle: 'Operations Officer',
};
const kofi: Person = {
  id: '10',
  firstName: 'Kofi',
  lastName: 'Boateng',
  workEmail: 'kofi.boateng@rematholdings.com',
  jobTitle: 'Operations Team Lead',
};
const adwoa: Person = {
  id: '11',
  firstName: 'Adwoa',
  lastName: 'Frimpong',
  workEmail: 'adwoa.frimpong@rematholdings.com',
  jobTitle: 'Operations Officer',
};
const ama: Person = {
  id: '2',
  firstName: 'Ama',
  lastName: 'Mensah',
  workEmail: 'ama.mensah@rematholdings.com',
  jobTitle: 'Head of Human Resources and Administration',
};

const everyEmail: Record<string, NewOutboxEmail> = {
  WELCOME: welcomeEmail({
    joiner: esi,
    manager: kofi,
    department: 'Operations',
    startDate: '2026-11-02',
    links,
  }),
  NEW_REPORT: newReportEmail({
    manager: kofi,
    joiner: esi,
    department: 'Operations',
    startDate: '2026-11-02',
    links,
  }),
  NEW_COLLEAGUE: newColleagueEmail({
    colleague: adwoa,
    joiner: esi,
    manager: kofi,
    department: 'Operations',
    startDate: '2026-11-02',
    links,
  }),
  LEAVER_HAS_REPORTS: leaverHasReportsEmail({
    hr: ama,
    leaver: kofi,
    reports: [adwoa, esi],
    exitDate: '2026-11-10',
    today: '2026-11-02',
    stage: 'FIRST',
    links,
  }),
  RECORD_CHANGED: recordChangedEmail({
    employee: adwoa,
    changes: [{ label: 'Job title', from: 'Operations Officer', to: 'Senior Operations Officer' }],
    changedBy: ama,
    managerChanged: false,
    links,
  }),
  COVER_NAMED: coverNamedEmail({
    cover: adwoa,
    absentee: kofi,
    namedBy: kofi,
    from: '2026-12-21',
    to: '2026-12-31',
    reference: 'cover-1',
    links,
  }),
  DIRECT_MESSAGE: directMessageEmails({
    from: ama,
    to: kofi,
    message: { subject: 'Rota training on Friday', message: 'Hello Kofi,\n\nCan you come?' },
    links,
  }).message,
};

describe('every email', () => {
  it('is composed here, one for each the directory sends', () => {
    expect(Object.keys(everyEmail).sort()).toEqual([...DIRECTORY_EMAILS].sort());
  });

  it.each(Object.entries(everyEmail))(
    '%s has a subject, a plain text part and an HTML part',
    (kind, email) => {
      expect(email.kind).toBe(kind);
      expect(email.subject.trim()).not.toBe('');
      expect(email.subject).not.toMatch(/[\r\n]/);
      expect(email.text.trim()).not.toBe('');
      expect(email.text).not.toMatch(/<[a-z/][^>]*>/i);
      expect(email.html).toContain('<meta name="viewport"');
    },
  );

  it.each(Object.entries(everyEmail))(
    '%s links to a profile in the portal, in both parts',
    (_kind, email) => {
      expect(email.text).toMatch(/https:\/\/portal\.rematholdings\.com\/#\/directory\/\d+/);
      expect(email.html).toMatch(/href="https:\/\/portal\.rematholdings\.com\/#\/directory\/\d+"/);
    },
  );

  it.each(Object.entries(everyEmail))(
    '%s says in its small print whether it can be turned off',
    (kind, email) => {
      if (isOptional(kind as never)) {
        expect(email.text).toContain('You can turn these emails off on your profile');
      } else {
        expect(email.text).toContain('always sent');
        expect(email.text).not.toContain('turn these emails off');
      }
    },
  );

  it('says nothing with an em dash in it, as nothing a person reads does', () => {
    for (const email of Object.values(everyEmail)) {
      expect(`${email.subject}\n${email.text}`).not.toContain('—');
    }
  });
});

describe('the welcome', () => {
  const email = everyEmail.WELCOME;

  it('goes to the joiner, from the portal, and once per start date', () => {
    expect(email.to).toBe(esi.workEmail);
    expect(email.recipientEmployeeId).toBe(esi.id);
    expect(email.fromName).toBe('Remat Portal');
    expect(email.replyTo).toBeNull();
    expect(email.dedupeKey).toBe('WELCOME:20:2026-11-02');
  });

  it('asks them to complete their profile, and links to it', () => {
    expect(email.subject).toBe('Welcome to Remat, Esi');
    expect(email.text).toContain(
      'Complete your profile:\nhttps://portal.rematholdings.com/#/directory/20',
    );
    expect(email.text).toContain('You report to Kofi Boateng, Operations Team Lead');
  });

  it('still reads for somebody with no manager', () => {
    const top = welcomeEmail({
      joiner: esi,
      manager: null,
      department: 'Executive',
      startDate: '2026-11-02',
      links,
    });

    expect(top.text).toContain('Manager: Nobody');
    expect(top.text).not.toContain('You report to');
  });
});

describe('the introductions', () => {
  it('tell the manager their new report starts today', () => {
    const email = everyEmail.NEW_REPORT;

    expect(email.to).toBe(kofi.workEmail);
    expect(email.subject).toBe('Esi Appiah joins your team today');
    expect(email.text).toContain(
      'starts today as Operations Officer in Operations, reporting to you',
    );
    expect(email.dedupeKey).toBe('NEW_REPORT:20:2026-11-02:10');
  });

  it('tell each colleague, one message each', () => {
    const email = everyEmail.NEW_COLLEAGUE;

    expect(email.to).toBe(adwoa.workEmail);
    expect(email.subject).toBe('Say hello to Esi Appiah');
    expect(email.text).toContain('reporting to Kofi Boateng as you do');
    expect(email.dedupeKey).toBe('NEW_COLLEAGUE:20:2026-11-02:11');
  });
});

describe('the leaver warning', () => {
  const email = everyEmail.LEAVER_HAS_REPORTS;

  it('says what to do before the button that leads to it', () => {
    expect(email.text.indexOf('Move them to their new manager')).toBeLessThan(
      email.text.indexOf("View Kofi's profile"),
    );
  });

  it('names the day, how far off it is, and every report still there', () => {
    expect(email.to).toBe(ama.workEmail);
    expect(email.subject).toBe(
      'Kofi Boateng leaves on 10 November 2026 and still has 2 direct reports',
    );
    expect(email.text).toContain("Kofi Boateng's last day is 10 November 2026, in 8 days.");
    expect(email.text).toContain('Adwoa Frimpong: Operations Officer');
    expect(email.text).toContain('Esi Appiah: Operations Officer');
  });

  it('is sent once per stage, so the last warning is a second message rather than a repeat', () => {
    expect(email.dedupeKey).toBe('LEAVER_HAS_REPORTS:10:2026-11-10:FIRST:2');
  });

  it('is first due a fortnight out, again three days out, and not after the day', () => {
    expect(warningDue('2026-10-26', '2026-11-10')).toBeNull();
    expect(warningDue('2026-10-27', '2026-11-10')).toBe('FIRST');
    expect(warningDue('2026-11-06', '2026-11-10')).toBe('FIRST');
    expect(warningDue('2026-11-07', '2026-11-10')).toBe('LAST');
    expect(warningDue('2026-11-10', '2026-11-10')).toBe('LAST');
    expect(warningDue('2026-11-11', '2026-11-10')).toBeNull();
  });
});

describe('a change to somebody’s record', () => {
  it('shows who made it as the sender, from the system address, with replies to them', () => {
    const email = everyEmail.RECORD_CHANGED;

    expect(email.to).toBe(adwoa.workEmail);
    expect(email.fromName).toBe('Ama Mensah via Remat Portal');
    expect(email.replyTo).toBe(ama.workEmail);
  });

  it('says what changed, from what to what', () => {
    const email = everyEmail.RECORD_CHANGED;

    expect(email.subject).toBe('Your job title has changed');
    expect(email.text).toContain('Ama Mensah has updated your employee record');
    expect(email.text).toContain('Job title: Senior Operations Officer (was Operations Officer)');
    expect(email.text).toContain('reply to this email or speak to HR');
  });

  it('says where their leave goes now, when it was the manager that changed', () => {
    const email = recordChangedEmail({
      employee: adwoa,
      changes: [
        { label: 'Manager', from: 'Kofi Boateng', to: 'Akosua Darko' },
        { label: 'Department', from: 'Operations', to: 'Finance' },
      ],
      changedBy: ama,
      managerChanged: true,
      links,
    });

    expect(email.subject).toBe('Your employee record has changed');
    expect(email.text).toContain('Your leave requests now go to your new manager');
  });

  it('comes from the system, and asks for no reply, when nobody made it', () => {
    const email = recordChangedEmail({
      employee: adwoa,
      changes: [{ label: 'Manager', from: 'Kofi Boateng', to: 'Akosua Darko' }],
      changedBy: null,
      managerChanged: true,
      links,
    });

    expect(email.fromName).toBe('Remat Portal');
    expect(email.replyTo).toBeNull();
    expect(email.text).toContain('Your employee record has been updated');
    expect(email.text).not.toContain('reply to this email');
  });

  it('is sent every time, with no dedupe key: two changes are two emails', () => {
    expect(everyEmail.RECORD_CHANGED.dedupeKey).toBeNull();
  });
});

describe('being named as cover', () => {
  it('says whose leave, for which dates, and is from the person who named them', () => {
    const email = everyEmail.COVER_NAMED;

    expect(email.to).toBe(adwoa.workEmail);
    expect(email.subject).toBe(
      'Kofi Boateng has named you as cover from 21 December 2026 to 31 December 2026',
    );
    expect(email.fromName).toBe('Kofi Boateng via Remat Portal');
    expect(email.replyTo).toBe(kofi.workEmail);
    expect(email.dedupeKey).toBe('COVER_NAMED:cover-1:11');
  });

  it('says so when somebody else named them on the person’s behalf', () => {
    const email = coverNamedEmail({
      cover: adwoa,
      absentee: kofi,
      namedBy: ama,
      from: '2026-12-24',
      to: '2026-12-24',
      reference: 'cover-2',
      links,
    });

    expect(email.subject).toBe('Kofi Boateng has named you as cover on 24 December 2026');
    expect(email.text).toContain("Ama Mensah named you on Kofi's behalf.");
    expect(email.fromName).toBe('Ama Mensah via Remat Portal');
  });
});

describe('a message from a colleague', () => {
  const { message, copy } = directMessageEmails({
    from: ama,
    to: kofi,
    message: {
      subject: 'Rota training on Friday',
      message: 'Hello Kofi,\n\nCan you come on Friday?\nIt starts at 10.\n\n<b>Thanks</b>',
    },
    links,
  });

  it('goes to them in the writer’s name, with replies to the writer', () => {
    expect(message.to).toBe(kofi.workEmail);
    expect(message.subject).toBe('Rota training on Friday');
    expect(message.fromName).toBe('Ama Mensah via Remat Portal');
    expect(message.replyTo).toBe(ama.workEmail);
    expect(message.senderEmployeeId).toBe(ama.id);
  });

  it('sets what they wrote apart under its subject, quoted in the plain text', () => {
    expect(message.text).toContain(
      '> Rota training on Friday\n>\n> Hello Kofi,\n>\n> Can you come on Friday?\n> It starts at 10.',
    );
    expect(message.html).toMatch(/class="quote"[\s\S]*Rota training on Friday[\s\S]*Can you come/);
  });

  it('makes the profile link a small one, since the message is the point', () => {
    expect(message.html).not.toContain('class="button"');
    expect(message.html).toContain('font-size:14px;font-weight:600');
  });

  it('carries what they wrote, word for word, with its line breaks and no markup of its own', () => {
    expect(message.html).toContain('Can you come on Friday?<br>It starts at 10.');
    expect(message.html).toContain('&lt;b&gt;Thanks&lt;/b&gt;');
    expect(message.html).not.toContain('<b>Thanks</b>');
  });

  it('sends the writer a copy, whose reply goes to the person they wrote to', () => {
    expect(copy.to).toBe(ama.workEmail);
    expect(copy.subject).toBe('Copy: Rota training on Friday');
    expect(copy.fromName).toBe('Remat Portal');
    expect(copy.replyTo).toBe(kofi.workEmail);
    expect(copy.senderEmployeeId).toBe(ama.id);
    expect(copy.text).toContain('This is a copy of the message you sent to Kofi Boateng');
  });

  it('needs a subject and a message, within their lengths', () => {
    expect(validateMessage({ subject: '  Hi\r\nthere ', message: ' Hello \r\n' })).toEqual({
      subject: 'Hi there',
      message: 'Hello',
    });

    for (const [body, field] of [
      [{ subject: '', message: 'Hello' }, 'subject'],
      [{ subject: 'x'.repeat(151), message: 'Hello' }, 'subject'],
      [{ subject: 'Hi', message: '   ' }, 'message'],
      [{ subject: 'Hi', message: 'x'.repeat(LONGEST_MESSAGE + 1) }, 'message'],
      [undefined, 'subject'],
    ] as const) {
      expect(() => validateMessage(body)).toThrow(InvalidMessage);

      try {
        validateMessage(body);
      } catch (error) {
        expect((error as InvalidMessage).field).toBe(field);
      }
    }
  });
});

describe('what may be turned off', () => {
  it('is the introductions to a team and being named as cover, and nothing else', () => {
    expect([...OPTIONAL_EMAILS].sort()).toEqual(['COVER_NAMED', 'NEW_COLLEAGUE']);
  });

  it('describes every email for the screen people choose on', () => {
    for (const email of DIRECTORY_EMAILS) {
      expect(ABOUT_EACH_EMAIL[email].label).not.toBe('');
      expect(ABOUT_EACH_EMAIL[email].description).not.toBe('');
    }
  });

  it('reads an email by its name, and refuses one that is not', () => {
    expect(readDirectoryEmail('NEW_COLLEAGUE')).toBe('NEW_COLLEAGUE');
    expect(() => readDirectoryEmail('EVERYTHING')).toThrow(DirectoryEmailNotFound);
  });

  it('takes a choice as true or false, and nothing else', () => {
    expect(readReceives({ receives: false })).toBe(false);
    expect(readReceives({ receives: true })).toBe(true);
    expect(() => readReceives({ receives: 'no' })).toThrow(InvalidEmailChoice);
    expect(() => readReceives(undefined)).toThrow(InvalidEmailChoice);
  });
});
