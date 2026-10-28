/**
 * Turning an upload into the two sizes that are kept.
 *
 * Every size is decoded from the upload and encoded again, which is what strips it: sharp
 * writes no metadata unless it is asked to, so the EXIF block — GPS position, camera, time
 * taken — and any XMP, IPTC or colour profile are left behind with the original bytes. The
 * orientation the camera recorded is applied first, so nothing is lost by dropping it.
 */

import sharp from 'sharp';
import {
  type AcceptedPhotoType,
  type Crop,
  fitCrop,
  InvalidPhoto,
  MAX_PHOTO_PIXELS,
  PHOTO_SIZES,
  type PhotoSize,
  PhotoTooLarge,
  PhotoTypeNotAccepted,
  sniffPhotoType,
} from './photo.js';

/** One size, encoded. */
export interface Rendition {
  content: Buffer;
  width: number;
  height: number;
}

export type ProcessedPhoto = Record<PhotoSize, Rendition>;

/** What the decoder calls each accepted type, so the bytes and the decoder have to agree. */
const FORMAT_OF: Record<AcceptedPhotoType, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Good enough that a face is a face at 512 pixels, small enough that a list of them is quick. */
const WEBP_QUALITY = 82;

/**
 * Both sizes, cut from the square asked for.
 *
 * In this order, and each step is refused before the next costs anything: what the first bytes
 * say the file is, whether the decoder agrees, how many pixels it would decode into, whether
 * the square is big enough, then the two encodes.
 */
export async function processPhoto(
  content: Buffer,
  asked: Crop | undefined,
  claimedContentType = '',
): Promise<ProcessedPhoto> {
  const type = sniffPhotoType(content);

  if (type === null) {
    throw new PhotoTypeNotAccepted(claimedContentType);
  }

  let metadata: sharp.Metadata;

  try {
    metadata = await sharp(content, { failOn: 'error' }).metadata();
  } catch {
    throw unreadable();
  }

  /* A file that starts like a PNG and decodes as something else is not a PNG. */
  if (metadata.format !== FORMAT_OF[type]) {
    throw new PhotoTypeNotAccepted(claimedContentType);
  }

  const width = metadata.autoOrient.width;
  const height = metadata.autoOrient.height;

  if (width * height > MAX_PHOTO_PIXELS) {
    throw new PhotoTooLarge(0);
  }

  const crop = fitCrop(asked, width, height);

  try {
    const [thumbnail, profile] = await Promise.all([
      render(content, crop, PHOTO_SIZES.thumbnail),
      render(content, crop, PHOTO_SIZES.profile),
    ]);

    return { thumbnail, profile };
  } catch {
    /* The header read and the pixels did not: a truncated or corrupt file. */
    throw unreadable();
  }
}

async function render(content: Buffer, crop: Crop, size: number): Promise<Rendition> {
  const { data, info } = await sharp(content, {
    failOn: 'error',
    limitInputPixels: MAX_PHOTO_PIXELS,
    /* The first frame of an animated WebP or PNG, and nothing after it. */
    pages: 1,
  })
    .autoOrient()
    .extract({ left: crop.left, top: crop.top, width: crop.side, height: crop.side })
    /* Never larger than what was cut: a small photo is kept small rather than blurred up. */
    .resize(size, size, { fit: 'cover', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });

  return { content: data, width: info.width, height: info.height };
}

function unreadable(): InvalidPhoto {
  return new InvalidPhoto(
    'file',
    'That file could not be read as an image. It may be damaged or only partly uploaded; ' +
      'try saving it again, or choose another.',
  );
}
