import { useCallback, useEffect, useState } from 'react';
import { type Adjustable, isNotSignedIn, whoCanBeAdjusted } from '../../api';
import { Notice, type Problem, problemFrom } from '../../problem';
import { RequestHistory } from '../requests/RequestsPage';

/** One person's requests, for HR keeping their record: dates, certificates, withdrawing. */
export function StaffLeavePage({ onSignedOut }: { onSignedOut: () => void }) {
  const [people, setPeople] = useState<Adjustable[] | undefined>(undefined);
  const [chosen, setChosen] = useState('');
  const [problem, setProblem] = useState<Problem | undefined>(undefined);

  const loadPeople = useCallback(() => {
    whoCanBeAdjusted()
      .then((next) => {
        setPeople(next.employees);
        setProblem(undefined);
      })
      .catch((error: unknown) => {
        if (isNotSignedIn(error)) {
          onSignedOut();
          return;
        }

        setProblem(problemFrom(error));
      });
  }, [onSignedOut]);

  useEffect(loadPeople, [loadPeople]);

  return (
    <div className="page">
      <div className="pagehead">
        <p className="muted">
          Somebody&rsquo;s requests. Dates change only while nobody has decided anything; a
          certificate can be added while the leave is still live.
        </p>

        {people === undefined ? null : (
          <div className="controls">
            <label className="filter">
              <span className="visually-hidden">Whose leave</span>
              <select
                value={chosen}
                onChange={(event) => {
                  setChosen(event.target.value);
                }}
              >
                <option value="">Choose somebody</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.employeeNumber}
                    {person.hasLeft ? ' (left)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {problem === undefined ? null : <Notice problem={problem} onRetry={loadPeople} />}

      {chosen === '' ? null : (
        <RequestHistory key={chosen} employeeId={chosen} onSignedOut={onSignedOut} />
      )}
    </div>
  );
}
