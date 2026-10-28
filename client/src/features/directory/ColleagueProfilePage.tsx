import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  type DirectoryProfile,
  directoryPerson,
  isNotSignedIn,
  type PersonInBrief,
} from '../../api';
import { day } from '../../format';
import { Icon } from '../../Icon';
import { Notice, type Problem, problemFrom } from '../../problem';
import type { BackTo } from './DirectoryPage';
import { Avatar, chartAddress, profileAddress, Today } from './person';

const NOT_FOUND = 404;

/**
 * A colleague's profile, at `#/directory/<id>`. Read only: nothing on it can be changed, by
 * anybody, from here.
 *
 * Laid out as my own profile is, so the two read as one page. A field they have not filled
 * in is left out rather than shown empty, so a profile with only what HR keeps still looks
 * finished: a name, a role, an email and a reporting line are always there.
 */
export function ColleagueProfilePage({
  employeeId,
  today,
  back,
  onSignedOut,
}: {
  employeeId: string;
  /** The day the directory judged "in" and "away" on. */
  today: string;
  /** The view this was opened from. */
  back: BackTo;
  onSignedOut: () => void;
}) {
  const [found, setFound] = useState<DirectoryProfile | undefined>(undefined);
  const [missing, setMissing] = useState(false);
  const [problem, setProblem] = useState<Problem | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  /* The person on screen now, so an answer about somebody clicked away from is dropped. */
  const asked = useRef(employeeId);
  asked.current = employeeId;

  const load = useCallback(() => {
    setLoading(true);

    const stillWanted = () => asked.current === employeeId;

    directoryPerson(employeeId)
      .then((colleague) => {
        if (!stillWanted()) return;

        setFound(colleague);
        setMissing(false);
        setProblem(undefined);
      })
      .catch((error: unknown) => {
        if (isNotSignedIn(error)) {
          onSignedOut();
          return;
        }

        if (!stillWanted()) return;

        setFound(undefined);

        if (error instanceof ApiError && error.status === NOT_FOUND) {
          setMissing(true);
          setProblem(undefined);
          return;
        }

        setProblem(problemFrom(error));
      })
      .finally(() => {
        if (stillWanted()) setLoading(false);
      });
  }, [employeeId, onSignedOut]);

  useEffect(load, [load]);

  /* Following a link from one profile to another keeps this component, so the last person
     is not left on screen while the next one loads. */
  const shown = found?.employeeId === employeeId ? found : undefined;

  return (
    <>
      <a className="directory-back" href={back.href}>
        <Icon name="back" />
        {back.label}
      </a>

      {problem === undefined ? null : (
        <Notice problem={problem} retrying={loading} onRetry={load} />
      )}

      {missing && !loading ? (
        <>
          <h2>Not in the directory</h2>
          <p className="notice plain">
            Nobody currently at Remat has that address. They may have left, or the link may be out
            of date.
          </p>
        </>
      ) : shown === undefined ? (
        problem === undefined ? (
          <div className="my-profile skeleton is-tall" aria-busy="true">
            <span className="visually-hidden">Loading their profile</span>
          </div>
        ) : null
      ) : (
        <Profile colleague={shown} today={today} />
      )}
    </>
  );
}

function Profile({ colleague, today }: { colleague: DirectoryProfile; today: string }) {
  const { firstName, lastName, notListed } = colleague;

  return (
    <article className="my-profile" aria-label={`${firstName} ${lastName}`}>
      {notListed === null ? null : <NotListed notListed={notListed} />}

      <div className="my-profile-head">
        <div className="my-profile-photo">
          <Avatar person={colleague} size="profile" />
        </div>

        <div className="my-profile-who">
          <h2>
            {firstName} {lastName}
          </h2>
          <p className="my-profile-role">
            {[colleague.jobTitle, colleague.department.name].filter(Boolean).join(', ')}
          </p>
          {/* Somebody not here is neither in nor away. */}
          {notListed === null ? (
            <p>
              <Today
                person={colleague}
                today={today}
                inWords="In today"
                awayWords="On leave, back"
              />
            </p>
          ) : null}
        </div>
      </div>

      <div className={`my-profile-columns${colleague.description === null ? ' is-two' : ''}`}>
        <section aria-labelledby="their-contact">
          <h3 id="their-contact">Contact</h3>

          <div className="my-profile-fact">
            <span>Work email</span>
            <p>
              <a href={`mailto:${colleague.workEmail}`}>{colleague.workEmail}</a>
            </p>
          </div>

          {colleague.workMobile === null ? null : (
            <div className="my-profile-fact">
              <span>Work mobile</span>
              <p>
                <a href={`tel:${colleague.workMobile.replace(/[^\d+]/g, '')}`}>
                  {colleague.workMobile}
                </a>
              </p>
            </div>
          )}
        </section>

        {colleague.description === null ? null : (
          <section aria-labelledby="their-description">
            <h3 id="their-description">What I do</h3>
            <p className="directory-description">{colleague.description}</p>
          </section>
        )}

        <section aria-labelledby="their-reporting-line">
          <h3 id="their-reporting-line">Reporting line</h3>

          <div className="my-profile-fact">
            <span>Reports to</span>
            {colleague.manager === null ? <p>Nobody</p> : <Someone person={colleague.manager} />}
          </div>

          <div className="my-profile-fact">
            <span>Direct reports</span>
            {colleague.reports.length === 0 ? (
              <p>None</p>
            ) : (
              <ul className="my-profile-reports">
                {colleague.reports.map((report) => (
                  <li key={report.employeeId}>
                    <Someone person={report} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Only somebody current is on the chart. */}
          {notListed === null ? (
            <a className="view-in-chart" href={chartAddress(colleague)}>
              <Icon name="stage" />
              See the organisation chart
            </a>
          ) : null}
        </section>
      </div>

      <p className="muted my-profile-footnote">
        The directory shows that somebody is away and when they are back. It never shows why.
      </p>
    </article>
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

/** A manager or a report: their photo or initials, and their name as a link to their profile. */
function Someone({ person }: { person: PersonInBrief }) {
  return (
    <p className="my-profile-manager">
      <Avatar person={person} />
      <span>
        <a href={profileAddress(person)}>
          <strong>
            {person.firstName} {person.lastName}
          </strong>
        </a>
        {person.jobTitle === null ? null : <small>{person.jobTitle}</small>}
      </span>
    </p>
  );
}
