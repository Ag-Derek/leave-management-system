/**
 * A person's photo: what may be uploaded, what is kept of it, and the refusals.
 *
 * What is kept is never what was uploaded. Both sizes are cut from it and written again, so
 * nothing the camera put in the file — the location, the device, the time — survives. That
 * work is ./photo-image.ts; this is the rules it works to.
 */

/** What the bytes may be, as the bytes say it rather than as the name or the header does. */
export const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AcceptedPhotoType = (typeof ACCEPTED_PHOTO_TYPES)[number];

/** What both sizes are kept and served as. `employee_photo_content_type_is_webp` holds it. */
export const PHOTO_CONTENT_TYPE = 'image/webp';

/** Eight megabytes: a photo straight off a phone, with room to spare. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/**
 * The most pixels a photo may have before it is read. Fifty million is a 48 megapixel camera
 * and a little more; past it, a small file can decode into more memory than a server has.
 */
export const MAX_PHOTO_PIXELS = 50_000_000;

/** The smallest square a photo may be cut to, which is the larger size's quarter. */
export const MIN_PHOTO_SIDE = 128;

/**
 * The two sizes, each a square this many pixels across. The thumbnail is for the list and
 * anywhere a face is a dot beside a name; the profile size is for the profile page. Both are
 * about twice what is drawn, for screens with dense pixels. `employee_photo_dimensions_fit`
 * holds the same two numbers.
 */
export const PHOTO_SIZES = { thumbnail: 128, profile: 512 } as const;

export type PhotoSize = keyof typeof PHOTO_SIZES;

/** One size of a photo, as storage holds it. */
export interface StoredRendition {
  /** The handle storage issued. Never sent to a client. NFR SEC 04. */
  key: string;
  width: number;
  height: number;
  sizeBytes: number;
  checksumSha256: string;
}

/** A photo as it comes back out. */
export interface Photo {
  id: string;
  employeeId: string;
  contentType: typeof PHOTO_CONTENT_TYPE;
  thumbnail: StoredRendition;
  profile: StoredRendition;
  uploadedBy: string;
  uploadedByEmployeeId: string | null;
  uploadedAt: Date;
}

/** What a processed and stored upload holds, before it is written. */
export interface NewPhoto {
  employeeId: string;
  thumbnail: StoredRendition;
  profile: StoredRendition;
}

/** The square to cut, in pixels of the photo the right way up. */
export interface Crop {
  left: number;
  top: number;
  side: number;
}

/* ------------------------------------------------------------------ the crop */

/**
 * The crop a client asked for, or undefined where it asked for none.
 *
 * Three whole numbers, `left,top,side`, in pixels of the photo as it is shown — the right way
 * up, which is how a browser draws it and so how the person chose. Where it falls is
 * {@link fitCrop}'s.
 */
export function cropFrom(value: unknown): Crop | undefined {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return undefined;
  }

  const parts = typeof value === 'string' ? value.split(',').map((part) => part.trim()) : [];

  if (parts.length !== 3 || !parts.every((part) => /^\d{1,6}$/.test(part))) {
    throw new InvalidPhoto(
      'crop',
      'The crop is three whole numbers of pixels, left, top and side, such as "120,40,800".',
    );
  }

  const [left, top, side] = parts.map(Number);

  if (side === 0) {
    throw new InvalidPhoto('crop', 'The crop has to be a square with something in it.');
  }

  return { left, top, side };
}

/**
 * The square that is actually cut, from what was asked and the photo's size.
 *
 * With nothing asked, the largest square in the middle. What was asked is held inside the
 * photo rather than refused for a pixel over the edge, because a screen that scales a photo
 * to draw it rounds, and the person meant the edge.
 */
export function fitCrop(asked: Crop | undefined, width: number, height: number): Crop {
  const shorter = Math.min(width, height);

  if (shorter < MIN_PHOTO_SIDE) {
    throw new PhotoTooSmall(width, height);
  }

  if (asked === undefined) {
    return {
      left: Math.floor((width - shorter) / 2),
      top: Math.floor((height - shorter) / 2),
      side: shorter,
    };
  }

  const side = Math.min(asked.side, shorter);

  if (side < MIN_PHOTO_SIDE) {
    throw new PhotoTooSmall(side, side);
  }

  return {
    left: Math.min(asked.left, width - side),
    top: Math.min(asked.top, height - side),
    side,
  };
}

/* ------------------------------------------------------------------ validation */

/** The bytes, as bytes: something there, and under the cap. */
export function validatePhotoContent(content: unknown): Buffer {
  if (!Buffer.isBuffer(content) || content.byteLength === 0) {
    throw new InvalidPhoto(
      'file',
      'The body of an upload is the photo itself, sent as bytes. An empty body is not a photo.',
    );
  }

  if (content.byteLength > MAX_PHOTO_BYTES) {
    throw new PhotoTooLarge(content.byteLength);
  }

  return content;
}

/** Which size an address asks for. Anything else is a photo that is not there. */
export function photoSizeFrom(value: unknown): PhotoSize {
  if (value === 'thumbnail' || value === 'profile') {
    return value;
  }

  throw new PhotoNotFound();
}

/** A photo id as an address carries it. Anything that is not one is a photo that is not there. */
export function photoIdFrom(value: unknown): string {
  if (typeof value === 'string' && /^[1-9]\d{0,17}$/.test(value)) {
    return value;
  }

  throw new PhotoNotFound();
}

/* ------------------------------------------------------------------ sniffing */

/**
 * What the bytes actually are, or null.
 *
 * The extension and the `Content-Type` are never consulted, as with attachments. NFR SEC 07.
 */
export function sniffPhotoType(content: Buffer): AcceptedPhotoType | null {
  if (startsWith(content, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }

  if (startsWith(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }

  /* RIFF, four bytes of length, WEBP. */
  if (
    startsWith(content, [0x52, 0x49, 0x46, 0x46]) &&
    content.byteLength >= 12 &&
    content.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

function startsWith(content: Buffer, magic: readonly number[]): boolean {
  return content.byteLength >= magic.length && magic.every((byte, at) => content[at] === byte);
}

/* ------------------------------------------------------------------ refusals */

/** An upload that is not a photo. Carries the field, like every other validator. NFR USA 03. */
export class InvalidPhoto extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'InvalidPhoto';
    this.field = field;
  }
}

/** The bytes are something other than a JPEG, PNG or WebP. */
export class PhotoTypeNotAccepted extends Error {
  readonly code = 'TYPE_NOT_ACCEPTED';
  readonly field = 'file';

  constructor(claimed: string) {
    super(
      'That file is not a JPEG, PNG or WebP image, whatever it is called, so it cannot be ' +
        'your photo. What a file is, is read from the file rather than from its name, so ' +
        `renaming it will not help.${
          claimed === '' || claimed === 'application/octet-stream'
            ? ''
            : ` It was sent as ${claimed}.`
        } An iPhone photo saved as HEIC can be exported as JPEG first.`,
    );
    this.name = 'PhotoTypeNotAccepted';
  }
}

export class PhotoTooLarge extends Error {
  readonly code = 'FILE_TOO_LARGE';
  readonly field = 'file';
  readonly sizeBytes: number;
  readonly maxBytes = MAX_PHOTO_BYTES;

  constructor(sizeBytes: number) {
    super(
      `${
        sizeBytes > 0 ? `That photo is ${megabytes(sizeBytes)} MB` : 'That photo is too large'
      } and the limit is ${megabytes(MAX_PHOTO_BYTES)} MB. A photo straight off a phone is ` +
        'usually well under it; a screenshot or a smaller copy of this one will do.',
    );
    this.name = 'PhotoTooLarge';
    this.sizeBytes = sizeBytes;
  }
}

/** Too few pixels to make a profile photo that is anything but a blur. */
export class PhotoTooSmall extends Error {
  readonly code = 'PHOTO_TOO_SMALL';
  readonly field = 'file';

  constructor(width: number, height: number) {
    super(
      `That is ${String(width)} by ${String(height)} pixels, and a photo needs a square of at ` +
        `least ${String(MIN_PHOTO_SIDE)} by ${String(MIN_PHOTO_SIDE)} to show clearly. Use a ` +
        'larger copy, or zoom out before you save.',
    );
    this.name = 'PhotoTooSmall';
  }
}

/** No such photo, or not one this person may see. Answered as one, so neither can be told. */
export class PhotoNotFound extends Error {
  constructor() {
    super('There is no photo at that address.');
    this.name = 'PhotoNotFound';
  }
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '');
}
