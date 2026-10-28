-- Up Migration

-- The third thing a person keeps on their own record: a photo. One per person, at two sizes.
--
-- The bytes live behind `Storage` and these are the handles it issued, as on an attachment.
-- NFR SEC 04. Neither size is what was uploaded: both are cut from it, resized and written
-- again as WebP, which is also what leaves the camera's EXIF block — the location among it —
-- behind. So `content_type` is what is served, and is one value until a migration says
-- otherwise.
--
-- Replacing a photo is a new row rather than an update, so the id changes with the picture.
-- The id is in the address the image is served from, which is what lets a browser keep a
-- copy for a year without ever showing an old face.
--
-- No audit trigger, and `AUDITED_ENTITIES` must not gain this table: the row says who put the
-- photo there and when, and a photo taken down leaves nothing anybody needs kept. NFR AUD 01.

CREATE TABLE employee_photo (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    /* One each. A second upload replaces the first in one transaction. */
    employee_id BIGINT NOT NULL UNIQUE REFERENCES employee(id),

    content_type TEXT NOT NULL,

    /* The size the directory list draws. */
    thumbnail_key TEXT NOT NULL UNIQUE,
    thumbnail_width SMALLINT NOT NULL,
    thumbnail_height SMALLINT NOT NULL,
    thumbnail_size_bytes INTEGER NOT NULL,
    thumbnail_checksum_sha256 TEXT NOT NULL,

    /* The size a profile draws. */
    profile_key TEXT NOT NULL UNIQUE,
    profile_width SMALLINT NOT NULL,
    profile_height SMALLINT NOT NULL,
    profile_size_bytes INTEGER NOT NULL,
    profile_checksum_sha256 TEXT NOT NULL,

    /* Stamped by the trigger below, never supplied by the writer. */
    uploaded_by TEXT NOT NULL,
    uploaded_by_employee_id BIGINT REFERENCES employee(id),
    uploaded_at TIMESTAMPTZ NOT NULL,

    /* Read back by the suite against `PHOTO_CONTENT_TYPE`. */
    CONSTRAINT employee_photo_content_type_is_webp CHECK (
        content_type = 'image/webp'),

    /* The shape `KEY_PATTERN` holds in storage/storage.ts. */
    CONSTRAINT employee_photo_keys_are_keys CHECK (
        thumbnail_key ~ '^[0-9a-f]{64}$'
        AND profile_key ~ '^[0-9a-f]{64}$'
        AND thumbnail_key <> profile_key),

    CONSTRAINT employee_photo_checksums_are_sha256 CHECK (
        thumbnail_checksum_sha256 ~ '^[0-9a-f]{64}$'
        AND profile_checksum_sha256 ~ '^[0-9a-f]{64}$'),

    /* `PHOTO_SIZES`, written out: never larger than the size it was made for. */
    CONSTRAINT employee_photo_dimensions_fit CHECK (
        thumbnail_width BETWEEN 1 AND 128 AND thumbnail_height BETWEEN 1 AND 128
        AND profile_width BETWEEN 1 AND 512 AND profile_height BETWEEN 1 AND 512),

    CONSTRAINT employee_photo_sizes_are_files CHECK (
        thumbnail_size_bytes > 0 AND profile_size_bytes > 0)
);

-- ------------------------------------------------------- who uploaded it, and when

/* The function attachments already use: it stamps `uploaded_at`, `uploaded_by` and
   `uploaded_by_employee_id` off the settings `recording()` writes, whatever table it is on. */

CREATE TRIGGER employee_photo_records_its_uploader
    BEFORE INSERT ON employee_photo
    FOR EACH ROW
    EXECUTE FUNCTION stamp_the_uploader_on_an_attachment();

-- ------------------------------------------------ and the picture itself never changes

CREATE FUNCTION refuse_rewriting_a_photo() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Photo % is the picture that was uploaded and cannot be made into another.', OLD.id
        USING ERRCODE = 'restrict_violation',
              CONSTRAINT = 'employee_photo_is_the_picture_it_was',
              HINT = 'Upload a new one, which replaces this row.';
END
$$;

CREATE TRIGGER employee_photo_is_the_picture_it_was
    BEFORE UPDATE ON employee_photo
    FOR EACH ROW
    EXECUTE FUNCTION refuse_rewriting_a_photo();

-- ---------------------------------------------------------------- privileges

/* SELECT and INSERT come from the default privilege; restated for legibility. DELETE is how a
   photo is replaced or taken down. No UPDATE: there is nothing on the row that moves. */

GRANT SELECT, INSERT, DELETE ON employee_photo TO lms_app;

-- Down Migration

-- The rows go and the bytes do not: storage is not this migration's to empty.

DROP TRIGGER IF EXISTS employee_photo_is_the_picture_it_was ON employee_photo;
DROP TRIGGER IF EXISTS employee_photo_records_its_uploader ON employee_photo;

DROP TABLE IF EXISTS employee_photo;

DROP FUNCTION IF EXISTS refuse_rewriting_a_photo();
