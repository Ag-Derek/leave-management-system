/**
 * The profile rules, checked as somebody types so a mistake is named before Save.
 *
 * The server checks the same rules and is the one that decides; these are its words said
 * early. Kept in step with server/src/apps/directory/profile.ts by hand, which is three
 * rules and two figures.
 */

/** The longest description, in characters. */
export const DESCRIPTION_LIMIT = 280;

/** The longest work mobile, as typed. */
const MOBILE_LIMIT = 20;

/** Characters, not UTF-16 units, so an emoji is one, as the server counts it. */
export function lengthOf(description: string): number {
  return [...description.trim()].length;
}

/** What is wrong with a description, or null. */
export function descriptionProblem(description: string): string | null {
  const length = lengthOf(description);

  return length > DESCRIPTION_LIMIT
    ? `Description must be ${String(DESCRIPTION_LIMIT)} characters or fewer. It is ${String(length)}.`
    : null;
}

/** What is wrong with a work mobile, or null. Empty is fine: it means none. */
export function workMobileProblem(workMobile: string): string | null {
  const typed = workMobile.trim().replace(/\s+/g, ' ');

  if (typed === '') {
    return null;
  }

  const digits = typed.replace(/\D/g, '');
  const shaped = /^\+?[0-9() -]+$/.test(typed);
  const local = !typed.startsWith('+') && digits.length === 10 && digits.startsWith('0');
  const international = typed.startsWith('+') && digits.length >= 8 && digits.length <= 15;

  if (!shaped || !(local || international)) {
    return (
      'Work mobile must be a phone number: 10 digits starting with 0, like 024 555 0197, or ' +
      'an international number starting with +, like +233 24 555 0197.'
    );
  }

  if (typed.length > MOBILE_LIMIT) {
    return `Work mobile must be ${String(MOBILE_LIMIT)} characters or fewer, spaces included.`;
  }

  return null;
}
