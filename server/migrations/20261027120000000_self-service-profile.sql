-- Up Migration

-- Two of the three things a person keeps on their own record: a work mobile and a line on
-- what they do. Everything else on `employee` is HR's. The third, a photo, is its own
-- change, because storing and serving images is a decision of its own.
--
-- Columns on `employee` rather than a table beside it, so that `employee_is_audited` records
-- every change to them with the rest of the record: the value before, the value after, who
-- and when. Nothing here is a secret or noise, so the trigger needs no new arguments.
--
-- The application checks all of this first, with messages that name the field. These are
-- the same rules held where a script or psql cannot step round them.

ALTER TABLE employee
    /* As typed, with runs of spaces closed up. NULL where they have none. */
    ADD COLUMN work_mobile TEXT,
    /* What colleagues should come to them about. NULL where they have said nothing. */
    ADD COLUMN description TEXT;

ALTER TABLE employee
    ADD CONSTRAINT employee_work_mobile_is_a_number CHECK (
        work_mobile IS NULL
        OR (char_length(work_mobile) <= 20 AND work_mobile ~ '^\+?[0-9() -]+$')
    ),

    /* char_length counts characters rather than bytes, as the screen's counter does. */
    ADD CONSTRAINT employee_description_fits CHECK (
        description IS NULL
        OR (btrim(description) <> '' AND char_length(description) <= 280)
    );

-- Down Migration

ALTER TABLE employee
    DROP CONSTRAINT IF EXISTS employee_description_fits,
    DROP CONSTRAINT IF EXISTS employee_work_mobile_is_a_number,
    DROP COLUMN IF EXISTS description,
    DROP COLUMN IF EXISTS work_mobile;
