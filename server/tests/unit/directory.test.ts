import { describe, expect, it } from 'vitest';
import { signedInAs, theSystem } from '../../src/core/auth/actor.js';
import type { Department } from '../../src/core/organisation/department/department.js';
import type { Employee } from '../../src/core/organisation/employee/employee.js';
import { directoryFor, isCurrentOn } from '../../src/apps/directory/directory.js';
import { directoryPolicy } from '../../src/apps/directory/policy.js';
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

  it('carries nothing from the record but what the directory shows', () => {
    expect(Object.keys(directory.people[0]).sort()).toEqual([
      'backOn',
      'department',
      'employeeId',
      'firstName',
      'jobTitle',
      'lastName',
      'workEmail',
    ]);
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
