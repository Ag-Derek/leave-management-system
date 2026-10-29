import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  type Directory,
  type DirectoryPerson,
  isNotSignedIn,
  type Me,
  type MyProfile,
  staffDirectory,
} from '../../api';
import { Icon } from '../../Icon';
import { Notice, type Problem, problemFrom } from '../../problem';
import { AccountMenu } from './AccountMenu';
import { AdministrationPage } from './AdministrationPage';
import { ColleagueProfilePage } from './ColleagueProfilePage';
import { EmployeeRecordPage } from './EmployeeRecordPage';
import { MyProfilePage } from './MyProfilePage';
import { OrgChart } from './OrgChart';
import { Avatar, chartAddress, fold, profileAddress, Today } from './person';

/** How many rows the loading state draws, so the page does not jump far when the list lands. */
const PLACEHOLDER_ROWS = 6;

/** Where a profile's back link goes: the view it was opened from. */
export interface BackTo {
  href: string;
  label: string;
}

/**
 * The staff directory, at `#/directory`, the organisation chart at `#/directory/chart`, and
 * one person at `#/directory/<id>`.
 *
 * The list is fetched once and searched here, so typing never waits on the server. The
 * search stays put while somebody looks at a profile and comes back, because this one
 * component draws both. A profile is fetched on its own, for the reporting line the list
 * does not carry.
 */
export function DirectoryPage({
  me,
  initials,
  onSignOut,
  onSignedOut,
}: {
  me: Me;
  initials: string;
  onSignOut: () => void;
  /** A 401, which is a session ending rather than somebody leaving. */
  onSignedOut: () => void;
}) {
  const [directory, setDirectory] = useState<Directory | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');

  const address = useDirectoryAddress();
  const personId = address.view === 'profile' ? address.personId : undefined;

  /* Which of the two views a profile was opened from, so its back link returns there. */
  const [cameFrom, setCameFrom] = useState<'people' | 'chart'>('people');

  useEffect(() => {
    if (address.view === 'people' || address.view === 'chart') {
      setCameFrom(address.view);
    }
  }, [address.view]);

  /* The server's answer, from the list: whether to draw the Administration tab at all. */
  const administers = directory?.may.administer ?? false;
  const seesAdministration = administers || (directory?.may.seeLoginsToCreate ?? false);

  /* Back to the chart centres it on the person just looked at. */
  const back: BackTo =
    cameFrom === 'chart'
      ? {
          href: personId === undefined ? chartAddress() : chartAddress({ employeeId: personId }),
          label: 'Back to organisation chart',
        }
      : { href: '#/directory', label: 'Back to directory' };

  const load = useCallback(() => {
    setLoading(true);

    staffDirectory()
      .then((found) => {
        setDirectory(found);
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

  /* The list is who is here on one day. A tab left open past midnight UTC, the day the server
     judges by, asks again, so the leaver goes and the joiner arrives without a reload. */
  useEffect(() => {
    if (directory === undefined) {
      return;
    }

    const recheck = () => {
      if (
        document.visibilityState === 'visible' &&
        directory.today !== new Date().toISOString().slice(0, 10)
      ) {
        load();
      }
    };

    const midnight = new Date();
    midnight.setUTCHours(24, 0, 5, 0);

    const timer = window.setTimeout(recheck, midnight.getTime() - Date.now());
    document.addEventListener('visibilitychange', recheck);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [directory, load]);

  /* My own changes, put into the list in hand so it shows them without a second fetch. */
  const savedMine = useCallback((mine: MyProfile) => {
    setDirectory((was) =>
      was === undefined
        ? was
        : {
            ...was,
            people: was.people.map((one) =>
              one.employeeId === mine.employeeId
                ? {
                    ...one,
                    workMobile: mine.workMobile,
                    description: mine.description,
                    photo: mine.photo,
                  }
                : one,
            ),
          },
    );
  }, []);

  const mine = personId !== undefined && personId === me.employeeId;

  return (
    <div className="portal">
      <main className="portal-page directory">
        {/* No bar above the page, as Rota has none: the way back to the portal beside the
            app's name, and who is signed in on the right of the same line. */}
        <header className="directory-head">
          <a className="back" href="#/" aria-label="Back to Remat Portal">
            <Icon name="back" />
          </a>

          <h1>Directory</h1>

          <AccountMenu
            me={me}
            initials={initials}
            profileHref={`#/directory/${encodeURIComponent(me.employeeId)}`}
            onProfile={mine}
            onSignOut={onSignOut}
          />
        </header>

        {address.view === 'profile' || address.view === 'record' ? null : (
          <nav className="directory-views" aria-label="Directory views">
            <a href="#/directory" aria-current={address.view === 'people' ? 'page' : undefined}>
              People
            </a>
            <a href={chartAddress()} aria-current={address.view === 'chart' ? 'page' : undefined}>
              Organisation chart
            </a>
            {seesAdministration ? (
              <a
                href="#/directory/admin"
                aria-current={address.view === 'administration' ? 'page' : undefined}
              >
                Administration
              </a>
            ) : null}
          </nav>
        )}

        {address.view === 'people' ? (
          <People
            directory={directory}
            loading={loading}
            problem={problem}
            onRetry={load}
            search={search}
            onSearch={setSearch}
            departmentId={departmentId}
            onDepartment={setDepartmentId}
          />
        ) : address.view === 'chart' ? (
          <OrgChart focusId={address.focusId} onSignedOut={onSignedOut} />
        ) : address.view === 'administration' ? (
          /* Drawn only once the server has said whose it is; the routes refuse anybody else. */
          directory === undefined ? null : (
            <AdministrationPage administer={administers} onSignedOut={onSignedOut} />
          )
        ) : address.view === 'record' ? (
          <EmployeeRecordPage employeeId={address.recordId} onSignedOut={onSignedOut} />
        ) : mine ? (
          <MyProfilePage
            today={directory?.today ?? new Date().toISOString().slice(0, 10)}
            back={back}
            onSaved={savedMine}
            onSignedOut={onSignedOut}
          />
        ) : (
          <ColleagueProfilePage
            employeeId={address.personId}
            today={directory?.today ?? new Date().toISOString().slice(0, 10)}
            back={back}
            onSignedOut={onSignedOut}
          />
        )}
      </main>
    </div>
  );
}

function People({
  directory,
  loading,
  problem,
  onRetry,
  search,
  onSearch,
  departmentId,
  onDepartment,
}: {
  directory: Directory | undefined;
  loading: boolean;
  problem: Problem | undefined;
  onRetry: () => void;
  search: string;
  onSearch: (search: string) => void;
  departmentId: string;
  onDepartment: (departmentId: string) => void;
}) {
  /* Folded once per list rather than once per keystroke per person. */
  const searchable = useMemo(
    () =>
      (directory?.people ?? []).map((person) => ({
        person,
        text: fold(
          [person.firstName, person.lastName, person.jobTitle ?? '', person.department.name].join(
            ' ',
          ),
        ),
      })),
    [directory],
  );

  const terms = fold(search).split(/\s+/).filter(Boolean);

  const shown = searchable
    .filter(
      (one) =>
        (departmentId === '' || one.person.department.id === departmentId) &&
        terms.every((term) => one.text.includes(term)),
    )
    .map((one) => one.person);

  const total = directory?.people.length ?? 0;
  const filtered = terms.length > 0 || departmentId !== '';

  return (
    <>
      <div className="filter-bar directory-filters">
        <label className="filter-search">
          <span className="visually-hidden">Search the directory</span>
          <Icon name="search" />
          <input
            type="search"
            value={search}
            placeholder="Search by name, job title or department"
            autoComplete="off"
            onChange={(event) => {
              onSearch(event.target.value);
            }}
          />
        </label>

        <label>
          <span className="visually-hidden">Department</span>
          <select
            value={departmentId}
            disabled={directory === undefined}
            onChange={(event) => {
              onDepartment(event.target.value);
            }}
          >
            <option value="">All departments</option>
            {directory?.departments.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </select>
        </label>

        {/* Not shown, only read out as the list changes, so somebody who cannot see it
            knows what their typing did. */}
        <p className="visually-hidden" aria-live="polite">
          {directory !== undefined && filtered
            ? `${String(shown.length)} of ${people(total)}`
            : null}
        </p>
      </div>

      {problem === undefined ? null : (
        <Notice problem={problem} retrying={loading} onRetry={onRetry} />
      )}

      {directory === undefined ? (
        problem === undefined ? (
          <Loading />
        ) : null
      ) : shown.length === 0 ? (
        <div className="notice plain directory-empty">
          <p>
            {total === 0
              ? 'Nobody is listed in the directory yet.'
              : terms.length > 0
                ? `Nobody matches "${search.trim()}"${departmentId === '' ? '' : ' in that department'}.`
                : 'Nobody is listed in that department.'}
          </p>
          {filtered ? (
            <button
              type="button"
              className="linkish"
              onClick={() => {
                onSearch('');
                onDepartment('');
              }}
            >
              Clear the search
            </button>
          ) : null}
        </div>
      ) : (
        <PeopleTable people={shown} today={directory.today} />
      )}
    </>
  );
}

function PeopleTable({ people, today }: { people: DirectoryPerson[]; today: string }) {
  return (
    <div className="directory-card">
      <table className="directory-table">
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Department</th>
            <th scope="col">Work email</th>
            <th scope="col">Today</th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr
              key={person.employeeId}
              onClick={(event) => {
                /* The whole row opens the profile, except where the click was on a link of
                   its own: the email address. The name is the link a keyboard reaches. */
                if (!(event.target as HTMLElement).closest('a')) {
                  window.location.hash = profileAddress(person);
                }
              }}
            >
              <td className="directory-person">
                <Avatar person={person} />
                <span>
                  <a href={profileAddress(person)}>
                    {person.firstName} {person.lastName}
                  </a>
                  {person.jobTitle === null ? null : <small>{person.jobTitle}</small>}
                </span>
              </td>
              <td className="directory-department">{person.department.name}</td>
              <td className="directory-email">
                <a href={`mailto:${person.workEmail}`}>{person.workEmail}</a>
              </td>
              <td className="directory-today">
                <Today person={person} today={today} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The shape of the list while it loads. */
function Loading() {
  return (
    <div className="directory-card directory-loading" aria-busy="true">
      <span className="visually-hidden">Loading the directory</span>
      {Array.from({ length: PLACEHOLDER_ROWS }, (_unused, index) => (
        <div key={index} className="directory-placeholder" aria-hidden="true">
          <span className="skeleton is-avatar" />
          <span className="skeleton is-line" />
        </div>
      ))}
    </div>
  );
}

/** "1 person", "12 people". */
function people(count: number): string {
  return `${String(count)} ${count === 1 ? 'person' : 'people'}`;
}

type DirectoryAddress =
  | { view: 'people' }
  | { view: 'chart'; focusId: string | undefined }
  | { view: 'administration' }
  /** A record HR has open, or a new one where `recordId` is undefined. */
  | { view: 'record'; recordId: string | undefined }
  | { view: 'profile'; personId: string };

/**
 * Which view the address is for: the list at `#/directory`, the chart at `#/directory/chart`
 * (centred on somebody at `#/directory/chart/<id>`), HR's tab at `#/directory/admin`, or a
 * profile at `#/directory/<id>`.
 *
 * `chart` and `admin` cannot be anybody's id: ids are numbers.
 */
function useDirectoryAddress(): DirectoryAddress {
  const hash = useSyncExternalStore(subscribeToTheAddress, () => window.location.hash);
  const [, path = ''] = /^#\/?directory\/([^?]*)/.exec(hash) ?? [];
  const [first = '', second = ''] = path.split('/');

  if (first === 'chart') {
    return { view: 'chart', focusId: second === '' ? undefined : decoded(second) };
  }

  /* HR's tab, at `#/directory/admin`, a new record at `/new` and a record at `/<id>`. */
  if (first === 'admin') {
    return second === ''
      ? { view: 'administration' }
      : { view: 'record', recordId: second === 'new' ? undefined : decoded(second) };
  }

  return first === '' ? { view: 'people' } : { view: 'profile', personId: decoded(first) };
}

/* A link pasted with a stray `%` is somebody nobody has, not a page that will not draw. */
function decoded(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

function subscribeToTheAddress(changed: () => void): () => void {
  window.addEventListener('hashchange', changed);

  return () => {
    window.removeEventListener('hashchange', changed);
  };
}
