import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { databaseForThisFile } from '../setup/test-database.js';
import type { Kysely } from 'kysely';
import { type Actor, signedInAs, theSystem } from '../../src/core/auth/actor.js';
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
import { AwayTodayService } from '../../src/apps/leave/team/away-today.service.js';
import { DirectoryService } from '../../src/apps/directory/directory.service.js';
import type { Directory } from '../../src/apps/directory/directory.js';
import { recordingMailer } from '../support/recording-mailer.js';
import { recordingDenials } from '../support/recording-denials.js';
import { seed } from '../../seeds/seed.mjs';
import { holidayRecalculationService } from '../support/holiday-recalculations.js';
import { delegationService } from '../support/delegations.js';

/**
 * The staff directory, over HTTP and against the leave tables.
 *
 * Four claims:
 *
 *   **It needs a session.** Like everything else behind the line.
 *
 *   **It is everybody current, by surname.** A leaver is not in it.
 *
 *   **Away is agreed leave only, with the day they are back.** A request still being decided
 *   marks nobody.
 *
 *   **Nothing but the directory's fields leaves the server.** No manager, no employee number,
 *   no kind of leave.
 */

const testDatabaseUrl = await databaseForThisFile();

const SECRET = 'a-test-signing-secret-of-at-least-32-chars';

const system = theSystem('directory api integration fixtures');

let db: Kysely<Database>;
let admin: Client;
let server: Server;
let origin: string;
let guard: Guard;
/** NFR SEC 03. Every refusal the guard wrote down, for the 403 tests to read back. */
const denials = recordingDenials();
let balances: BalanceService;
let requests: LeaveRequestService;
let people: Record<string, string>;
let annualId: string;
let y2026: string;

beforeAll(async () => {
  db = databaseFor(testDatabaseUrl);

  admin = new Client({ connectionString: testDatabaseUrl });
  await admin.connect();

  guard = new Guard(denials);
  const employees = new EmployeeRepository(db);
  const accounts = new SignInAccountRepository(db);
  const roles = new RoleRepository(db);
  const cached = new BalanceRepository(db);

  balances = new BalanceService(cached, guard, employees, new Transactions(db));

  const types = new LeaveTypeRepository(db);
  const years = new LeaveYearRepository(db);
  const leaveRequests = new LeaveRequestRepository(db);
  const decisions = new LeaveDecisionRepository(db);

  requests = new LeaveRequestService(
    balances,
    guard,
    employees,
    types,
    years,
    leaveRequests,
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
  );

  const app = buildApp({
    guard,
    signIn: new SignInService(accounts, employees, roles, recordingMailer(), guard, {
      domains: ['rematholdings.com'],
    }),
    balances: cached,
    ledger: new LedgerRepository(db),
    adjustments: balances,
    employees,
    departments: new DepartmentRepository(db),
    types,
    years,
    entitlementRules: new EntitlementRuleRepository(db),
    requests: leaveRequests,
    leaveRequests: requests,
    decisions,
    routing: new LeaveRoutingRepository(db),
    withdrawals: new WithdrawalRepository(db),
    drafts: new LeaveRequestDraftRepository(db),
    attachments: new AttachmentRepository(db),
    attachmentLinks: new AttachmentLinkRepository(db),
    holidays: new HolidayRepository(db),
    patterns: new WorkPatternRepository(db),
    holidayRecalculations: holidayRecalculationService(db, guard, balances),
    storage: new InMemoryStorage(),
    scanner: new SignatureScanner(),
    accounts,
    roles,
    delegations: delegationService(db, guard),
    organisation: new OrganisationRepository(db),
    emailWording: new EmailWordingRepository(db),
    audit: new AuditRepository(db),
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
  denials.clear();

  await admin.query('TRUNCATE leave_balance');
  await admin.query(
    'TRUNCATE notification, leave_entitlement_event, leave_ledger_entry, attachment_access, attachment_download_link, leave_request_recalculation, leave_request_reclassification, leave_request_attachment, leave_request_decision, leave_request_reassignment, leave_request_routing, leave_request_withdrawal, leave_request_reversal, leave_request',
  );

  people = (await seed(admin)) as Record<string, string>;

  annualId = (await admin.query<{ id: string }>("SELECT id FROM leave_type WHERE code = 'ANNUAL'"))
    .rows[0].id;
  y2026 = (await admin.query<{ id: string }>("SELECT id FROM leave_year WHERE label = '2026'"))
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

describe('who may read it', () => {
  it('needs a session like everything else behind the line', async () => {
    expect((await fetch(`${origin}/api/directory`)).status).toBe(401);
  });

  it('is any employee, not only HR', async () => {
    const response = await get('/api/directory', people.officer);

    expect(response.status).toBe(200);
  });
});

describe('who is in it', () => {
  it('is every current member of staff, by surname, and not the leaver', async () => {
    const directory = await directoryAs(people.officer);

    expect(directory.people.map((one) => `${one.firstName} ${one.lastName}`)).toEqual([
      'Selorm Adjei',
      'Kwame Asante',
      'Kofi Boateng',
      'Yaw Boateng',
      'Efe Danquah',
      'Akosua Darko',
      'Adwoa Frimpong',
      'Yram Kudjo',
      'Ama Mensah',
      'Efua Owusu',
      'Nana Owusu-Ansah',
      'Abena Sarpong',
    ]);
    expect(directory.people.map((one) => one.employeeId)).not.toContain(people.leaver);
  });

  it('names each person’s department, and offers each department once', async () => {
    const directory = await directoryAs(people.officer);

    const efe = directory.people.find((one) => one.employeeId === people.financeManager);

    expect(efe?.department.name).toBe('Finance');
    expect(directory.departments.map((one) => one.name)).toContain('Operations');
    expect(new Set(directory.departments.map((one) => one.id)).size).toBe(
      directory.departments.length,
    );
  });

  it('carries the directory’s fields and nothing else from the record', async () => {
    const directory = await directoryAs(people.officer);

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

    const wire = JSON.stringify(directory);

    expect(wire).not.toContain('managerId');
    expect(wire).not.toContain('RH-0');
    expect(wire).not.toContain('startDate');
  });

  it('dates today as ten characters', async () => {
    expect((await directoryAs(people.officer)).today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('the organisation chart', () => {
  it('needs a session', async () => {
    expect((await fetch(`${origin}/api/directory/chart`)).status).toBe(401);
  });

  it('is any employee’s, not only HR’s', async () => {
    expect((await get('/api/directory/chart', people.officer)).status).toBe(200);
  });

  /* The story's first criterion: every line on the chart is the manager on a record. */
  it('matches the reporting lines in the employee records, for everybody current', async () => {
    const chart = await chartAs(people.officer);

    expect(chart.lines).toHaveLength(1);
    expect(chart.lines[0].standing).toBe('HEAD_OF_THE_ORGANISATION');
    expect(chart.lines[0].top.employeeId).toBe(people.ceo);

    const { rows } = await admin.query<{ id: string; manager_id: string | null }>(
      "SELECT id::text, manager_id::text FROM employee WHERE employment_status = 'ACTIVE'",
    );
    const drawn = linesOf(chart.lines[0].top, null);

    expect(drawn.sort()).toEqual(rows.map((row) => `${row.manager_id} -> ${row.id}`).sort());
    expect(chart.total).toBe(rows.length);
  });

  it('leaves out the leaver', async () => {
    expect(JSON.stringify(await chartAs(people.officer))).not.toContain(`"${people.leaver}"`);
  });

  it('flags the team of a manager who has left, rather than dropping it', async () => {
    await admin.query(
      `UPDATE employee SET employment_status = 'TERMINATED', exit_date = '2026-01-31'
        WHERE id = $1`,
      [people.teamLead],
    );

    const chart = await chartAs(people.officer);

    expect(chart.lines.slice(1).map((line) => line.standing)).toEqual([
      'MANAGER_NOT_ON_THE_CHART',
      'MANAGER_NOT_ON_THE_CHART',
    ]);
    expect(
      chart.lines
        .slice(1)
        .map((line) => line.top.employeeId)
        .sort(),
    ).toEqual([people.officer, people.partTimer].sort());
  });

  it('carries a name and a job title of each person, and no employee number', async () => {
    const chart = await chartAs(people.officer);

    expect(Object.keys(chart.lines[0].top).sort()).toEqual([
      'employeeId',
      'firstName',
      'jobTitle',
      'lastName',
      'reports',
    ]);
    expect(JSON.stringify(chart)).not.toContain('RH-0');
  });
});

/**
 * Who is away, on a fixed day rather than the clock's, so the return dates can be asserted
 * exactly. The service is built as `buildApp` builds it, with a day handed in.
 */
describe('my own profile', () => {
  it('needs a session', async () => {
    expect((await fetch(`${origin}/api/me/profile`)).status).toBe(401);
  });

  it('is mine, with when I started and who I report to', async () => {
    const mine = await profileAs(people.officer);

    expect(mine.employeeId).toBe(people.officer);
    expect(mine.startDate).toBe('2023-08-14');
    expect(mine.manager).toMatchObject({
      employeeId: people.teamLead,
      firstName: 'Kofi',
      lastName: 'Boateng',
      jobTitle: 'Operations Team Lead',
    });
    expect(mine.workMobile).toBeNull();
    expect(mine.description).toBeNull();
  });
});

describe('changing my own profile', () => {
  it('saves my work mobile and description, live at once, for everybody to see', async () => {
    const response = await patch(people.officer, people.officer, {
      workMobile: '024 555 0197',
      description: 'Come to me about tender notices.',
    });

    expect(response.status).toBe(200);
    expect(((await response.json()) as JsonProfile).description).toBe(
      'Come to me about tender notices.',
    );

    /* No approval step: a colleague reading the directory straight after sees it. */
    const seen = (await directoryAs(people.partTimer)).people.find(
      (one) => one.employeeId === people.officer,
    );

    expect(seen?.workMobile).toBe('024 555 0197');
    expect(seen?.description).toBe('Come to me about tender notices.');
  });

  it('is audited: the old value, the new one, who changed it and when', async () => {
    const before = new Date();

    await patch(people.officer, people.officer, { description: 'First.' });
    await patch(people.officer, people.officer, { description: 'Second.' });

    const { rows } = await admin.query<{
      action: string;
      before: { description: string | null };
      after: { description: string | null };
      actor_employee_id: string;
      occurred_at: Date;
    }>(
      `SELECT action, before, after, actor_employee_id, occurred_at
         FROM audit_log
        WHERE entity = 'employee' AND entity_id = $1
        ORDER BY id DESC
        LIMIT 1`,
      [people.officer],
    );

    expect(rows[0].action).toBe('UPDATE');
    expect(rows[0].before.description).toBe('First.');
    expect(rows[0].after.description).toBe('Second.');
    expect(String(rows[0].actor_employee_id)).toBe(people.officer);
    expect(rows[0].occurred_at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5_000);
  });

  it('clears a field sent empty', async () => {
    await patch(people.officer, people.officer, { workMobile: '024 555 0197' });
    await patch(people.officer, people.officer, { workMobile: '' });

    expect((await profileAs(people.officer)).workMobile).toBeNull();
  });

  it('refuses a 400 character description, naming the field and the limit', async () => {
    const response = await patch(people.officer, people.officer, { description: 'a'.repeat(400) });
    const body = (await response.json()) as { field: string; message: string };

    expect(response.status).toBe(400);
    expect(body.field).toBe('description');
    expect(body.message).toBe('Description must be 280 characters or fewer. It is 400.');
    expect((await profileAs(people.officer)).description).toBeNull();
  });

  it('refuses a work mobile that is not a phone number', async () => {
    const response = await patch(people.officer, people.officer, { workMobile: 'call me' });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { field: string }).field).toBe('workMobile');
  });

  it('refuses any field HR keeps, and changes nothing', async () => {
    const response = await patch(people.officer, people.officer, {
      description: 'Fine.',
      jobTitle: 'Chief Executive Officer',
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { field: string }).field).toBe('jobTitle');

    const mine = await profileAs(people.officer);

    expect(mine.jobTitle).toBe('Operations Officer');
    expect(mine.description).toBeNull();
  });
});

describe('changing somebody else’s profile', () => {
  it('is refused with a 403, and the attempt is logged', async () => {
    const response = await patch(people.officer, people.partTimer, { description: 'Hacked.' });

    expect(response.status).toBe(403);
    expect(((await response.json()) as { message: string }).message).toContain(
      'only change your own profile',
    );

    expect(denials.last()).toMatchObject({
      employeeId: people.officer,
      resource: 'directory',
      action: 'editProfile',
      subject: people.partTimer,
    });
  });

  it('and changes nothing', async () => {
    await patch(people.officer, people.partTimer, { description: 'Hacked.' });

    expect((await profileAs(people.partTimer)).description).toBeNull();
  });

  it('is refused to HR as well', async () => {
    expect((await patch(people.hrOfficer, people.officer, { description: 'HR.' })).status).toBe(
      403,
    );
  });

  it('and is a 403 whether or not the id is anybody', async () => {
    expect((await patch(people.officer, '999999', { description: 'Nobody.' })).status).toBe(403);
  });
});

describe('who is away today', () => {
  it('is somebody on agreed leave, with the working day they are back', async () => {
    await grant(people.officer, 20);
    await agreed(people.officer, asAdwoa(), '2026-11-02', '2026-11-06');

    const directory = await directoryOn('2026-11-04');

    expect(entryOf(directory, people.officer).backOn).toBe('2026-11-09');
    expect(entryOf(directory, people.partTimer).backOn).toBeNull();
  });

  it('and not somebody whose request is still being decided', async () => {
    await grant(people.officer, 20);
    await requests.submit(asAdwoa(), week('2026-11-02', '2026-11-06'));

    expect(entryOf(await directoryOn('2026-11-04'), people.officer).backOn).toBeNull();
  });

  it('and not before the leave starts or after it ends', async () => {
    await grant(people.officer, 20);
    await agreed(people.officer, asAdwoa(), '2026-11-02', '2026-11-06');

    expect(entryOf(await directoryOn('2026-10-30'), people.officer).backOn).toBeNull();
    expect(entryOf(await directoryOn('2026-11-09'), people.officer).backOn).toBeNull();
  });

  /* Abena works Monday, Tuesday, Thursday and Friday, so leave ending on a Tuesday has her
     back on the Thursday. */
  it('and skips the days that person does not work', async () => {
    await grant(people.partTimer, 16);
    await agreed(people.partTimer, asAbena(), '2026-11-02', '2026-11-03');

    expect(entryOf(await directoryOn('2026-11-02'), people.partTimer).backOn).toBe('2026-11-05');
  });
});

/* --------------------------------------------------------------------------- helpers */

interface JsonEntry {
  employeeId: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  department: { id: string; name: string };
  workEmail: string;
  backOn: string | null;
  workMobile: string | null;
  description: string | null;
}

interface JsonProfile extends JsonEntry {
  startDate: string;
  manager: { employeeId: string; firstName: string; lastName: string; jobTitle: string } | null;
}

interface JsonDirectory {
  today: string;
  people: JsonEntry[];
  departments: { id: string; name: string }[];
}

interface JsonChartPerson {
  employeeId: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  reports: JsonChartPerson[];
}

interface JsonChart {
  today: string;
  lines: { standing: string; top: JsonChartPerson }[];
  total: number;
}

async function chartAs(employeeId: string): Promise<JsonChart> {
  const response = await get('/api/directory/chart', employeeId);

  expect(response.status).toBe(200);

  return (await response.json()) as JsonChart;
}

/** Every line drawn under somebody, as "manager -> report". */
function linesOf(person: JsonChartPerson, above: string | null): string[] {
  return [
    `${above} -> ${person.employeeId}`,
    ...person.reports.flatMap((report) => linesOf(report, person.employeeId)),
  ];
}

function get(path: string, employeeId: string): Promise<Response> {
  return fetch(`${origin}${path}`, {
    headers: { cookie: `${SESSION_COOKIE}=${mintSession(employeeId, SECRET)}` },
  });
}

async function directoryAs(employeeId: string): Promise<JsonDirectory> {
  const response = await get('/api/directory', employeeId);

  expect(response.status).toBe(200);

  return (await response.json()) as JsonDirectory;
}

async function profileAs(employeeId: string): Promise<JsonProfile> {
  const response = await get('/api/me/profile', employeeId);

  expect(response.status).toBe(200);

  return (await response.json()) as JsonProfile;
}

/** Somebody, signed in as `as`, changing the profile on `whose` record. */
function patch(as: string, whose: string, body: unknown): Promise<Response> {
  return fetch(`${origin}/api/people/${whose}/profile`, {
    method: 'PATCH',
    headers: {
      cookie: `${SESSION_COOKIE}=${mintSession(as, SECRET)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/** The directory as it reads on one day. */
function directoryOn(today: string): Promise<Directory> {
  const employees = new EmployeeRepository(db);

  return new DirectoryService(
    guard,
    employees,
    new DepartmentRepository(db),
    new AwayTodayService(
      new LeaveRequestRepository(db),
      employees,
      new WorkPatternRepository(db),
      new HolidayRepository(db),
    ),
    () => today,
  ).read(asAdwoa());
}

function entryOf(directory: Directory, employeeId: string) {
  const entry = directory.people.find((one) => one.employeeId === employeeId);

  if (entry === undefined) {
    throw new Error(`${employeeId} is not in the directory.`);
  }

  return entry;
}

function week(from: string, to: string) {
  return {
    employeeId: people.officer,
    leaveTypeId: annualId,
    from,
    to,
    reason: 'A week away',
    acknowledgesShortNotice: true,
  };
}

/** Asked for and agreed at every desk: annual leave sits with the manager, then with HR. */
async function agreed(employeeId: string, actor: Actor, from: string, to: string) {
  const { request } = await requests.submit(actor, { ...week(from, to), employeeId });

  const first = await requests.approve(asKofi(), request.id);

  if (first.request.status !== 'APPROVED') {
    await requests.approve(
      signedInAs(people.hrOfficer, { roles: ['EMPLOYEE', 'HR_OFFICER'], isManager: false }),
      request.id,
    );
  }
}

function asAdwoa(): Actor {
  return signedInAs(people.officer, { roles: ['EMPLOYEE'], isManager: false });
}

function asAbena(): Actor {
  return signedInAs(people.partTimer, { roles: ['EMPLOYEE'], isManager: false });
}

/** Kofi Boateng, who manages both of them. */
function asKofi(): Actor {
  return signedInAs(people.teamLead, { roles: ['EMPLOYEE'], isManager: true });
}

function grant(employeeId: string, days: number) {
  return balances.grantTheYear(system, {
    employeeId,
    leaveTypeId: annualId,
    leaveYearId: y2026,
    days,
    reason: 'Entitlement for the year',
  });
}
