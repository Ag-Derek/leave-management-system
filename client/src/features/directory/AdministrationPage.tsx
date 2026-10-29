import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  administrationList,
  type AdministrationList,
  isNotSignedIn,
  type LoginToCreate,
  loginsToCreate,
  type PersonNamed,
  type Standing,
  type StaffRecord,
} from '../../api';
import { day, weekday } from '../../format';
import { Icon } from '../../Icon';
import { Notice, type Problem, problemFrom } from '../../problem';
import { Avatar, fold } from './person';

/** Where somebody's record is opened for HR. */
export function recordAddress(person: Pick<PersonNamed, 'employeeId'>): string {
  return `#/directory/admin/${encodeURIComponent(person.employeeId)}`;
}

export const NEW_RECORD_ADDRESS = '#/directory/admin/new';

/** The standing filter, in the words the list uses. */
const STANDING_FILTERS: { value: Standing | ''; label: string }[] = [
  { value: '', label: 'Everybody' },
  { value: 'CURRENT', label: 'Current staff' },
  { value: 'STARTING', label: 'Starters' },
  { value: 'LEAVING', label: 'Leaving' },
  { value: 'LEFT', label: 'Leavers' },
  { value: 'SUSPENDED', label: 'Suspended' },
];

/**
 * HR's Administration tab, at `#/directory/admin`: every record, leavers included.
 *
 * Fetched once and filtered here, as the directory is. Somebody who creates logins and keeps
 * no records sees only the people waiting for one.
 */
export function AdministrationPage({
  administer,
  onSignedOut,
}: {
  /** The server said this reader may keep records, not only create logins. */
  administer: boolean;
  onSignedOut: () => void;
}) {
  return administer ? (
    <Records onSignedOut={onSignedOut} />
  ) : (
    <LoginsOnly onSignedOut={onSignedOut} />
  );
}

function Records({ onSignedOut }: { onSignedOut: () => void }) {
  const [list, setList] = useState<AdministrationList | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [standing, setStanding] = useState<Standing | ''>('');

  const load = useCallback(() => {
    setLoading(true);

    administrationList()
      .then((found) => {
        setList(found);
        setProblem(undefined);
      })
      .catch((error: unknown) => {
        if (isNotSignedIn(error)) {
          onSignedOut();
          return;
        }

        setProblem(problemFrom(error));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [onSignedOut]);

  useEffect(load, [load]);

  const searchable = useMemo(
    () =>
      (list?.records ?? []).map((record) => ({
        record,
        text: fold(
          [
            record.firstName,
            record.lastName,
            record.jobTitle ?? '',
            record.department.name,
            record.workEmail,
            record.employeeNumber,
          ].join(' '),
        ),
      })),
    [list],
  );

  const terms = fold(search).split(/\s+/).filter(Boolean);

  const shown = searchable
    .filter(
      ({ record, text }) =>
        (departmentId === '' || record.department.id === departmentId) &&
        (standing === '' || record.standing === standing) &&
        terms.every((term) => text.includes(term)),
    )
    .map((one) => one.record);

  const filtered = terms.length > 0 || departmentId !== '' || standing !== '';

  return (
    <>
      {list === undefined ? null : (
        <LoginBanner waiting={list.loginsToCreate} administrators={list.systemAdministrators} />
      )}

      <div className="admin-heading">
        <div>
          <h2>Employee records</h2>
          {list === undefined ? null : <p className="muted">{tally(list.records)}</p>}
        </div>

        <a className="admin-add" href={NEW_RECORD_ADDRESS}>
          <Icon name="plus" />
          Add an employee
        </a>
      </div>

      <div className="filter-bar directory-filters">
        <label className="filter-search">
          <span className="visually-hidden">Search the records</span>
          <Icon name="search" />
          <input
            type="search"
            value={search}
            placeholder="Search by name, job title, email or employee number"
            autoComplete="off"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </label>

        <label>
          <span className="visually-hidden">Department</span>
          <select
            value={departmentId}
            disabled={list === undefined}
            onChange={(event) => {
              setDepartmentId(event.target.value);
            }}
          >
            <option value="">All departments</option>
            {list?.departments.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="visually-hidden">Status</span>
          <select
            value={standing}
            disabled={list === undefined}
            onChange={(event) => {
              setStanding(event.target.value as Standing | '');
            }}
          >
            {STANDING_FILTERS.map((one) => (
              <option key={one.value} value={one.value}>
                {one.label}
              </option>
            ))}
          </select>
        </label>

        <p className="visually-hidden" aria-live="polite">
          {list !== undefined && filtered
            ? `${String(shown.length)} of ${String(list.records.length)} records`
            : null}
        </p>
      </div>

      {problem === undefined ? null : (
        <Notice problem={problem} retrying={loading} onRetry={load} />
      )}

      {list === undefined ? null : shown.length === 0 ? (
        <div className="notice plain directory-empty">
          <p>Nobody matches that.</p>
          <button
            type="button"
            className="linkish"
            onClick={() => {
              setSearch('');
              setDepartmentId('');
              setStanding('');
            }}
          >
            Clear the filters
          </button>
        </div>
      ) : (
        <RecordsTable records={shown} today={list.today} />
      )}

      <p className="muted admin-footnote">
        Records are never deleted, because leave history depends on them. Somebody who has left
        stops being listed in the directory and keeps their record here. An exit date cannot be set
        on anybody who still has people reporting to them: move their reports first.
      </p>
    </>
  );
}

function RecordsTable({ records, today }: { records: StaffRecord[]; today: string }) {
  return (
    <div className="directory-card">
      <table className="directory-table admin-table">
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Department</th>
            <th scope="col">Dates</th>
            <th scope="col">Access</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr
              key={record.employeeId}
              className={rowClass(record)}
              onClick={(event) => {
                if (!(event.target as HTMLElement).closest('a')) {
                  window.location.hash = recordAddress(record);
                }
              }}
            >
              <td className="directory-person">
                <Avatar person={record} />
                <span>
                  <a href={recordAddress(record)}>
                    {record.firstName} {record.lastName}
                  </a>
                  {record.jobTitle === null ? null : <small>{record.jobTitle}</small>}
                </span>
              </td>
              <td className="directory-department">{record.department.name}</td>
              <td className={`admin-dates is-${record.standing.toLowerCase()}`}>
                {datesOf(record, today)}
              </td>
              <td>
                <Access record={record} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Whether somebody can sign in, said in the terms that matter for where they stand. */
export function Access({ record }: { record: Pick<StaffRecord, 'login' | 'standing'> }) {
  if (record.login === 'NONE') {
    return record.standing === 'LEFT' ? (
      <span className="muted">No login</span>
    ) : (
      <span className="tag access is-waiting">No login yet</span>
    );
  }

  if (record.login === 'CLOSED') {
    return <span className="muted">Login closed</span>;
  }

  /* A leaver whose login still opens is the one thing in this column somebody should act on. */
  return record.standing === 'LEFT' ? (
    <span className="tag access is-alarm">Login still active</span>
  ) : (
    <span className="presence">Login active</span>
  );
}

/** "Starts Mon 2 Nov", "Since 4 Mar 2025", "Leaves 30 Nov 2026", "Left 30 Sep 2026". */
export function datesOf(
  record: Pick<StaffRecord, 'standing' | 'startDate' | 'exitDate'>,
  today: string,
): string {
  const when = (iso: string) => (iso.slice(0, 4) === today.slice(0, 4) ? weekday(iso) : day(iso));

  switch (record.standing) {
    case 'STARTING':
      return `Starts ${when(record.startDate)}`;
    case 'LEAVING':
      return `Leaves ${day(record.exitDate ?? record.startDate)}`;
    case 'LEFT':
      return record.exitDate === null ? 'Left' : `Left ${day(record.exitDate)}`;
    case 'SUSPENDED':
      return `Suspended, since ${day(record.startDate)}`;
    default:
      return `Since ${day(record.startDate)}`;
  }
}

function rowClass(record: StaffRecord): string | undefined {
  if (record.standing === 'STARTING' && record.login === 'NONE') {
    return 'is-waiting';
  }

  return record.standing === 'LEFT' && record.login === 'ACTIVE' ? 'is-alarm' : undefined;
}

/** "13 records. 10 current staff, 2 starting, 1 who has left." */
function tally(records: StaffRecord[]): string {
  const count = (standing: Standing) => records.filter((one) => one.standing === standing).length;
  const current = count('CURRENT') + count('LEAVING') + count('SUSPENDED');
  const starting = count('STARTING');
  const left = count('LEFT');

  const parts = [
    `${String(current)} current staff`,
    ...(starting === 0 ? [] : [`${String(starting)} starting`]),
    ...(left === 0 ? [] : [`${String(left)} ${left === 1 ? 'who has left' : 'who have left'}`]),
  ];

  return `${String(records.length)} ${records.length === 1 ? 'record' : 'records'}. ${parts.join(', ')}.`;
}

/**
 * The hand-off: who starts soon with no login, and whose job creating it is.
 *
 * Only the starters inside a fortnight are named; anybody further off is on the
 * administrators' list already and nothing about them is urgent yet.
 */
function LoginBanner({
  waiting,
  administrators,
}: {
  waiting: LoginToCreate[];
  administrators: PersonNamed[];
}) {
  const soon = waiting.filter((one) => one.soon);

  if (soon.length === 0) {
    return null;
  }

  const first = soon[0]!;
  const sameDay = soon.every((one) => one.startDate === first.startDate);
  const who =
    soon.length === 1
      ? `${first.person.firstName} ${first.person.lastName} starts`
      : `${String(soon.length)} people start`;
  const when = sameDay ? ` on ${weekday(first.startDate)}` : ' within a fortnight';
  const names = administrators.map((one) => `${one.firstName} ${one.lastName}`);

  return (
    <div className="notice warning admin-banner" role="status">
      <Icon name="info" />
      <div>
        <p>
          <strong>
            {who}
            {when} and {soon.length === 1 ? 'has' : 'have'} no login yet.
          </strong>
        </p>
        <p>
          You have added {soon.length === 1 ? 'their record' : 'their records'}. Creating the login
          is a system administrator&rsquo;s job
          {names.length === 0 ? '' : `: ${listOf(names)}`}. They can already see{' '}
          {soon.length === 1 ? 'it' : soon.length === 2 ? 'both' : 'them'} on their list.
        </p>
      </div>
    </div>
  );
}

/** For somebody who creates logins and keeps no records: just the people waiting. */
function LoginsOnly({ onSignedOut }: { onSignedOut: () => void }) {
  const [waiting, setWaiting] = useState<LoginToCreate[] | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | undefined>(undefined);

  useEffect(() => {
    loginsToCreate()
      .then(setWaiting)
      .catch((error: unknown) => {
        if (isNotSignedIn(error)) {
          onSignedOut();
          return;
        }

        setProblem(problemFrom(error));
      });
  }, [onSignedOut]);

  return (
    <>
      <div className="admin-heading">
        <div>
          <h2>Logins to create</h2>
          <p className="muted">
            New employee records HR has added. Soonest start first; anybody starting within a
            fortnight is flagged.
          </p>
        </div>
      </div>

      {problem === undefined ? null : <Notice problem={problem} />}

      {waiting === undefined ? null : waiting.length === 0 ? (
        <div className="notice plain">
          <p>Everybody with a record has a login.</p>
        </div>
      ) : (
        <div className="directory-card">
          <table className="directory-table admin-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Sign in with</th>
                <th scope="col">Starts</th>
              </tr>
            </thead>
            <tbody>
              {waiting.map((one) => (
                <tr key={one.person.employeeId} className={one.soon ? 'is-waiting' : undefined}>
                  <td className="directory-person">
                    <Avatar person={one.person} />
                    <span>
                      <strong>
                        {one.person.firstName} {one.person.lastName}
                      </strong>
                      {one.person.jobTitle === null ? null : <small>{one.person.jobTitle}</small>}
                    </span>
                  </td>
                  <td className="directory-email">{one.workEmail}</td>
                  <td>
                    {day(one.startDate)}
                    {one.soon ? <span className="tag access is-waiting">Soon</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** "A", "A or B", "A, B or C". */
function listOf(names: string[]): string {
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1] ?? ''}`;
}
