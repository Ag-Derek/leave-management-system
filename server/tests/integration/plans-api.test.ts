import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { databaseForThisFile } from '../setup/test-database.js';
import type { Kysely } from 'kysely';
import { Guard } from '../../src/core/auth/policy.js';
import { databaseFor } from '../../src/core/db/index.js';
import type { Database } from '../../src/core/db/schema.js';
import { BalanceRepository } from '../../src/apps/leave/balance/balance.db.js';
import { DepartmentRepository } from '../../src/core/organisation/department/department.db.js';
import { EmployeeRepository } from '../../src/core/organisation/employee/employee.db.js';
import { EntitlementRuleRepository } from '../../src/apps/leave/entitlement/entitlement-rule.db.js';
import { HolidayRepository } from '../../src/apps/leave/holiday/holiday.db.js';
import { LeaveDecisionRepository } from '../../src/apps/leave/leave-request/leave-decision.db.js';
import { LeaveRequestRepository } from '../../src/apps/leave/leave-request/leave-request.db.js';
import { ReclassificationRepository } from '../../src/apps/leave/leave-request/reclassification.db.js';
import { LeaveRoutingRepository } from '../../src/apps/leave/leave-request/routing.db.js';
import { LeaveRequestDraftRepository } from '../../src/apps/leave/leave-request/draft.db.js';
import { AttachmentRepository } from '../../src/apps/leave/leave-request/attachment.db.js';
import { AttachmentLinkRepository } from '../../src/apps/leave/leave-request/attachment-link.db.js';
import { SignatureScanner } from '../../src/core/scanning/signature-scanner.js';
import { InMemoryStorage } from '../support/in-memory-storage.js';
import { WithdrawalRepository } from '../../src/apps/leave/leave-request/withdrawal.db.js';
import { LeaveTypeRepository } from '../../src/apps/leave/leave-type/leave-type.db.js';
import { LeaveYearRepository } from '../../src/apps/leave/leave-year/leave-year.db.js';
import { LedgerRepository } from '../../src/apps/leave/balance/ledger.db.js';
import { NotificationRepository } from '../../src/apps/leave/notification/notification.db.js';
import { EmailWordingRepository } from '../../src/apps/leave/notification/wording.db.js';
import { AuditRepository } from '../../src/core/audit/audit.db.js';
import { OrganisationRepository } from '../../src/core/organisation/settings/organisation.db.js';
import { RoleRepository } from '../../src/core/identity/role/role.db.js';
import { SignInAccountRepository } from '../../src/core/identity/sign-in/sign-in-account.db.js';
import { Transactions } from '../../src/core/db/transaction.js';
import { WorkPatternRepository } from '../../src/core/calendar/work-pattern/work-pattern.db.js';
import { buildApp } from '../../src/app.js';
import {
  mintSession,
  SESSION_COOKIE,
} from '../../src/core/identity/sign-in/session-cookie.routes.js';
import { BalanceService } from '../../src/apps/leave/balance/balance.service.js';
import { LeaveCalculatorService } from '../../src/apps/leave/leave-calculator/leave-calculator.service.js';
import { LeaveRequestService } from '../../src/apps/leave/leave-request/leave-request.service.js';
import { NotificationService } from '../../src/apps/leave/notification/notification.service.js';
import { SignInService } from '../../src/core/identity/sign-in/sign-in.service.js';
import { recordingMailer } from '../support/recording-mailer.js';
import { seed } from '../../seeds/seed.mjs';
import { holidayRecalculationService } from '../support/holiday-recalculations.js';
import { delegationService } from '../support/delegations.js';
import { LeavePlanRepository } from '../../src/apps/leave/plan/plan.db.js';

/** Planning leave, over HTTP: one's own plans, and the calendar a department shares. */

const testDatabaseUrl = await databaseForThisFile();

const SECRET = 'a-test-signing-secret-of-at-least-32-chars';

const guard = new Guard();

let db: Kysely<Database>;
let admin: Client;
let server: Server;
let origin: string;
let people: Record<string, string>;
let annualId: string;

/** A week in November, Monday to Friday, ahead of today in the seeded 2026 year. */
const A_WEEK = { from: '2026-11-16', to: '2026-11-20' };

interface JsonPlanBook {
  plans: { planId: string; from: string; to: string; days: number; note: string | null }[];
  totals: { leaveTypeId: string; planned: number; available: number | null; over: boolean }[];
}

beforeAll(async () => {
  db = databaseFor(testDatabaseUrl);

  admin = new Client({ connectionString: testDatabaseUrl });
  await admin.connect();

  const employees = new EmployeeRepository(db);
  const accounts = new SignInAccountRepository(db);
  const roles = new RoleRepository(db);
  const types = new LeaveTypeRepository(db);
  const requestRepository = new LeaveRequestRepository(db);
  const decisions = new LeaveDecisionRepository(db);
  const yearRepository = new LeaveYearRepository(db);

  const balances = new BalanceService(
    new BalanceRepository(db),
    guard,
    employees,
    new Transactions(db),
  );

  const app = buildApp({
    guard,
    signIn: new SignInService(accounts, employees, roles, recordingMailer(), guard, {
      domains: ['rematholdings.com'],
    }),
    balances: new BalanceRepository(db),
    ledger: new LedgerRepository(db),
    adjustments: balances,
    employees,
    departments: new DepartmentRepository(db),
    types,
    years: yearRepository,
    entitlementRules: new EntitlementRuleRepository(db),
    requests: requestRepository,
    leaveRequests: new LeaveRequestService(
      balances,
      guard,
      employees,
      types,
      yearRepository,
      requestRepository,
      decisions,
      new LeaveRoutingRepository(db),
      new WithdrawalRepository(db),
      new ReclassificationRepository(db),
      new AttachmentRepository(db),
      new RoleRepository(db),
      delegationService(db, guard),
      new OrganisationRepository(db),
      new LeaveCalculatorService(new WorkPatternRepository(db), new HolidayRepository(db), guard),
      new NotificationService(new NotificationRepository(db), recordingMailer(), guard),
    ),
    decisions,
    routing: new LeaveRoutingRepository(db),
    withdrawals: new WithdrawalRepository(db),
    drafts: new LeaveRequestDraftRepository(db),
    attachments: new AttachmentRepository(db),
    attachmentLinks: new AttachmentLinkRepository(db),
    holidays: new HolidayRepository(db),
    holidayRecalculations: holidayRecalculationService(db, guard, balances),
    storage: new InMemoryStorage(),
    scanner: new SignatureScanner(),
    accounts,
    roles,
    delegations: delegationService(db, guard),
    organisation: new OrganisationRepository(db),
    emailWording: new EmailWordingRepository(db),
    audit: new AuditRepository(db),
    planning: {
      plans: new LeavePlanRepository(db),
      calculator: new LeaveCalculatorService(
        new WorkPatternRepository(db),
        new HolidayRepository(db),
        guard,
      ),
    },
    secret: SECRET,
  });

  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => {
      resolve(listening);
    });
  });

  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

beforeEach(async () => {
  people = (await seed(admin)) as Record<string, string>;
  annualId = (await admin.query<{ id: string }>("SELECT id FROM leave_type WHERE code = 'ANNUAL'"))
    .rows[0].id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });

  await db?.destroy();
  await admin?.end();
});

describe('my own plans', () => {
  it('are added, and listed with what they would cost against the balance', async () => {
    const added = await send('POST', '/api/me/plans', people.officer, {
      leaveTypeId: annualId,
      ...A_WEEK,
      note: 'Family visit, if cover allows',
    });
    expect(added.status).toBe(201);

    const book = await planBookOf(people.officer);

    expect(book.plans).toEqual([
      expect.objectContaining({ ...A_WEEK, days: 5, note: 'Family visit, if cover allows' }),
    ]);
    /* Nothing has been granted in this fixture, so five days is past what is left: a
       warning on the figures, and the plan was still saved above. */
    expect(book.totals).toEqual([
      expect.objectContaining({ leaveTypeId: annualId, planned: 5, available: 0, over: true }),
    ]);
  });

  it('may not overlap each other', async () => {
    await send('POST', '/api/me/plans', people.officer, { leaveTypeId: annualId, ...A_WEEK });

    const again = await send('POST', '/api/me/plans', people.officer, {
      leaveTypeId: annualId,
      from: '2026-11-18',
      to: '2026-11-25',
    });

    expect(again.status).toBe(409);
  });

  it('are for leave still to come', async () => {
    const past = await send('POST', '/api/me/plans', people.officer, {
      leaveTypeId: annualId,
      from: '2026-03-02',
      to: '2026-03-06',
    });

    expect(past.status).toBe(400);
    expect(((await past.json()) as { field: string }).field).toBe('to');
  });

  it('are changed and removed by their owner, and by nobody else', async () => {
    const { planId } = (await (
      await send('POST', '/api/me/plans', people.officer, { leaveTypeId: annualId, ...A_WEEK })
    ).json()) as { planId: string };

    const byAColleague = await send('DELETE', `/api/me/plans/${planId}`, people.engineer);
    expect(byAColleague.status).toBe(404);

    const moved = await send('PUT', `/api/me/plans/${planId}`, people.officer, {
      leaveTypeId: annualId,
      from: '2026-11-23',
      to: '2026-11-27',
    });
    expect(moved.status).toBe(200);

    expect((await send('DELETE', `/api/me/plans/${planId}`, people.officer)).status).toBe(204);
    expect((await planBookOf(people.officer)).plans).toEqual([]);
  });
});

describe('plans on the team calendar', () => {
  it('show a colleague the dates, and not the kind of leave or the note', async () => {
    await send('POST', '/api/me/plans', people.officer, {
      leaveTypeId: annualId,
      ...A_WEEK,
      note: 'A private note about a hospital appointment',
    });

    const response = await send('GET', '/api/me/calendar', people.teamLead);
    const text = await response.text();
    const calendar = JSON.parse(text) as {
      colleagues: { employeeId: string; planned: { from: string; to: string }[] }[];
      plannedDays: { date: string }[];
    };

    const officer = calendar.colleagues.find((one) => one.employeeId === people.officer);

    expect(officer?.planned).toEqual([expect.objectContaining(A_WEEK)]);
    expect(calendar.plannedDays.map((day) => day.date)).toContain('2026-11-18');
    expect(text).not.toContain('hospital');
    expect(text).not.toContain('Annual Leave');
  });
});

async function planBookOf(employeeId: string): Promise<JsonPlanBook> {
  const response = await send('GET', '/api/me/plans', employeeId);

  expect(response.status).toBe(200);

  return (await response.json()) as JsonPlanBook;
}

function send(
  method: string,
  path: string,
  employeeId: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: `${SESSION_COOKIE}=${mintSession(employeeId, SECRET)}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
