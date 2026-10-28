import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ApiError,
  type Directory,
  type DirectoryPerson,
  type DirectoryProfile,
  directoryPerson,
  isNotSignedIn,
  type Me,
  type MyProfile,
  staffDirectory,
} from '../../api';
import { day } from '../../format';
import { Icon } from '../../Icon';
import { Notice, type Problem, problemFrom } from '../../problem';
import { AccountMenu } from './AccountMenu';
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
 * component draws both.
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
    if (address.view !== 'profile') {
      setCameFrom(address.view);
    }
  }, [address.view]);

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
                ? { ...one, workMobile: mine.workMobile, description: mine.description }
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

        {address.view === 'profile' ? null : (
          <nav className="directory-views" aria-label="Directory views">
            <a href="#/directory" aria-current={address.view === 'people' ? 'page' : undefined}>
              People
            </a>
            <a href={chartAddress()} aria-current={address.view === 'chart' ? 'page' : undefined}>
              Organisation chart
            </a>
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
        ) : mine ? (
          <MyProfilePage
            today={directory?.today ?? new Date().toISOString().slice(0, 10)}
            back={back}
            onSaved={savedMine}
            onSignedOut={onSignedOut}
          />
        ) : (
          <Profile
            personId={address.personId}
            listed={directory?.people.find((one) => one.employeeId === personId)}
            directory={directory}
            loading={loading}
            problem={problem}
            onRetry={load}
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

/**
 * One person: from the list the table drew when they are in it, and otherwise asked of the
 * server, which answers HR about somebody who has left or not yet started and answers anybody
 * else 404.
 */
function Profile({
  personId,
  listed,
  directory,
  loading,
  problem,
  onRetry,
  back,
  onSignedOut,
}: {
  personId: string;
  listed: DirectoryPerson | undefined;
  directory: Directory | undefined;
  loading: boolean;
  problem: Problem | undefined;
  onRetry: () => void;
  back: BackTo;
  onSignedOut: () => void;
}) {
  /* What the server said about somebody not in the list, and for whom it said it. */
  const [asked, setAsked] = useState<
    { personId: string; answer: DirectoryProfile | 'nobody' | Problem } | undefined
  >(undefined);

  const unlisted = directory !== undefined && listed === undefined;

  useEffect(() => {
    if (!unlisted) {
      return;
    }

    let current = true;

    directoryPerson(personId)
      .then((found) => {
        if (current) setAsked({ personId, answer: found });
      })
      .catch((error: unknown) => {
        if (isNotSignedIn(error)) {
          onSignedOut();
          return;
        }

        if (current) {
          setAsked({
            personId,
            answer:
              error instanceof ApiError && error.status === 404 ? 'nobody' : problemFrom(error),
          });
        }
      });

    return () => {
      current = false;
    };
  }, [unlisted, personId, onSignedOut]);

  const answer = asked?.personId === personId ? asked.answer : undefined;
  const fetched =
    typeof answer === 'object' && 'employeeId' in answer ? (answer as DirectoryProfile) : undefined;
  const failed =
    typeof answer === 'object' && !('employeeId' in answer) ? (answer as Problem) : undefined;

  const person: DirectoryPerson | undefined = listed ?? fetched;
  const notListed = listed === undefined ? (fetched?.notListed ?? null) : null;

  return (
    <>
      <a className="directory-back" href={back.href}>
        <Icon name="back" />
        {back.label}
      </a>

      {problem === undefined ? null : (
        <Notice problem={problem} retrying={loading} onRetry={onRetry} />
      )}

      {failed === undefined ? null : <Notice problem={failed} />}

      {directory === undefined || (unlisted && answer === undefined) ? (
        problem === undefined ? (
          <Loading />
        ) : null
      ) : person === undefined ? (
        answer === 'nobody' ? (
          <>
            <h2>Not in the directory</h2>
            <p className="notice plain">
              Nobody currently at Remat has that address. They may have left, or the link may be out
              of date.
            </p>
          </>
        ) : null
      ) : (
        <section className="directory-profile">
          {notListed === null ? null : <NotListed notListed={notListed} />}

          <div className="directory-profile-head">
            <Avatar person={person} />
            <div>
              <h2>
                {person.firstName} {person.lastName}
              </h2>
              {person.jobTitle === null ? null : <p className="muted">{person.jobTitle}</p>}
              {/* Only somebody current is on the chart. */}
              {notListed === null ? (
                <a className="view-in-chart" href={chartAddress(person)}>
                  <Icon name="stage" />
                  View in org chart
                </a>
              ) : null}
            </div>
          </div>

          <dl>
            <div>
              <dt>Department</dt>
              <dd>{person.department.name}</dd>
            </div>
            <div>
              <dt>Work email</dt>
              <dd>
                <a href={`mailto:${person.workEmail}`}>{person.workEmail}</a>
              </dd>
            </div>
            {person.workMobile === null ? null : (
              <div>
                <dt>Work mobile</dt>
                <dd>
                  <a href={`tel:${person.workMobile.replace(/[^\d+]/g, '')}`}>
                    {person.workMobile}
                  </a>
                </dd>
              </div>
            )}
            {person.description === null ? null : (
              <div>
                <dt>What I do</dt>
                <dd className="directory-description">{person.description}</dd>
              </div>
            )}
            {notListed === null ? (
              <div>
                <dt>Today</dt>
                <dd>
                  <Today person={person} today={directory.today} />
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      )}
    </>
  );
}

/**
 * Why HR is looking at somebody the directory does not list, and where their records are.
 * Only HR is ever answered such a profile, so only HR ever sees this.
 */
function NotListed({ notListed }: { notListed: NonNullable<DirectoryProfile['notListed']> }) {
  return (
    <div className="notice warning directory-not-listed" role="note">
      <p>
        {notListed.reason === 'LEFT'
          ? `Left. Their last day was ${day(notListed.exitDate ?? notListed.startDate)}.`
          : notListed.reason === 'NOT_STARTED'
            ? `Not started yet. They join on ${day(notListed.startDate)}.`
            : 'Suspended.'}{' '}
        Colleagues cannot see this profile; you can because you keep staff records.
      </p>
      {notListed.reason === 'LEFT' ? (
        <p>
          <a href="#/leavers">Final leave statement</a> · <a href="#/staff-leave">Leave history</a>
        </p>
      ) : null}
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
  | { view: 'profile'; personId: string };

/**
 * Which view the address is for: the list at `#/directory`, the chart at `#/directory/chart`
 * (centred on somebody at `#/directory/chart/<id>`), or a profile at `#/directory/<id>`.
 *
 * `chart` cannot be anybody's id: ids are numbers.
 */
function useDirectoryAddress(): DirectoryAddress {
  const hash = useSyncExternalStore(subscribeToTheAddress, () => window.location.hash);
  const [, path = ''] = /^#\/?directory\/([^?]*)/.exec(hash) ?? [];
  const [first = '', second = ''] = path.split('/');

  if (first === 'chart') {
    return { view: 'chart', focusId: second === '' ? undefined : decoded(second) };
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
