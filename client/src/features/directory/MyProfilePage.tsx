import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { changeMyProfile, isNotSignedIn, type MyProfile, myProfile } from '../../api';
import { monthAndYear } from '../../format';
import { Icon } from '../../Icon';
import { Notice, type Problem, problemFrom } from '../../problem';
import type { BackTo } from './DirectoryPage';
import { Avatar, chartAddress, Today } from './person';
import { PhotoEditor } from './PhotoEditor';
import { DESCRIPTION_LIMIT, descriptionProblem, lengthOf, workMobileProblem } from './rules';

/**
 * My own profile, at `#/directory/<my id>`, where I change what I keep myself.
 *
 * The three fields I keep can be changed here: the photo, the work mobile and the description.
 * The photo is saved on its own, as soon as it is positioned; the other two with Save.
 * Everything else is shown as it stands and marked as HR's.
 *
 * Each rule is checked as it is typed, so a mistake is named before Save and Save is not
 * offered until there is nothing to name. A save is live at once.
 */
export function MyProfilePage({
  today,
  back,
  onSaved,
  onSignedOut,
}: {
  /** The day the directory judged "in" and "away" on. */
  today: string;
  /** The view this was opened from. */
  back: BackTo;
  /** So the list behind this page shows the change without being fetched again. */
  onSaved: (mine: MyProfile) => void;
  onSignedOut: () => void;
}) {
  const [saved, setSaved] = useState<MyProfile | undefined>(undefined);
  const [loadProblem, setLoadProblem] = useState<Problem | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);

    myProfile()
      .then((found) => {
        setSaved(found);
        setLoadProblem(undefined);
      })
      .catch((error: unknown) => {
        if (isNotSignedIn(error)) {
          onSignedOut();
          return;
        }

        setLoadProblem(problemFrom(error));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [onSignedOut]);

  useEffect(load, [load]);

  return (
    <>
      <a className="directory-back" href={back.href}>
        <Icon name="back" />
        {back.label}
      </a>

      {loadProblem === undefined ? null : (
        <Notice problem={loadProblem} retrying={loading} onRetry={load} />
      )}

      {saved === undefined ? (
        loadProblem === undefined ? (
          <div className="my-profile skeleton is-tall" aria-busy="true">
            <span className="visually-hidden">Loading your profile</span>
          </div>
        ) : null
      ) : (
        <Editor
          saved={saved}
          today={today}
          onSaved={(mine) => {
            setSaved(mine);
            onSaved(mine);
          }}
          onSignedOut={onSignedOut}
        />
      )}
    </>
  );
}

function Editor({
  saved,
  today,
  onSaved,
  onSignedOut,
}: {
  saved: MyProfile;
  today: string;
  onSaved: (mine: MyProfile) => void;
  onSignedOut: () => void;
}) {
  const [workMobile, setWorkMobile] = useState(saved.workMobile ?? '');
  const [description, setDescription] = useState(saved.description ?? '');
  /* The mobile's message waits until the box is left, so it does not shout at the first
     digit; the description's is live, because the counter is already saying it. */
  const [mobileTouched, setMobileTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | undefined>(undefined);
  const [done, setDone] = useState(false);

  const mobileChanged = workMobile !== (saved.workMobile ?? '');
  const descriptionChanged = description !== (saved.description ?? '');
  const changed = mobileChanged || descriptionChanged;

  const mobileError = workMobileProblem(workMobile);
  const descriptionError = descriptionProblem(description);

  /* The server's refusal, where it named one of these boxes, until the box is changed. */
  const serverSaid = (field: string) => (problem?.field === field ? problem.what : null);

  const shownMobileError = (mobileTouched ? mobileError : null) ?? serverSaid('workMobile');
  const shownDescriptionError = descriptionError ?? serverSaid('description');

  const canSave = changed && mobileError === null && descriptionError === null && !saving;

  const edited = () => {
    setDone(false);
    setProblem(undefined);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    setMobileTouched(true);

    if (!canSave) {
      return;
    }

    setSaving(true);
    setProblem(undefined);
    setDone(false);

    changeMyProfile(saved.employeeId, {
      ...(mobileChanged ? { workMobile } : {}),
      ...(descriptionChanged ? { description } : {}),
    })
      .then((mine) => {
        setWorkMobile(mine.workMobile ?? '');
        setDescription(mine.description ?? '');
        setMobileTouched(false);
        setDone(true);
        onSaved(mine);
      })
      .catch((error: unknown) => {
        if (isNotSignedIn(error)) {
          onSignedOut();
          return;
        }

        setProblem(problemFrom(error));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const cancel = () => {
    setWorkMobile(saved.workMobile ?? '');
    setDescription(saved.description ?? '');
    setMobileTouched(false);
    setProblem(undefined);
    setDone(false);
  };

  const length = lengthOf(description);

  return (
    <form className="my-profile" onSubmit={save} noValidate>
      <div className="my-profile-head">
        <div className="my-profile-photo">
          <PhotoEditor
            mine={saved}
            onChanged={(photo) => {
              onSaved({ ...saved, photo });
            }}
            onSignedOut={onSignedOut}
          >
            <Avatar person={saved} size="profile" />
          </PhotoEditor>
        </div>

        <div className="my-profile-who">
          <h2>
            {saved.firstName} {saved.lastName}
          </h2>
          <p className="my-profile-role">
            {[saved.jobTitle, saved.department.name].filter(Boolean).join(', ')}
          </p>
          <p>
            <Today person={saved} today={today} inWords="In today" />
          </p>
          <a className="view-in-chart" href={chartAddress(saved)}>
            <Icon name="stage" />
            View in org chart
          </a>
        </div>
      </div>

      <div className="my-profile-columns">
        <section aria-labelledby="my-contact">
          <h3 id="my-contact">Contact</h3>

          <div className="my-profile-fact">
            <span>Work email</span>
            <p>{saved.workEmail}</p>
          </div>

          <div className="my-profile-field">
            <label htmlFor="work-mobile">Work mobile</label>
            <input
              id="work-mobile"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={workMobile}
              disabled={saving}
              aria-invalid={shownMobileError === null ? undefined : true}
              aria-describedby="work-mobile-hint"
              onChange={(event) => {
                setWorkMobile(event.target.value);
                edited();
              }}
              onBlur={() => {
                setMobileTouched(true);
              }}
            />
            <small id="work-mobile-hint" className={shownMobileError === null ? 'muted' : 'error'}>
              {shownMobileError ?? 'Leave this empty if you do not have one.'}
            </small>
          </div>

          <div className="my-profile-fact">
            <span>At Remat since</span>
            <p>{monthAndYear(saved.startDate)}</p>
          </div>
        </section>

        <section aria-labelledby="my-description">
          <h3 id="my-description">What I do</h3>

          <div className="my-profile-field">
            <label htmlFor="description">
              One or two lines on what colleagues should come to you about
            </label>
            <textarea
              id="description"
              rows={4}
              value={description}
              disabled={saving}
              aria-invalid={shownDescriptionError === null ? undefined : true}
              aria-describedby="description-count"
              onChange={(event) => {
                setDescription(event.target.value);
                edited();
              }}
            />
            <small
              id="description-count"
              className={shownDescriptionError === null ? 'muted' : 'error'}
              aria-live="polite"
            >
              {shownDescriptionError ??
                `${String(length)} of ${String(DESCRIPTION_LIMIT)} characters`}
            </small>
          </div>

          <div className="my-profile-actions">
            <button type="button" disabled={!changed || saving} onClick={cancel}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!canSave}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>

          {done ? (
            <p className="notice done" role="status">
              Saved. Colleagues see the change now.
            </p>
          ) : null}

          {/* A refusal that named a box is said beside it; anything else is said here. */}
          {problem === undefined ||
          problem.field === 'workMobile' ||
          problem.field === 'description' ? null : (
            <Notice problem={problem} />
          )}
        </section>

        <section aria-labelledby="my-reporting-line">
          <h3 id="my-reporting-line">Reporting line</h3>

          <div className="my-profile-fact">
            <span>Reports to</span>
            {saved.manager === null ? (
              <p>Nobody. You head the organisation.</p>
            ) : (
              <p className="my-profile-manager">
                <Avatar person={saved.manager} />
                <span>
                  <strong>
                    {saved.manager.firstName} {saved.manager.lastName}
                  </strong>
                  {saved.manager.jobTitle === null ? null : <small>{saved.manager.jobTitle}</small>}
                </span>
              </p>
            )}
          </div>

          <p className="muted">
            Your reporting line also determines who approves your leave requests. If it is
            incorrect, please contact HR.
          </p>
        </section>
      </div>
    </form>
  );
}
