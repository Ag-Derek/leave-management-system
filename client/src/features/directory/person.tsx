import type { DirectoryPerson } from '../../api';
import { day, weekday } from '../../format';

/** The avatar colours, each dark enough to carry white initials in either theme. */
const TONES = 6;

/** In, or the day they are back. Agreed leave only; what kind of leave is never sent. */
export function Today({
  person,
  today,
  inWords = 'In',
}: {
  person: Pick<DirectoryPerson, 'backOn'>;
  today: string;
  /** What "in" is called where it stands alone, as "In today" does on a profile. */
  inWords?: string;
}) {
  if (person.backOn === null) {
    return <span className="presence">{inWords}</span>;
  }

  /* No year for a day this year, which is nearly every return; a long leave says it. */
  const when =
    person.backOn.slice(0, 4) === today.slice(0, 4) ? weekday(person.backOn) : day(person.backOn);

  return <span className="tag is-away">Back {when}</span>;
}

/** Initials in a circle. `aria-hidden`; the name is beside it. */
export function Avatar({
  person,
}: {
  person: Pick<DirectoryPerson, 'employeeId' | 'firstName' | 'lastName'>;
}) {
  return (
    <span className={`avatar tone-${String(toneOf(person.employeeId))}`} aria-hidden="true">
      {`${person.firstName.charAt(0)}${person.lastName.charAt(0)}`.toUpperCase()}
    </span>
  );
}

/** The same colour for the same person on every visit, from their id. */
function toneOf(employeeId: string): number {
  let hash = 0;

  for (const character of employeeId) {
    hash = (hash * 31 + character.charCodeAt(0)) % 997;
  }

  return hash % TONES;
}
