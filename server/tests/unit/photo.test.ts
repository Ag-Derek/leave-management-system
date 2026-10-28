import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  cropFrom,
  fitCrop,
  InvalidPhoto,
  MAX_PHOTO_BYTES,
  photoIdFrom,
  PhotoNotFound,
  photoSizeFrom,
  PhotoTooLarge,
  PhotoTooSmall,
  PhotoTypeNotAccepted,
  sniffPhotoType,
  validatePhotoContent,
} from '../../src/apps/directory/photo.js';
import { processPhoto } from '../../src/apps/directory/photo-image.js';
import { validateProfileEdit } from '../../src/apps/directory/profile.js';

/**
 * A profile photo: what may be uploaded, and what is made of it.
 *
 * The image pipeline is run for real rather than mocked, because the claims that matter —
 * the location is gone, the face is the right way up, the square is the one chosen — are
 * claims about pixels and bytes, and a few small images decode in milliseconds.
 */

async function image(
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp' | 'gif' = 'jpeg',
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#c08040' } })
    .toFormat(format)
    .toBuffer();
}

describe('what the bytes are', () => {
  it('knows a JPEG, a PNG and a WebP by their first bytes', async () => {
    expect(sniffPhotoType(await image(10, 10, 'jpeg'))).toBe('image/jpeg');
    expect(sniffPhotoType(await image(10, 10, 'png'))).toBe('image/png');
    expect(sniffPhotoType(await image(10, 10, 'webp'))).toBe('image/webp');
  });

  it('knows nothing else, a GIF, a PDF and a RIFF that is not WebP among them', async () => {
    expect(sniffPhotoType(await image(10, 10, 'gif'))).toBeNull();
    expect(sniffPhotoType(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(sniffPhotoType(Buffer.from('RIFF\0\0\0\0WAVEfmt '))).toBeNull();
    expect(sniffPhotoType(Buffer.alloc(0))).toBeNull();
  });
});

describe('the bytes as bytes', () => {
  it('refuses an empty body and anything that is not bytes', () => {
    expect(() => validatePhotoContent(Buffer.alloc(0))).toThrow(InvalidPhoto);
    expect(() => validatePhotoContent({})).toThrow(InvalidPhoto);
  });

  it('refuses one byte over the limit, saying the limit', () => {
    expect(() => validatePhotoContent(Buffer.alloc(MAX_PHOTO_BYTES))).not.toThrow();
    expect(() => validatePhotoContent(Buffer.alloc(MAX_PHOTO_BYTES + 1))).toThrow(
      /the limit is 8 MB/,
    );
  });
});

describe('the crop', () => {
  it('is three whole numbers, or nothing', () => {
    expect(cropFrom('120, 40, 800')).toEqual({ left: 120, top: 40, side: 800 });
    expect(cropFrom(undefined)).toBeUndefined();
    expect(cropFrom('  ')).toBeUndefined();
  });

  it('refuses anything else, naming the crop', () => {
    for (const sent of ['1,2', '1,2,3,4', '-1,0,200', '1.5,0,200', 'a,b,c', '0,0,0']) {
      expect(() => cropFrom(sent), sent).toThrow(InvalidPhoto);
    }
  });

  it('is the largest square in the middle when none was asked for', () => {
    expect(fitCrop(undefined, 1200, 900)).toEqual({ left: 150, top: 0, side: 900 });
    expect(fitCrop(undefined, 600, 1000)).toEqual({ left: 0, top: 200, side: 600 });
  });

  it('is held inside the photo rather than refused for a pixel over the edge', () => {
    expect(fitCrop({ left: 401, top: 0, side: 800 }, 1200, 800)).toEqual({
      left: 400,
      top: 0,
      side: 800,
    });
    expect(fitCrop({ left: 0, top: 0, side: 5000 }, 1200, 800)).toEqual({
      left: 0,
      top: 0,
      side: 800,
    });
  });

  it('refuses a photo or a square too small to show clearly', () => {
    expect(() => fitCrop(undefined, 127, 400)).toThrow(PhotoTooSmall);
    expect(() => fitCrop({ left: 0, top: 0, side: 100 }, 1200, 800)).toThrow(PhotoTooSmall);
  });
});

describe('an address', () => {
  it('names one of the two sizes, and anything else is not found', () => {
    expect(photoSizeFrom('thumbnail')).toBe('thumbnail');
    expect(photoSizeFrom('profile')).toBe('profile');
    expect(() => photoSizeFrom('original')).toThrow(PhotoNotFound);
  });

  it('names a photo by a number, and anything else is not found rather than a failed query', () => {
    expect(photoIdFrom('42')).toBe('42');

    for (const sent of ['0', '-1', 'abc', '1e3', '9'.repeat(19), undefined]) {
      expect(() => photoIdFrom(sent), String(sent)).toThrow(PhotoNotFound);
    }
  });
});

describe('making the two sizes', () => {
  it('makes a 128 pixel thumbnail and a 512 pixel profile photo, both WebP', async () => {
    const { thumbnail, profile } = await processPhoto(await image(1200, 900), undefined);

    const [small, large] = await Promise.all([
      sharp(thumbnail.content).metadata(),
      sharp(profile.content).metadata(),
    ]);

    expect([small.format, small.width, small.height]).toEqual(['webp', 128, 128]);
    expect([large.format, large.width, large.height]).toEqual(['webp', 512, 512]);
    expect([thumbnail.width, profile.width]).toEqual([128, 512]);
  });

  it('accepts a PNG and a WebP as well as a JPEG', async () => {
    await expect(processPhoto(await image(300, 300, 'png'), undefined)).resolves.toBeDefined();
    await expect(processPhoto(await image(300, 300, 'webp'), undefined)).resolves.toBeDefined();
  });

  it('never makes a small photo larger than it was cut', async () => {
    const { profile } = await processPhoto(await image(300, 300), undefined);

    expect([profile.width, profile.height]).toEqual([300, 300]);
  });

  it('leaves the EXIF block behind, location and camera with it', async () => {
    const withLocation = await sharp(await image(600, 600))
      .withExifMerge({ IFD0: { Make: 'PhoneCo', ImageDescription: 'Home, Accra' } })
      .toBuffer();

    expect((await sharp(withLocation).metadata()).exif).toBeDefined();

    const { thumbnail, profile } = await processPhoto(withLocation, undefined);

    for (const made of [thumbnail.content, profile.content]) {
      expect((await sharp(made).metadata()).exif).toBeUndefined();
      expect(made.includes(Buffer.from('PhoneCo'))).toBe(false);
      expect(made.includes(Buffer.from('Accra'))).toBe(false);
    }
  });

  it('refuses a GIF, and bytes that start like a PNG and are not one', async () => {
    await expect(processPhoto(await image(300, 300, 'gif'), undefined)).rejects.toThrow(
      PhotoTypeNotAccepted,
    );

    const pretending = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      await image(300, 300, 'jpeg'),
    ]);

    await expect(processPhoto(pretending, undefined)).rejects.toThrow();
  });

  it('refuses a truncated file as unreadable rather than failing', async () => {
    const whole = await image(800, 800, 'png');

    await expect(processPhoto(whole.subarray(0, 200), undefined)).rejects.toThrow(InvalidPhoto);
  });

  it('refuses a photo with more pixels than may be decoded, before decoding it', async () => {
    /* A PNG this size is a few kilobytes of one colour, and fifty-six million pixels. */
    const huge = await sharp({
      create: { width: 8000, height: 7000, channels: 3, background: '#fff' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();

    await expect(processPhoto(huge, undefined)).rejects.toThrow(PhotoTooLarge);
  });

  it('says what the file was sent as, when the refusal is about the type', () => {
    expect(new PhotoTypeNotAccepted('application/pdf').message).toContain(
      'sent as application/pdf',
    );
    expect(new PhotoTypeNotAccepted('application/octet-stream').message).not.toContain('sent as');
  });
});

describe('the profile form', () => {
  it('sends a photo to its own upload rather than saving it as a field', () => {
    expect(() => validateProfileEdit({ photo: 'me.jpg' })).toThrow(/uploaded on its own/);
  });
});
