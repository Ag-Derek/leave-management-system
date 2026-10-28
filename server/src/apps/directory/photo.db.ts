/** Database access for people's photos. */

import { type Kysely, type Selectable, sql } from 'kysely';
import type { Attribution } from '../../core/audit/audit.js';
import type { Database } from '../../core/db/index.js';
import type { EmployeePhotoTable } from '../../core/db/schema.js';
import { recording } from '../../core/db/recording.js';
import { type NewPhoto, type Photo, PHOTO_CONTENT_TYPE } from './photo.js';

type PhotoRow = Selectable<EmployeePhotoTable>;

export class PhotoRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Puts a photo on somebody's record, and hands back the one it replaced.
   *
   * One transaction, behind a lock on the person, so two uploads at once are one after the
   * other rather than a unique violation: the second replaces the first and is handed it, and
   * no stored file is left that no row names. The uploader is stamped by the trigger off
   * `recording`.
   */
  async replace(
    by: Attribution,
    photo: NewPhoto,
  ): Promise<{ photo: Photo; replaced: Photo | undefined }> {
    return recording(this.db, by, async (on) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('employee_photo'), ${photo.employeeId}::int)`.execute(
        on,
      );

      const replaced = await on
        .deleteFrom('employee_photo')
        .where('employee_id', '=', photo.employeeId)
        .returningAll()
        .executeTakeFirst();

      const row = await on
        .insertInto('employee_photo')
        .values({
          employee_id: photo.employeeId,
          content_type: PHOTO_CONTENT_TYPE,
          thumbnail_key: photo.thumbnail.key,
          thumbnail_width: photo.thumbnail.width,
          thumbnail_height: photo.thumbnail.height,
          thumbnail_size_bytes: photo.thumbnail.sizeBytes,
          thumbnail_checksum_sha256: photo.thumbnail.checksumSha256,
          profile_key: photo.profile.key,
          profile_width: photo.profile.width,
          profile_height: photo.profile.height,
          profile_size_bytes: photo.profile.sizeBytes,
          profile_checksum_sha256: photo.profile.checksumSha256,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        photo: toPhoto(row),
        replaced: replaced === undefined ? undefined : toPhoto(replaced),
      };
    });
  }

  /** Takes somebody's photo off their record. Undefined where they had none. */
  async remove(employeeId: string): Promise<Photo | undefined> {
    const row = await this.db
      .deleteFrom('employee_photo')
      .where('employee_id', '=', employeeId)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : toPhoto(row);
  }

  async findById(id: string): Promise<Photo | undefined> {
    const row = await this.db
      .selectFrom('employee_photo')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? undefined : toPhoto(row);
  }

  /** These people's photos, where they have one, in no particular order. */
  async photosOf(employeeIds: readonly string[]): Promise<Photo[]> {
    if (employeeIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .selectFrom('employee_photo')
      .selectAll()
      .where('employee_id', 'in', [...employeeIds])
      .execute();

    return rows.map(toPhoto);
  }
}

function toPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    employeeId: row.employee_id,
    /* `employee_photo_content_type_is_webp` is what makes the cast safe. */
    contentType: row.content_type as typeof PHOTO_CONTENT_TYPE,
    thumbnail: {
      key: row.thumbnail_key,
      width: row.thumbnail_width,
      height: row.thumbnail_height,
      sizeBytes: row.thumbnail_size_bytes,
      checksumSha256: row.thumbnail_checksum_sha256,
    },
    profile: {
      key: row.profile_key,
      width: row.profile_width,
      height: row.profile_height,
      sizeBytes: row.profile_size_bytes,
      checksumSha256: row.profile_checksum_sha256,
    },
    uploadedBy: row.uploaded_by,
    uploadedByEmployeeId: row.uploaded_by_employee_id,
    uploadedAt: row.uploaded_at,
  };
}
