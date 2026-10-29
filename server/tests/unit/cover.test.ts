import { describe, expect, it } from 'vitest';
import { signedInAs } from '../../src/core/auth/actor.js';
import type { Employee } from '../../src/core/organisation/employee/employee.js';
import type { RoleCode } from '../../src/core/identity/role/roles.js';
import {
  changesTo,
  clashesBetween,
  CoverIsTheAbsentee,
  insideTheLeave,
  InvalidCover,
  MOST_PARTS,
  type NamedCover,
  validateCoverParts,
} from '../../src/apps/leave/cover/cover.js';
import { coverPolicy } from '../../src/apps/leave/cover/policy.js';
import { coverOf, coveringFor, entryFor } from '../../src/apps/directory/directory.js';

/**
 * Who covers for somebody while they are on leave. #226.
 *
 * The pure half: what cover has to be, what naming it again changes, the days a cover is away
 * themselves, who may name it, and when the directory shows it. Whether the rows are really
 * there, and end with the leave, is ../integration/cover.test.ts's.
 *
 * Adwoa is away from 2 to 13 November. Kofi manages her. Ama is HR. Esi is a colleague.
 */

const ADWOA = 'adwoa';
const KOFI = 'kofi';
const ESI = 'esi';

const LEAVE = { employeeId: ADWOA, from: '2026-11-02', to: '2026-11-13' };

function part(coverId: string, from: string, to: string) {
  return { coverId, from, to };
}

function named(coverId: string, from: string, to: string, id = `${coverId}-${from}`): NamedCover {
  return {
    id,
    leaveRequestId: 'leave-1',
    coverId,
    from,
    to,
    namedBy: 'employee adwoa',
    namedAt: new Date('2026-10-20T09:00:00Z'),
  };
}

function person(id: string, roles: RoleCode[] = ['EMPLOYEE']) {
  return signedInAs(id, { roles, isManager: false });
}

function employee(id: string, fields: Partial<Employee> = {}): Employee {
  return {
    id,
    employeeNumber: `RH-${id}`,
    firstName: id,
    lastName: 'Test',
    workEmail: `${id}@rematholdings.com`,
    jobTitle: null,
    departmentId: 'ops',
    managerId: null,
    workPatternId: 'standard',
    startDate: '2020-01-06',
    exitDate: null,
    employmentType: 'FULL_TIME',
    employmentStatus: 'ACTIVE',
    gender: null,
    createdAt: new Date('2020-01-06T00:00:00Z'),
    updatedAt: new Date('2020-01-06T00:00:00Z'),
    ...fields,
  } as Employee;
}

/* ------------------------------------------------------------------ what cover is */

describe('naming cover', () => {
  it('takes one colleague for the whole leave', () => {
    expect(validateCoverParts({ parts: [part(KOFI, LEAVE.from, LEAVE.to)] }, LEAVE)).toEqual([
      part(KOFI, LEAVE.from, LEAVE.to),
    ]);
  });

  it('takes different people for different parts, soonest first', () => {
    expect(
      validateCoverParts(
        { parts: [part(ESI, '2026-11-09', '2026-11-13'), part(KOFI, '2026-11-02', '2026-11-06')] },
        LEAVE,
      ),
    ).toEqual([part(KOFI, '2026-11-02', '2026-11-06'), part(ESI, '2026-11-09', '2026-11-13')]);
  });

  it('takes no parts at all, which clears it', () => {
    expect(validateCoverParts({ parts: [] }, LEAVE)).toEqual([]);
  });

  it('is never the person on leave', () => {
    expect(() => validateCoverParts({ parts: [part(ADWOA, LEAVE.from, LEAVE.to)] }, LEAVE)).toThrow(
      CoverIsTheAbsentee,
    );
  });

  it('is inside the leave', () => {
    expect(() =>
      validateCoverParts({ parts: [part(KOFI, '2026-10-30', '2026-11-06')] }, LEAVE),
    ).toThrow(InvalidCover);
    expect(() =>
      validateCoverParts({ parts: [part(KOFI, '2026-11-02', '2026-11-16')] }, LEAVE),
    ).toThrow(InvalidCover);
  });

  it('names one person for each day', () => {
    expect(() =>
      validateCoverParts(
        { parts: [part(KOFI, '2026-11-02', '2026-11-06'), part(ESI, '2026-11-06', '2026-11-13')] },
        LEAVE,
      ),
    ).toThrow(/both include 6 November 2026/);
  });

  it('refuses dates the wrong way round, and dates that are not dates', () => {
    expect(() =>
      validateCoverParts({ parts: [part(KOFI, '2026-11-06', '2026-11-02')] }, LEAVE),
    ).toThrow(InvalidCover);
    expect(() =>
      validateCoverParts({ parts: [part(KOFI, 'Monday', '2026-11-06')] }, LEAVE),
    ).toThrow(InvalidCover);
  });

  it('refuses a body that is not a list of parts', () => {
    expect(() => validateCoverParts({ coverId: KOFI }, LEAVE)).toThrow(InvalidCover);
    expect(() => validateCoverParts(null, LEAVE)).toThrow(InvalidCover);
  });

  it(`is split into at most ${String(MOST_PARTS)} parts`, () => {
    const days = Array.from({ length: MOST_PARTS + 1 }, (_, at) =>
      part(
        KOFI,
        `2026-11-${String(2 + at).padStart(2, '0')}`,
        `2026-11-${String(2 + at).padStart(2, '0')}`,
      ),
    );

    expect(() => validateCoverParts({ parts: days }, { ...LEAVE, to: '2026-11-30' })).toThrow(
      InvalidCover,
    );
  });
});

describe('naming it again', () => {
  it('keeps what is unchanged, so nobody is told twice', () => {
    const standing = [
      named(KOFI, '2026-11-02', '2026-11-06'),
      named(ESI, '2026-11-09', '2026-11-13'),
    ];

    const change = changesTo(standing, [
      part(KOFI, '2026-11-02', '2026-11-06'),
      part(ESI, '2026-11-09', '2026-11-11'),
      part(KOFI, '2026-11-12', '2026-11-13'),
    ]);

    expect(change.keep.map((one) => one.id)).toEqual([standing[0].id]);
    expect(change.end.map((one) => one.id)).toEqual([standing[1].id]);
    expect(change.add).toEqual([
      part(ESI, '2026-11-09', '2026-11-11'),
      part(KOFI, '2026-11-12', '2026-11-13'),
    ]);
  });

  it('ends everything when no parts are sent', () => {
    const standing = [named(KOFI, LEAVE.from, LEAVE.to)];

    expect(changesTo(standing, [])).toEqual({ keep: [], end: standing, add: [] });
  });
});

describe('cover cut to the leave', () => {
  it('keeps the days inside it', () => {
    expect(
      insideTheLeave(part(KOFI, '2026-11-02', '2026-11-13'), {
        from: '2026-11-04',
        to: '2026-11-06',
      }),
    ).toEqual(part(KOFI, '2026-11-04', '2026-11-06'));
  });

  it('is nothing where none of it is inside', () => {
    expect(
      insideTheLeave(part(KOFI, '2026-11-09', '2026-11-13'), {
        from: '2026-11-02',
        to: '2026-11-06',
      }),
    ).toBeNull();
  });
});

/* ----------------------------------------------------------- a cover who is away too */

describe('a cover who is on leave themselves', () => {
  it('is warned about, for the days that overlap', () => {
    expect(
      clashesBetween(
        [part(KOFI, '2026-11-02', '2026-11-06'), part(ESI, '2026-11-09', '2026-11-13')],
        [
          { employeeId: KOFI, from: '2026-11-05', to: '2026-11-20' },
          { employeeId: ESI, from: '2026-12-01', to: '2026-12-05' },
          { employeeId: ADWOA, from: '2026-11-02', to: '2026-11-13' },
        ],
      ),
    ).toEqual([{ coverId: KOFI, from: '2026-11-05', to: '2026-11-06' }]);
  });

  it('is nothing to warn about when their leave is another week', () => {
    expect(
      clashesBetween(
        [part(KOFI, LEAVE.from, LEAVE.to)],
        [{ employeeId: KOFI, from: '2026-11-16', to: '2026-11-20' }],
      ),
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ who may name it */

describe('who may name cover', () => {
  const owner = { employeeId: ADWOA, managerId: KOFI };

  it('is the person on leave, their manager and HR', () => {
    expect(coverPolicy.name(person(ADWOA), owner).allowed).toBe(true);
    expect(coverPolicy.name(person(KOFI), owner).allowed).toBe(true);
    expect(coverPolicy.name(person('ama', ['EMPLOYEE', 'HR_OFFICER']), owner).allowed).toBe(true);
  });

  it('is not a colleague, who is refused without being told whose leave it is', () => {
    const decision = coverPolicy.name(person(ESI), owner);

    expect(decision.allowed).toBe(false);
    expect(decision.told).toBeNull();
  });

  it('is not a system administrator, who may read it and is told why not', () => {
    const admin = person('sys', ['EMPLOYEE', 'SYS_ADMIN']);

    expect(coverPolicy.read(admin, owner).allowed).toBe(true);
    expect(coverPolicy.name(admin, owner)).toMatchObject({
      allowed: false,
      told: 'Only the person on leave, their manager or HR can name their cover.',
    });
  });

  it('and the colleague named is not who decides it', () => {
    expect(coverPolicy.read(person(ESI), owner).allowed).toBe(false);
  });
});

/* ------------------------------------------------------------ what the directory shows */

describe('the directory', () => {
  const TODAY = '2026-11-04';
  const adwoa = employee(ADWOA, { managerId: KOFI });
  const kofi = employee(KOFI);
  const department = { id: 'ops', name: 'Operations' } as never;

  it('names the cover beside somebody away today', () => {
    const cover = coverOf(ADWOA, [{ employeeId: ADWOA, coverId: KOFI }], [adwoa, kofi], TODAY);

    expect(
      entryFor(adwoa, department, '2026-11-16', undefined, undefined, cover).cover,
    ).toMatchObject({ employeeId: KOFI });
  });

  it('and nobody beside somebody who is in', () => {
    const cover = coverOf(ADWOA, [{ employeeId: ADWOA, coverId: KOFI }], [adwoa, kofi], TODAY);

    expect(entryFor(adwoa, department, undefined, undefined, undefined, cover).cover).toBeNull();
  });

  it('and nobody where the cover has since left the company', () => {
    const gone = employee(KOFI, { employmentStatus: 'TERMINATED', exitDate: '2026-11-03' });

    expect(
      coverOf(ADWOA, [{ employeeId: ADWOA, coverId: KOFI }], [adwoa, gone], TODAY),
    ).toBeUndefined();
  });

  it('shows the cover whose leave they are covering, leaving out anybody who has left', () => {
    const left = employee(ESI, { employmentStatus: 'TERMINATED', exitDate: '2026-10-31' });

    expect(
      coveringFor(
        [
          { absenteeId: ADWOA, from: '2026-11-02', to: '2026-11-13', agreed: true },
          { absenteeId: ESI, from: '2026-11-20', to: '2026-11-21', agreed: false },
        ],
        [adwoa, left],
        TODAY,
      ),
    ).toEqual([
      {
        person: expect.objectContaining({ employeeId: ADWOA }) as unknown,
        from: '2026-11-02',
        to: '2026-11-13',
        agreed: true,
      },
    ]);
  });
});
