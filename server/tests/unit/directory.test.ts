import { describe, expect, it } from 'vitest';
import { signedInAs, theSystem } from '../../src/core/auth/actor.js';
import type { Department } from '../../src/core/organisation/department/department.js';
import type { Employee } from '../../src/core/organisation/employee/employee.js';
import {
  type ChartPerson,
  directoryFor,
  isCurrentOn,
  staffChartFor,
} from '../../src/apps/directory/directory.js';
import { directoryPolicy } from '../../src/apps/directory/policy.js';
import {
  DESCRIPTION_LIMIT,
  descriptionFrom,
  InvalidProfile,
  validateProfileEdit,
  workMobileFrom,
} from '../../src/apps/directory/profile.js';
import { firstDayBack } from '../../src/apps/leave/team/away-today.js';

/** The staff directory, as rules. */

const TODAY = '2026-10-27';

const OPERATIONS = department('ops', 'Operations');
const FINANCE = department('finance', 'Finance');

describe('who is current', () => {
  it('is somebody active who has started and not left', () => {
    expect(isCurrentOn(person({ id: 'a' }), TODAY)).toBe(true);
  });

  it('includes somebody who started today', () => {
    expect(isCurrentOn(person({ id: 'a', startDate: TODAY }), TODAY)).toBe(true);
  });

  it('includes somebody whose last day is today', () => {
    expect(isCurrentOn(person({ id: 'a', exitDate: TODAY }), TODAY)).toBe(true);
  });

  it('leaves out somebody who has not started yet', () => {
    expect(isCurrentOn(person({ id: 'a', startDate: '2026-10-28' }), TODAY)).toBe(false);
  });

  it('leaves out somebody whose exit date has passed', () => {
    expect(isCurrentOn(person({ id: 'a', exitDate: '2026-10-26' }), TODAY)).toBe(false);
  });

  it('leaves out anybody who is not ACTIVE', () => {
    expect(isCurrentOn(person({ id: 'a', employmentStatus: 'SUSPENDED' }), TODAY)).toBe(false);
    expect(
      isCurrentOn(
        person({ id: 'a', employmentStatus: 'TERMINATED', exitDate: '2026-07-31' }),
        TODAY,
      ),
    ).toBe(false);
  });
});

describe('the directory', () => {
  const everybody = [
    person({ id: 'yaw', firstName: 'Yaw', lastName: 'Boateng', departmentId: FINANCE.id }),
    person({ id: 'akosua', firstName: 'Akosua', lastName: 'Darko' }),
    person({ id: 'kofi', firstName: 'Kofi', lastName: 'Boateng' }),
    person({ id: 'abena', firstName: 'Abena', lastName: 'Ásante' }),
    person({ id: 'kojo', firstName: 'Kojo', lastName: 'Antwi', exitDate: '2026-07-31' }),
  ];

  const directory = directoryFor({
    employees: everybody,
    departments: [OPERATIONS, FINANCE, department('empty', 'Nobody here')],
    away: [{ employeeId: 'akosua', backOn: '2026-11-02' }],
    profiles: [{ employeeId: 'kofi', workMobile: '024 555 0197', description: 'Tenders.' }],
    today: TODAY,
  });

  it('lists only the people who are current', () => {
    expect(directory.people.map((one) => one.employeeId)).not.toContain('kojo');
    expect(directory.people).toHaveLength(4);
  });

  it('sorts by surname, then first name, ignoring accents', () => {
    expect(directory.people.map((one) => `${one.firstName} ${one.lastName}`)).toEqual([
      'Abena Ásante',
      'Kofi Boateng',
      'Yaw Boateng',
      'Akosua Darko',
    ]);
  });

  it('names each person’s department', () => {
    const yaw = directory.people.find((one) => one.employeeId === 'yaw');

    expect(yaw?.department).toEqual({ id: 'finance', name: 'Finance' });
  });

  it('marks who is away with the day they are back, and nobody else', () => {
    expect(directory.people.find((one) => one.employeeId === 'akosua')?.backOn).toBe('2026-11-02');
    expect(directory.people.find((one) => one.employeeId === 'kofi')?.backOn).toBeNull();
  });

  it('offers only departments somebody listed is in', () => {
    expect(directory.departments.map((one) => one.name)).toEqual(['Finance', 'Operations']);
  });

  it('shows what each person keeps themselves, and nothing for somebody who said nothing', () => {
    const kofi = directory.people.find((one) => one.employeeId === 'kofi');
    const yaw = directory.people.find((one) => one.employeeId === 'yaw');

    expect(kofi?.workMobile).toBe('024 555 0197');
    expect(kofi?.description).toBe('Tenders.');
    expect(yaw?.workMobile).toBeNull();
    expect(yaw?.description).toBeNull();
  });

  it('carries nothing from the record but what the directory shows', () => {
    expect(Object.keys(directory.people[0]).sort()).toEqual([
      'backOn',
      'department',
      'description',
      'employeeId',
      'firstName',
      'jobTitle',
      'lastName',
      'workEmail',
      'workMobile',
    ]);
  });
});

describe('the organisation chart', () => {
  const organisation = [
    person({ id: 'ama', firstName: 'Ama', lastName: 'Owusu', jobTitle: 'Chief Executive' }),
    person({ id: 'efua', firstName: 'Efua', lastName: 'Darko', managerId: 'ama' }),
    person({ id: 'yaw', firstName: 'Yaw', lastName: 'Boateng', managerId: 'ama' }),
    person({ id: 'kofi', firstName: 'Kofi', lastName: 'Addo', managerId: 'efua' }),
    person({ id: 'akosua', firstName: 'Akosua', lastName: 'Asante', managerId: 'efua' }),
  ];

  it('is drawn from the manager on each record, the head at the top', () => {
    const chart = staffChartFor(organisation, TODAY);

    expect(chart.lines).toHaveLength(1);
    expect(chart.lines[0].standing).toBe('HEAD_OF_THE_ORGANISATION');
    expect(shape(chart.lines[0].top)).toEqual({
      ama: { yaw: {}, efua: { kofi: {}, akosua: {} } },
    });
    expect(chart.total).toBe(5);
  });

  it('puts each person’s reports in surname order', () => {
    const efua = staffChartFor(organisation, TODAY).lines[0].top.reports[1];

    expect(efua.reports.map((one) => one.lastName)).toEqual(['Addo', 'Asante']);
  });

  it('leaves out anybody who is not current', () => {
    const chart = staffChartFor(
      [
        ...organisation,
        person({ id: 'kojo', managerId: 'efua', exitDate: '2026-07-31' }),
        person({ id: 'new', managerId: 'efua', startDate: '2026-11-02' }),
      ],
      TODAY,
    );

    expect(chart.total).toBe(5);
    expect(JSON.stringify(chart)).not.toContain('kojo');
    expect(JSON.stringify(chart)).not.toContain('"new"');
  });

  /* The fault the chart is for spotting, as the staff chart sees it: the manager is gone
     from it, so their team is a line of its own and says why. */
  it('flags a team whose manager has left, and still draws all of it', () => {
    const chart = staffChartFor(
      organisation.map((one) =>
        one.id === 'efua'
          ? { ...one, employmentStatus: 'TERMINATED' as const, exitDate: '2026-07-31' }
          : one,
      ),
      TODAY,
    );

    expect(chart.lines.map((line) => line.standing)).toEqual([
      'HEAD_OF_THE_ORGANISATION',
      'MANAGER_NOT_ON_THE_CHART',
      'MANAGER_NOT_ON_THE_CHART',
    ]);
    expect(chart.total).toBe(4);
  });

  it('flags a reporting line that goes round in a circle rather than following it for ever', () => {
    const chart = staffChartFor(
      [
        ...organisation,
        person({ id: 'nii', firstName: 'Nii', lastName: 'Lartey', managerId: 'adwoa' }),
        person({ id: 'adwoa', firstName: 'Adwoa', lastName: 'Tetteh', managerId: 'nii' }),
      ],
      TODAY,
    );

    expect(chart.lines.map((line) => line.standing)).toEqual([
      'HEAD_OF_THE_ORGANISATION',
      'REPORTING_LINE_LOOPS',
    ]);
    expect(chart.total).toBe(7);
  });

  it('flags a second person with no manager', () => {
    const chart = staffChartFor(
      [...organisation, person({ id: 'nii', firstName: 'Nii', lastName: 'Lartey' })],
      TODAY,
    );

    expect(chart.lines.map((line) => line.standing)).toEqual([
      'HEAD_OF_THE_ORGANISATION',
      'SECOND_HEAD',
    ]);
  });

  it('is an empty chart, not a failure, when nobody is current', () => {
    expect(staffChartFor([], TODAY)).toEqual({ today: TODAY, lines: [], total: 0 });
  });

  it('carries a name and a job title of each person, and nothing else from the record', () => {
    const top = staffChartFor(organisation, TODAY).lines[0].top;

    expect(Object.keys(top).sort()).toEqual([
      'employeeId',
      'firstName',
      'jobTitle',
      'lastName',
      'reports',
    ]);
    expect(JSON.stringify(top)).not.toContain('RH-');
    expect(JSON.stringify(top)).not.toContain('managerId');
  });

  /** A branch as nested ids, so a whole shape reads as one line. */
  function shape(top: ChartPerson): Record<string, unknown> {
    return {
      [top.employeeId]: Object.assign({}, ...top.reports.map(shape)) as Record<string, unknown>,
    };
  }
});

describe('who may read the organisation chart', () => {
  it('is any employee', () => {
    expect(
      directoryPolicy.chart(signedInAs('adwoa', { roles: ['EMPLOYEE'], isManager: false })).allowed,
    ).toBe(true);
  });

  it('and not an actor with nobody behind it', () => {
    expect(directoryPolicy.chart(theSystem('a directory unit test')).allowed).toBe(false);
  });
});

describe('changing your own profile', () => {
  it('accepts a work mobile and a description', () => {
    expect(
      validateProfileEdit({ workMobile: ' 024  555 0197 ', description: '  Tenders.  ' }),
    ).toEqual({ workMobile: '024 555 0197', description: 'Tenders.' });
  });

  it('clears either one when it is sent empty or null', () => {
    expect(validateProfileEdit({ workMobile: '', description: null })).toEqual({
      workMobile: null,
      description: null,
    });
  });

  it('leaves out what was not sent', () => {
    expect(validateProfileEdit({ description: 'Tenders.' })).toEqual({ description: 'Tenders.' });
  });

  it('refuses any field HR keeps, naming it', () => {
    expect(() => validateProfileEdit({ jobTitle: 'Chief Executive Officer' })).toThrow(
      expect.objectContaining({ name: 'InvalidProfile', field: 'jobTitle' }),
    );
    expect(() => validateProfileEdit({ description: 'Fine', managerId: '1' })).toThrow(
      /managerId is kept by HR/,
    );
  });

  it('knows the photo is one of the three, and says changing it is not available yet', () => {
    expect(() => validateProfileEdit({ photo: null })).toThrow(
      expect.objectContaining({
        field: 'photo',
        message: expect.stringContaining('not available yet'),
      }),
    );
  });

  it('refuses a body that is not one object', () => {
    expect(() => validateProfileEdit('Tenders.')).toThrow(InvalidProfile);
    expect(() => validateProfileEdit([])).toThrow(InvalidProfile);
  });
});

describe('a description', () => {
  it('may be 280 characters', () => {
    expect(descriptionFrom('a'.repeat(DESCRIPTION_LIMIT))).toHaveLength(280);
  });

  it('may not be 400, and the refusal names the field, the limit and the length', () => {
    expect(() => descriptionFrom('a'.repeat(400))).toThrow(
      'Description must be 280 characters or fewer. It is 400.',
    );
  });

  it('counts an emoji as one character, as the screen does', () => {
    expect(descriptionFrom('🙂'.repeat(DESCRIPTION_LIMIT))).not.toBeNull();
  });

  it('is nothing when it is only spaces', () => {
    expect(descriptionFrom('   ')).toBeNull();
  });
});

describe('a work mobile', () => {
  it.each(['0245550197', '024 555 0197', '024-555-0197', '+233 24 555 0197', '+44 20 7946 0958'])(
    'accepts %s',
    (number) => {
      expect(workMobileFrom(number)).toBe(number);
    },
  );

  it.each(['12345', '024 555 019', '24 555 0197 1', '+233', 'call me', '024 555 0197 ext 4'])(
    'refuses %s, naming the field and the shape it wants',
    (number) => {
      expect(() => workMobileFrom(number)).toThrow(/^Work mobile must be a phone number/);
    },
  );

  it('refuses one longer than the 20 characters the record holds', () => {
    expect(() => workMobileFrom('+233 (0) 24 555 01 97 00')).toThrow(/20 characters or fewer/);
  });
});

describe('when somebody away is back', () => {
  const weekdays = (day: string) => {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    return weekday !== 0 && weekday !== 6;
  };

  it('is undefined for somebody who is in', () => {
    expect(firstDayBack([{ from: '2026-11-02', to: '2026-11-06' }], weekdays, TODAY)).toBe(
      undefined,
    );
  });

  it('is the day after the leave ends, when that is a working day', () => {
    expect(firstDayBack([{ from: '2026-10-26', to: '2026-10-28' }], weekdays, TODAY)).toBe(
      '2026-10-29',
    );
  });

  it('skips a weekend', () => {
    expect(firstDayBack([{ from: '2026-10-26', to: '2026-10-30' }], weekdays, TODAY)).toBe(
      '2026-11-02',
    );
  });

  it('skips a public holiday, and days the person does not work', () => {
    /* Works Monday, Tuesday, Thursday, Friday; Monday 2 November is a holiday. */
    const partTime = (day: string) =>
      day !== '2026-11-02' && [1, 2, 4, 5].includes(new Date(`${day}T00:00:00Z`).getUTCDay());

    expect(firstDayBack([{ from: '2026-10-26', to: '2026-10-29' }], partTime, TODAY)).toBe(
      '2026-10-30',
    );
    expect(firstDayBack([{ from: '2026-10-26', to: '2026-10-30' }], partTime, TODAY)).toBe(
      '2026-11-03',
    );
  });

  it('runs on through leave that starts where this ends', () => {
    expect(
      firstDayBack(
        [
          { from: '2026-11-02', to: '2026-11-06' },
          { from: '2026-10-26', to: '2026-10-30' },
        ],
        weekdays,
        TODAY,
      ),
    ).toBe('2026-11-09');
  });
});

describe('who may read the directory', () => {
  it('is any employee', () => {
    expect(
      directoryPolicy.read(signedInAs('adwoa', { roles: ['EMPLOYEE'], isManager: false })).allowed,
    ).toBe(true);
  });

  it('and not an actor with nobody behind it', () => {
    expect(directoryPolicy.read(theSystem('a directory unit test')).allowed).toBe(false);
  });
});

describe('who may change a profile', () => {
  const adwoa = signedInAs('adwoa', { roles: ['EMPLOYEE'], isManager: false });

  it('is the person whose record it is', () => {
    expect(directoryPolicy.editProfile(adwoa, 'adwoa').allowed).toBe(true);
  });

  it('and nobody else, openly, so the refusal is a 403 that says why', () => {
    const decision = directoryPolicy.editProfile(adwoa, 'kofi');

    expect(decision.allowed).toBe(false);
    expect(decision.told).toContain('only change your own profile');
  });

  it('and not HR either, who keep everything else on the record', () => {
    const hr = signedInAs('ama', { roles: ['EMPLOYEE', 'HR_ADMIN'], isManager: false });

    expect(directoryPolicy.editProfile(hr, 'adwoa').allowed).toBe(false);
  });

  it('and not the system, which is nobody', () => {
    expect(directoryPolicy.editProfile(theSystem('a directory unit test'), 'adwoa').allowed).toBe(
      false,
    );
  });
});

/* --------------------------------------------------------------------------- helpers */

function department(id: string, name: string): Department {
  return {
    id,
    name,
    parentId: null,
    isActive: true,
    createdAt: new Date('2020-01-01T00:00:00Z'),
    updatedAt: new Date('2020-01-01T00:00:00Z'),
  };
}

function person(fields: Partial<Employee> & { id: string }): Employee {
  return {
    employeeNumber: `RH-${fields.id}`,
    firstName: 'Someone',
    lastName: 'Somebody',
    workEmail: `${fields.id}@rematholdings.com`,
    jobTitle: 'Operations Officer',
    departmentId: OPERATIONS.id,
    managerId: null,
    workPatternId: 'standard',
    startDate: '2020-01-06',
    exitDate: null,
    employmentType: 'FULL_TIME',
    employmentStatus: 'ACTIVE',
    gender: null,
    createdAt: new Date('2020-01-01T00:00:00Z'),
    updatedAt: new Date('2020-01-01T00:00:00Z'),
    ...fields,
  };
}
