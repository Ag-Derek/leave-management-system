import { describe, expect, it } from 'vitest';
import type { Employee } from '../../src/core/organisation/employee/employee.js';
import { planLeaverReports } from '../../src/core/organisation/employee/leaver-reports.js';
import {
  type LeaverReportsRun,
  summaryOfLeaverReports,
} from '../../src/core/organisation/employee/leaver-reports.job.js';

/**
 * A leaver's reports, moved to the manager above them on the day after their last day.
 *
 * Ama heads the organisation; Efua reports to her; Kofi and Akosua report to Efua.
 */

const LAST_DAY = '2026-10-27';

function person(id: string, managerId: string | null, fields: Partial<Employee> = {}): Employee {
  return {
    id,
    employeeNumber: `RH-${id}`,
    firstName: id.charAt(0).toUpperCase() + id.slice(1),
    lastName: 'Mensah',
    workEmail: `${id}@rematholdings.com`,
    jobTitle: null,
    departmentId: 'ops',
    managerId,
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

const left = { employmentStatus: 'TERMINATED', exitDate: LAST_DAY } as const;

function organisation(efua: Partial<Employee> = left): Employee[] {
  return [
    person('ama', null),
    person('efua', 'ama', efua),
    person('kofi', 'efua'),
    person('akosua', 'efua'),
  ];
}

describe('a leaver’s reports', () => {
  it('stay with them through their last day', () => {
    expect(planLeaverReports(organisation(), LAST_DAY)).toEqual({ moves: [], stranded: [] });
  });

  it('move to the leaver’s own manager on the day after', () => {
    expect(planLeaverReports(organisation(), '2026-10-28').moves).toEqual([
      { employeeId: 'kofi', leaverId: 'efua', toId: 'ama' },
      { employeeId: 'akosua', leaverId: 'efua', toId: 'ama' },
    ]);
  });

  it('do not move while the leaver is only serving notice', () => {
    const notice = { employmentStatus: 'ACTIVE', exitDate: '2026-11-30' } as const;

    expect(planLeaverReports(organisation(notice), '2026-10-28').moves).toEqual([]);
  });

  it('do not move when HR has recorded the leaver early and the last day is still to come', () => {
    const early = { employmentStatus: 'TERMINATED', exitDate: '2026-11-30' } as const;

    expect(planLeaverReports(organisation(early), '2026-10-28').moves).toEqual([]);
  });

  it('go further up when the leaver’s manager has gone too', () => {
    const plan = planLeaverReports(
      [
        person('ama', null),
        person('yaw', 'ama', left),
        person('efua', 'yaw', left),
        person('kofi', 'efua'),
      ],
      '2026-10-28',
    );

    expect(plan.moves).toEqual([{ employeeId: 'kofi', leaverId: 'efua', toId: 'ama' }]);
  });

  it('skip a manager above who is suspended, or recorded as leaving later', () => {
    const plan = planLeaverReports(
      [
        person('ama', null),
        person('nii', 'ama', { employmentStatus: 'TERMINATED', exitDate: '2026-12-31' }),
        person('yaw', 'nii', { employmentStatus: 'SUSPENDED' }),
        person('efua', 'yaw', left),
        person('kofi', 'efua'),
      ],
      '2026-10-28',
    );

    expect(plan.moves).toEqual([{ employeeId: 'kofi', leaverId: 'efua', toId: 'ama' }]);
  });

  it('are not moved when they have left as well, so their history stays as it was', () => {
    const plan = planLeaverReports(
      [...organisation(), person('kojo', 'efua', { ...left, exitDate: '2026-09-30' })],
      '2026-10-28',
    );

    expect(plan.moves.map((move) => move.employeeId)).not.toContain('kojo');
  });

  it('include somebody who has not started yet, who still needs a manager when they do', () => {
    const plan = planLeaverReports(
      [...organisation(), person('esi', 'efua', { startDate: '2026-11-02' })],
      '2026-10-28',
    );

    expect(plan.moves.map((move) => move.employeeId)).toContain('esi');
  });

  it('are left where they are, and said to be, when the leaver headed the organisation', () => {
    const plan = planLeaverReports(
      [person('ama', null, left), person('efua', 'ama'), person('kofi', 'efua')],
      '2026-10-28',
    );

    expect(plan.moves).toEqual([]);
    expect(plan.stranded).toEqual([
      {
        employeeId: 'efua',
        leaverId: 'ama',
        because: expect.stringContaining('headed the organisation') as unknown,
      },
    ]);
  });

  it('survive a reporting line that loops above the leaver', () => {
    const plan = planLeaverReports(
      [person('yaw', 'nii', left), person('nii', 'yaw', left), person('kofi', 'yaw')],
      '2026-10-28',
    );

    expect(plan.moves).toEqual([]);
    expect(plan.stranded).toHaveLength(1);
  });
});

describe('the log line', () => {
  const run = (fields: Partial<LeaverReportsRun>): LeaverReportsRun => ({
    asAt: '2026-10-28',
    moved: [],
    stranded: [],
    ...fields,
  });

  it('is nothing when there was nothing to do', () => {
    expect(summaryOfLeaverReports(run({}))).toBeUndefined();
  });

  it('counts what moved and what was left for HR', () => {
    expect(
      summaryOfLeaverReports(
        run({ moved: [{ employeeId: 'kofi', leaverId: 'efua', toId: 'ama' }] }),
      ),
    ).toContain('1 moved, 0 left for HR');
  });
});
