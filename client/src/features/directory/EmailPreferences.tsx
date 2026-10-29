import { useCallback, useEffect, useState } from 'react';
import { chooseEmail, type EmailChoice, isNotSignedIn, myEmailChoices } from '../../api';
import { Notice, type Problem, problemFrom } from '../../problem';

/**
 * Which of the directory's emails come to me, on my own profile.
 *
 * Each optional email is a tick that saves as soon as it is changed, as the photo does. The
 * ones that are always sent are listed too, ticked and fixed, so nobody wonders why an email
 * they cannot find here still arrives.
 */
export function EmailPreferences({ onSignedOut }: { onSignedOut: () => void }) {
  const [choices, setChoices] = useState<EmailChoice[] | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | undefined>(undefined);
  const [saving, setSaving] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState<string | undefined>(undefined);

  const failed = useCallback(
    (error: unknown) => {
      if (isNotSignedIn(error)) {
        onSignedOut();
        return;
      }

      setProblem(problemFrom(error));
    },
    [onSignedOut],
  );

  const load = useCallback(() => {
    myEmailChoices()
      .then((found) => {
        setChoices(found);
        setProblem(undefined);
      })
      .catch(failed);
  }, [failed]);

  useEffect(load, [load]);

  const choose = (choice: EmailChoice, receives: boolean) => {
    setSaving(choice.email);
    setSaved(undefined);
    setProblem(undefined);

    chooseEmail(choice.email, receives)
      .then((now) => {
        setChoices(now);
        setSaved(choice.email);
      })
      .catch(failed)
      .finally(() => {
        setSaving(undefined);
      });
  };

  return (
    <section className="my-profile-emails" aria-labelledby="my-emails">
      <h3 id="my-emails">Emails</h3>

      {problem === undefined ? null : (
        <Notice problem={problem} {...(choices === undefined ? { onRetry: load } : {})} />
      )}

      {choices === undefined ? (
        problem === undefined ? (
          <p className="muted" aria-busy="true">
            Loading your email choices
          </p>
        ) : null
      ) : (
        <ul className="email-choices">
          {choices.map((choice) => (
            <li key={choice.email}>
              <label className="tick">
                <input
                  type="checkbox"
                  checked={choice.receives}
                  disabled={!choice.optional || saving !== undefined}
                  aria-describedby={`email-${choice.email}`}
                  onChange={(event) => {
                    choose(choice, event.target.checked);
                  }}
                />
                <span>
                  <strong>{choice.label}</strong>
                  <small id={`email-${choice.email}`}>
                    {choice.description}
                    {choice.optional ? null : ' Always sent.'}
                  </small>
                </span>
              </label>
              {saved === choice.email ? (
                <span className="email-choice-saved" role="status">
                  Saved
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="muted">
        Emails about your employment, such as changes HR makes to your record, are always sent.
      </p>
    </section>
  );
}
