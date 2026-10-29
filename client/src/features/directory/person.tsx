import { useState } from 'react';
import type { DirectoryPerson, PhotoLinks } from '../../api';
import { day, weekday } from '../../format';

/** The avatar colours, each dark enough to carry white initials in either theme. */
const TONES = 6;

/** In, or the day they are back. Agreed leave only; what kind of leave is never sent. */
export function Today({
  person,
  today,
  inWords = 'In',
  awayWords = 'Back',
}: {
  person: Pick<DirectoryPerson, 'backOn'>;
  today: string;
  /** What "in" is called where it stands alone, as "In today" does on a profile. */
  inWords?: string;
  /** What comes before the day they are back, as "On leave, back" does on a profile. */
  awayWords?: string;
}) {
  if (person.backOn === null) {
    return <span className="presence">{inWords}</span>;
  }

  /* No year for a day this year, which is nearly every return; a long leave says it. */
  const when =
    person.backOn.slice(0, 4) === today.slice(0, 4) ? weekday(person.backOn) : day(person.backOn);

  return (
    <span className="tag is-away">
      {awayWords} {when}
    </span>
  );
}

/**
 * Who to contact instead of somebody away today, as a link to their profile. Nothing where
 * they are in or named nobody: the server sends a cover only while the leave is under way.
 */
export function Cover({
  person,
  words = 'contact',
}: {
  person: Pick<DirectoryPerson, 'cover'>;
  /** What comes before the name: "contact" in the list, "Contact" leading a sentence. */
  words?: string;
}) {
  if (person.cover === null) {
    return null;
  }

  return (
    <span className="cover-note">
      {words}{' '}
      <a href={profileAddress(person.cover)}>
        {person.cover.firstName} {person.cover.lastName}
      </a>{' '}
      instead
    </span>
  );
}

/**
 * Somebody's photo in a circle, or their initials where they have none. `aria-hidden`; the
 * name is beside it.
 *
 * The initials are also what is drawn if the photo will not load — a session that ended, a
 * photo taken down since the list was fetched — so a face is never a broken image.
 */
export function Avatar({
  person,
  size = 'thumbnail',
}: {
  person: Pick<DirectoryPerson, 'employeeId' | 'firstName' | 'lastName'> & {
    photo?: PhotoLinks | null;
  };
  /** Which size to fetch: the thumbnail anywhere a face is small, the larger on a profile. */
  size?: keyof PhotoLinks;
}) {
  const source = person.photo?.[size];
  const [failed, setFailed] = useState<string | undefined>(undefined);

  if (source !== undefined && source !== failed) {
    return (
      <img
        className="avatar is-photo"
        src={source}
        alt=""
        aria-hidden="true"
        decoding="async"
        loading={size === 'thumbnail' ? 'lazy' : 'eager'}
        onError={() => {
          setFailed(source);
        }}
      />
    );
  }

  return (
    <span className={`avatar tone-${String(toneOf(person.employeeId))}`} aria-hidden="true">
      {initialsOf(person)}
    </span>
  );
}

/**
 * The first letter of each name, as a person would write them: "Ama Mensah" is "AM", and an
 * accented or non-Latin first letter is one letter rather than half of one.
 */
export function initialsOf(person: Pick<DirectoryPerson, 'firstName' | 'lastName'>): string {
  const first = (name: string) => Array.from(name.trim())[0] ?? '';

  return `${first(person.firstName)}${first(person.lastName)}`.toLocaleUpperCase();
}

/** Where somebody's profile is. */
export function profileAddress(person: Pick<DirectoryPerson, 'employeeId'>): string {
  return `#/directory/${encodeURIComponent(person.employeeId)}`;
}

/** Where the organisation chart is, centred on somebody when one is named. */
export function chartAddress(person?: Pick<DirectoryPerson, 'employeeId'>): string {
  return person === undefined
    ? '#/directory/chart'
    : `#/directory/chart/${encodeURIComponent(person.employeeId)}`;
}

/**
 * Text as a search compares it: lower case, and without accents, so "akosua" finds "Akosua"
 * and "ama" finds "Amá".
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** The same colour for the same person on every visit, from their id. */
function toneOf(employeeId: string): number {
  let hash = 0;

  for (const character of employeeId) {
    hash = (hash * 31 + character.charCodeAt(0)) % 997;
  }

  return hash % TONES;
}
