-- Up Migration

-- Leave somebody is planning to take, shared for planning.
--
-- Not a request and not a draft: it holds no days, goes to no approver, and is seen by the
-- person's department, their manager and HR on the team calendar, as dates only. The type
-- and the note stay with the person.

CREATE TABLE leave_plan (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    employee_id BIGINT NOT NULL REFERENCES employee(id),

    /* What kind of leave it would be, so the plan can be set against that balance. */
    leave_type_id BIGINT NOT NULL REFERENCES leave_type(id),

    start_date DATE NOT NULL,
    end_date DATE NOT NULL,

    note TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT leave_plan_ends_after_it_starts CHECK (end_date >= start_date),

    CONSTRAINT leave_plan_note_not_blank CHECK (note IS NULL OR btrim(note) <> '')
);

/* One person's plans never overlap each other. The baseline's btree_gist. */
ALTER TABLE leave_plan
    ADD CONSTRAINT leave_plan_never_overlaps
    EXCLUDE USING gist (
        employee_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&);

/* A department's plans over a year, for the calendar. */
CREATE INDEX leave_plan_by_dates ON leave_plan (start_date, end_date);

CREATE TRIGGER leave_plan_set_updated_at
    BEFORE UPDATE ON leave_plan
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------- and it stays the person's own

CREATE FUNCTION refuse_moving_a_plan_to_somebody_else() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
        RAISE EXCEPTION
            'Leave plan % belongs to employee %, not %.', OLD.id, OLD.employee_id, NEW.employee_id
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'leave_plan_stays_with_whose_it_is';
    END IF;

    RETURN NEW;
END
$$;

CREATE TRIGGER leave_plan_stays_with_whose_it_is
    BEFORE UPDATE ON leave_plan
    FOR EACH ROW
    EXECUTE FUNCTION refuse_moving_a_plan_to_somebody_else();

-- ---------------------------------------------------------------- privileges

/* Default privileges grant these already; said here so the table's access is legible. A plan
   is edited and deleted freely by its owner. */
GRANT SELECT, INSERT, UPDATE, DELETE ON leave_plan TO lms_app;
GRANT USAGE, SELECT ON SEQUENCE leave_plan_id_seq TO lms_app;

-- Down Migration

DROP TRIGGER IF EXISTS leave_plan_stays_with_whose_it_is ON leave_plan;
DROP FUNCTION IF EXISTS refuse_moving_a_plan_to_somebody_else();
DROP TABLE IF EXISTS leave_plan;
