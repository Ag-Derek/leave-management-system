/**
 * What a person may change on their own record, and the rules for each.
 *
 * Three fields and no others: a photo, a work mobile and a description. Everything else on
 * the record is HR's, and a request naming any of it is refused rather than half applied.
 * The photo is one of the three but is an upload rather than a field, so naming it here is
 * refused with a sentence saying where it goes rather than as a field HR keeps.
 */

/** The longest description, in characters. `employee_description_fits` holds the same. */
export const DESCRIPTION_LIMIT = 280;

/** The longest work mobile, as typed. `employee_work_mobile_is_a_number` holds the same. */
export const MOBILE_LIMIT = 20;

/** The fields a person may send. Anything else is HR's. */
export const SELF_SERVICE_FIELDS = ['photo', 'workMobile', 'description'] as const;

/** A refused change, and the field that caused it. */
export class InvalidProfile extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'InvalidProfile';
    this.field = field;
  }
}

/** A change as sent, checked. An absent field is left alone; null clears it. */
export interface ProfileEdit {
  workMobile?: string | null;
  description?: string | null;
}

/**
 * Checks a request body and returns the change it asks for.
 *
 * Any field outside the three is refused by name, so a screen that sent a job title learns
 * that it cannot rather than being told it worked.
 */
export function validateProfileEdit(body: unknown): ProfileEdit {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidProfile(
      'body',
      'Send your photo, work mobile or description, as fields of one object.',
    );
  }

  const sent = body as Record<string, unknown>;

  for (const field of Object.keys(sent)) {
    if (!(SELF_SERVICE_FIELDS as readonly string[]).includes(field)) {
      throw new InvalidProfile(
        field,
        `${field} is kept by HR, so it cannot be changed here. Only your photo, work mobile ` +
          'and description can.',
      );
    }
  }

  if ('photo' in sent) {
    throw new InvalidProfile(
      'photo',
      'A photo is uploaded on its own rather than sent with your other details: send the ' +
        'image itself to /people/<your id>/photo.',
    );
  }

  const edit: ProfileEdit = {};

  if ('workMobile' in sent) edit.workMobile = workMobileFrom(sent.workMobile);
  if ('description' in sent) edit.description = descriptionFrom(sent.description);

  return edit;
}

/**
 * A work mobile, or null for none.
 *
 * Ten digits starting with 0, as a number is written in Ghana, or an international number
 * starting with + and 8 to 15 digits. Spaces, hyphens and brackets may sit between the
 * digits, because that is how people write numbers, and runs of spaces are closed up.
 */
export function workMobileFrom(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new InvalidProfile('workMobile', 'Work mobile must be written as text.');
  }

  const typed = value.trim().replace(/\s+/g, ' ');

  if (typed === '') {
    return null;
  }

  const digits = typed.replace(/\D/g, '');
  const shaped = /^\+?[0-9() -]+$/.test(typed);
  const local = !typed.startsWith('+') && digits.length === 10 && digits.startsWith('0');
  const international = typed.startsWith('+') && digits.length >= 8 && digits.length <= 15;

  if (!shaped || !(local || international)) {
    throw new InvalidProfile(
      'workMobile',
      'Work mobile must be a phone number: 10 digits starting with 0, like 024 555 0197, or ' +
        'an international number starting with +, like +233 24 555 0197.',
    );
  }

  if (typed.length > MOBILE_LIMIT) {
    throw new InvalidProfile(
      'workMobile',
      `Work mobile must be ${String(MOBILE_LIMIT)} characters or fewer, spaces included.`,
    );
  }

  return typed;
}

/**
 * A description, or null for none.
 *
 * Counted in characters rather than in UTF-16 units, so an emoji is one, as the screen's
 * counter and Postgres's `char_length` both count it.
 */
export function descriptionFrom(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new InvalidProfile('description', 'Description must be written as text.');
  }

  const text = value.trim();

  if (text === '') {
    return null;
  }

  const length = [...text].length;

  if (length > DESCRIPTION_LIMIT) {
    throw new InvalidProfile(
      'description',
      `Description must be ${String(DESCRIPTION_LIMIT)} characters or fewer. It is ` +
        `${String(length)}.`,
    );
  }

  return text;
}
